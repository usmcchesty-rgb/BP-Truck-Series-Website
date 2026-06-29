import { getSettings, supabase } from './_lib.js';
import { loadDisplayFantasySlate, loadLatestFantasySlate } from './_fantasy-public-slate.js';
import { ensureFantasyProfile } from './_fantasy-auth.js';
import { deriveDriverActivityStatus } from './_fantasy-public-analysis.js';
import {
  buildFantasyProgressionMeta,
  isFantasyRaceComplete,
  resolveFantasySlateProgression,
} from './_fantasy-slate-progression.js';

const SALARY_CAP = 50000;
const LINEUP_SIZE = 5;

export function parseLockState(slateRow = {}, options = {}) {
  const lockTime = slateRow.lock_time || slateRow.lockTime || null;
  const lockAtRaw = slateRow.lock_at || slateRow.lockAt || null;
  const lockAt = lockAtRaw ? new Date(lockAtRaw) : null;
  const hasLockSchedule = Boolean(lockAt && Number.isFinite(lockAt.getTime()));
  const raceComplete = Boolean(options.raceComplete);
  const timeLocked = hasLockSchedule ? Date.now() >= lockAt.getTime() : false;
  const isLocked = raceComplete || timeLocked;

  return {
    lockTime,
    lockAt: hasLockSchedule ? lockAt.toISOString() : null,
    hasLockSchedule,
    isLocked,
    raceComplete,
    isPlayable: !raceComplete && !timeLocked,
    lockMessage: raceComplete
      ? 'Race complete — scoring pending'
      : !lockTime && !hasLockSchedule
        ? 'Lineup lock time not set'
        : isLocked
          ? 'Lineups are locked for this race'
          : null,
  };
}

async function loadSlateById(slateId) {
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.from('fantasy_slates').select('*').eq('id', slateId).maybeSingle();
  if (error || !data) return null;
  return data;
}

function normalizeLineupRow(row, drivers = []) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    seasonId: row.season_id,
    raceNumber: row.race_number,
    slateId: row.slate_id,
    totalSalary: row.total_salary,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    status: row.status,
    drivers: drivers
      .sort((a, b) => a.slot_order - b.slot_order)
      .map((d) => ({
        driverId: d.driver_id,
        driverName: d.driver_name,
        salary: d.salary,
        slotOrder: d.slot_order,
      })),
  };
}

export async function getUserLineupForCurrentSlate(userId, seasonId) {
  const sb = supabase();
  if (!sb) throw new Error('Database not configured.');

  const progression = await resolveFantasySlateProgression(seasonId);
  const slateRow = progression.displaySlateRow;
  if (!slateRow?.id) return { slate: null, lineup: null, lock: null, progression: buildFantasyProgressionMeta(progression) };

  const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number);
  const lock = parseLockState(slateRow, { raceComplete });

  const { data: lineup, error } = await sb
    .from('fantasy_lineups')
    .select('*')
    .eq('user_id', userId)
    .eq('slate_id', slateRow.id)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to load lineup.');

  if (!lineup) {
    return {
      slate: {
        id: slateRow.id,
        seasonId: slateRow.season_id,
        raceNumber: slateRow.race_number,
        track: slateRow.track,
        status: slateRow.status,
        salaryCap: SALARY_CAP,
        lineupSize: LINEUP_SIZE,
        slatePhase: progression.slatePhase,
        playable: progression.isPlayable,
        raceComplete,
        ...lock,
      },
      lineup: null,
      lock,
      progression: buildFantasyProgressionMeta(progression),
    };
  }

  const { data: driverRows } = await sb
    .from('fantasy_lineup_drivers')
    .select('*')
    .eq('lineup_id', lineup.id)
    .order('slot_order', { ascending: true });

  let status = lineup.status;
  if (lock.isLocked && status !== 'locked') {
    status = 'locked';
    await sb.from('fantasy_lineups').update({ status: 'locked', updated_at: new Date().toISOString() }).eq('id', lineup.id);
  }

  return {
    slate: {
      id: slateRow.id,
      seasonId: slateRow.season_id,
      raceNumber: slateRow.race_number,
      track: slateRow.track,
      status: slateRow.status,
      salaryCap: SALARY_CAP,
      lineupSize: LINEUP_SIZE,
      slatePhase: progression.slatePhase,
      playable: progression.isPlayable,
      raceComplete,
      ...lock,
    },
    lineup: normalizeLineupRow({ ...lineup, status }, driverRows || []),
    lock,
    progression: buildFantasyProgressionMeta(progression),
  };
}

function validateLineupPayload(drivers, slateDrivers, salaryCap = SALARY_CAP, lineupSize = LINEUP_SIZE) {
  if (!Array.isArray(drivers) || drivers.length !== lineupSize) {
    throw new Error(`Lineup must include exactly ${lineupSize} drivers.`);
  }

  const ids = drivers.map((d) => String(d.driverId || d.driver_id || '').trim());
  if (new Set(ids).size !== ids.length) {
    throw new Error('Duplicate drivers are not allowed.');
  }

  const slateMap = new Map(
    (slateDrivers || []).map((d) => [String(d.driverId || d.driver_id), d])
  );

  let totalSalary = 0;
  const normalized = [];

  for (let i = 0; i < drivers.length; i += 1) {
    const id = ids[i];
    const slateDriver = slateMap.get(id);
    if (!slateDriver) {
      throw new Error('One or more drivers are not on the current slate.');
    }
    const activity = deriveDriverActivityStatus(slateDriver);
    if (activity.status === 'Inactive') {
      const name = slateDriver.driverName || slateDriver.driver_name || 'Driver';
      throw new Error(`${name} is inactive and cannot be rostered. Pick an active driver.`);
    }
    const salary = Number(slateDriver.finalSalary ?? slateDriver.salary ?? slateDriver.final_salary);
    if (!Number.isFinite(salary)) throw new Error('Invalid driver salary on slate.');
    totalSalary += salary;
    normalized.push({
      driver_id: id,
      driver_name: slateDriver.driverName || slateDriver.driver_name || '',
      salary,
      slot_order: i + 1,
    });
  }

  if (totalSalary > salaryCap) {
    throw new Error(`Lineup exceeds the $${salaryCap.toLocaleString('en-US')} salary cap.`);
  }

  return { totalSalary, drivers: normalized };
}

export async function submitFantasyLineup(user, body = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Database not configured.');

  await ensureFantasyProfile(user);

  const settings = await getSettings();
  const seasonId = String(body.seasonId || settings.seasonId || '27987');
  const progression = await resolveFantasySlateProgression(seasonId);
  if (!progression.activeSlateRow?.id) {
    throw new Error('No active fantasy slate available for lineup submission.');
  }

  const slateRow = progression.activeSlateRow;
  const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number);
  if (raceComplete) {
    throw new Error('This race is complete. Lineup submission is closed.');
  }

  const payload = await loadLatestFantasySlate(seasonId);
  if (!payload?.slate?.id) throw new Error('No fantasy slate available.');

  const lock = parseLockState(slateRow, { raceComplete });
  if (lock.isLocked) {
    throw new Error('Lineups are locked for this race.');
  }

  const { totalSalary, drivers } = validateLineupPayload(
    body.drivers || [],
    payload.drivers || [],
    Number(body.salaryCap) || SALARY_CAP,
    Number(body.lineupSize) || LINEUP_SIZE
  );

  const now = new Date().toISOString();
  const { data: existing } = await sb
    .from('fantasy_lineups')
    .select('id, status')
    .eq('user_id', user.id)
    .eq('slate_id', slateRow.id)
    .maybeSingle();

  if (existing?.status === 'locked') {
    throw new Error('Your lineup is locked and cannot be edited.');
  }

  let lineupId = existing?.id || null;

  if (lineupId) {
    const { error: updateError } = await sb
      .from('fantasy_lineups')
      .update({
        total_salary: totalSalary,
        updated_at: now,
        submitted_at: now,
        status: 'submitted',
      })
      .eq('id', lineupId)
      .eq('user_id', user.id);

    if (updateError) throw new Error(updateError.message || 'Failed to update lineup.');

    await sb.from('fantasy_lineup_drivers').delete().eq('lineup_id', lineupId);
  } else {
    const { data: inserted, error: insertError } = await sb
      .from('fantasy_lineups')
      .insert({
        user_id: user.id,
        season_id: String(slateRow.season_id),
        race_number: Number(slateRow.race_number),
        slate_id: slateRow.id,
        total_salary: totalSalary,
        submitted_at: now,
        updated_at: now,
        status: 'submitted',
      })
      .select('*')
      .single();

    if (insertError) throw new Error(insertError.message || 'Failed to save lineup.');
    lineupId = inserted.id;
  }

  const driverPayload = drivers.map((d) => ({ ...d, lineup_id: lineupId }));
  const { error: driversError } = await sb.from('fantasy_lineup_drivers').insert(driverPayload);
  if (driversError) throw new Error(driversError.message || 'Failed to save lineup drivers.');

  const { data: savedDrivers } = await sb
    .from('fantasy_lineup_drivers')
    .select('*')
    .eq('lineup_id', lineupId)
    .order('slot_order', { ascending: true });

  const { data: savedLineup } = await sb
    .from('fantasy_lineups')
    .select('*')
    .eq('id', lineupId)
    .single();

  return {
    ok: true,
    lineup: normalizeLineupRow(savedLineup, savedDrivers || []),
    slate: {
      id: slateRow.id,
      raceNumber: slateRow.race_number,
      track: slateRow.track,
      ...lock,
    },
  };
}

export async function countLineupsForSlate(slateId) {
  const sb = supabase();
  if (!sb || !slateId) return 0;
  const { count, error } = await sb
    .from('fantasy_lineups')
    .select('id', { count: 'exact', head: true })
    .eq('slate_id', slateId);
  if (error) return 0;
  return count || 0;
}

function mapLineupDriverRow(row) {
  return {
    driverId: row.driver_id,
    driverName: row.driver_name,
    salary: row.salary,
    slotOrder: row.slot_order,
  };
}

export async function listSubmittedLineupsForSlate(slateId) {
  const sb = supabase();
  if (!sb || !slateId) return [];

  const { data: rows, error } = await sb
    .from('fantasy_lineups')
    .select('*')
    .eq('slate_id', Number(slateId))
    .order('submitted_at', { ascending: true });

  if (error || !rows?.length) return [];

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: profiles } = await sb
    .from('fantasy_profiles')
    .select('user_id, display_name, email')
    .in('user_id', userIds);

  const profileByUser = new Map((profiles || []).map((p) => [p.user_id, p]));
  const lineupIds = rows.map((row) => row.id);
  const { data: driverRows } = await sb
    .from('fantasy_lineup_drivers')
    .select('*')
    .in('lineup_id', lineupIds)
    .order('slot_order', { ascending: true });

  const driversByLineup = new Map();
  for (const driver of driverRows || []) {
    const list = driversByLineup.get(driver.lineup_id) || [];
    list.push(mapLineupDriverRow(driver));
    driversByLineup.set(driver.lineup_id, list);
  }

  return rows.map((row) => {
    const profile = profileByUser.get(row.user_id) || {};
    return {
      lineupId: row.id,
      userId: row.user_id,
      displayName:
        String(profile.display_name || '').trim() ||
        (profile.email ? profile.email.split('@')[0] : 'Player'),
      email: profile.email || null,
      totalSalary: row.total_salary,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
      status: row.status,
      drivers: driversByLineup.get(row.id) || [],
    };
  });
}

export async function getFantasyPublicStandings(seasonId) {
  const progression = await resolveFantasySlateProgression(seasonId);
  const slateRow = progression.archivedSlateRow || progression.activeSlateRow;
  if (!slateRow?.id) {
    return {
      slate: null,
      entries: [],
      scoringAvailable: false,
      progression: buildFantasyProgressionMeta(progression),
      message: 'Standings will appear after a slate is published and race scoring is complete.',
    };
  }

  const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number);
  const lock = parseLockState(slateRow, { raceComplete });
  const lineups = await listSubmittedLineupsForSlate(slateRow.id);

  return {
    slate: {
      id: slateRow.id,
      seasonId: slateRow.season_id,
      raceNumber: slateRow.race_number,
      track: slateRow.track,
      status: slateRow.status,
      lockTime: slateRow.lock_time || null,
      slatePhase: raceComplete ? 'race-complete' : progression.slatePhase,
      raceComplete,
      ...lock,
    },
    entries: lineups.map((entry, index) => ({
      rank: index + 1,
      lineupId: entry.lineupId,
      displayName: entry.displayName,
      totalSalary: entry.totalSalary,
      submittedAt: entry.submittedAt,
      status: lock.isLocked && entry.status !== 'locked' ? 'locked' : entry.status,
      racePoints: null,
      totalPoints: null,
      driverCount: entry.drivers.length,
    })),
    scoringAvailable: false,
    progression: buildFantasyProgressionMeta(progression),
    message: raceComplete
      ? 'Race complete — fantasy scoring will appear here after results are scored.'
      : 'Race scoring is not live yet. Player ranks reflect submission order until points are posted.',
  };
}

export async function getFantasyAdminSubmittedLineups(seasonId, slateId = null) {
  let targetSlateId = slateId != null ? Number(slateId) : null;
  let slateRow = null;
  let progression = null;

  if (targetSlateId) {
    slateRow = await loadSlateById(targetSlateId);
  } else {
    progression = await resolveFantasySlateProgression(seasonId);
    slateRow =
      progression.archivedSlateRow ||
      progression.activeSlateRow ||
      progression.displaySlateRow;
    targetSlateId = slateRow?.id ?? null;
  }

  if (!targetSlateId || !slateRow) {
    return { slate: null, lineups: [], lineupCount: 0, progression: buildFantasyProgressionMeta(progression || {}) };
  }

  if (!progression) {
    progression = await resolveFantasySlateProgression(seasonId);
  }

  const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number);
  const lock = parseLockState(slateRow, { raceComplete });
  const lineups = await listSubmittedLineupsForSlate(targetSlateId);

  return {
    slate: {
      id: slateRow.id,
      seasonId: slateRow.season_id,
      raceNumber: slateRow.race_number,
      track: slateRow.track,
      status: slateRow.status,
      lockTime: slateRow.lock_time || null,
      publishedAt: slateRow.published_at || null,
      raceComplete,
      slatePhase: raceComplete ? 'race-complete' : progression.slatePhase,
      ...lock,
    },
    lineups,
    lineupCount: lineups.length,
    progression: buildFantasyProgressionMeta(progression),
  };
}

export async function getFantasyLaunchDashboard(user) {
  const settings = await getSettings();
  const seasonId = String(settings.seasonId || '27987');
  const progression = await resolveFantasySlateProgression(seasonId);
  const profile = user ? await ensureFantasyProfile(user) : null;
  const lineupState = user
    ? await getUserLineupForCurrentSlate(user.id, seasonId)
    : { slate: null, lineup: null, lock: null, progression: buildFantasyProgressionMeta(progression) };

  if (!lineupState.slate && progression.displaySlateRow) {
    const slateRow = progression.displaySlateRow;
    const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number);
    const lock = parseLockState(slateRow, { raceComplete });
    lineupState.slate = {
      id: slateRow.id,
      seasonId: slateRow.season_id,
      raceNumber: slateRow.race_number,
      track: slateRow.track,
      status: slateRow.status,
      salaryCap: SALARY_CAP,
      lineupSize: LINEUP_SIZE,
      slatePhase: progression.slatePhase,
      playable: progression.isPlayable,
      raceComplete,
      ...lock,
    };
    lineupState.lock = lock;
    lineupState.progression = buildFantasyProgressionMeta(progression);
  }

  return {
    profile: profile
      ? {
          email: profile.email,
          displayName: profile.display_name || profile.displayName,
        }
      : null,
    progression: buildFantasyProgressionMeta(progression),
    ...lineupState,
  };
}
