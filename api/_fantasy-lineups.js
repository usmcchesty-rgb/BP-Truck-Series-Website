import { getSettings, supabase } from './_lib.js';
import { loadLatestFantasySlate } from './_fantasy-public-slate.js';
import { ensureFantasyProfile } from './_fantasy-auth.js';

const SALARY_CAP = 50000;
const LINEUP_SIZE = 5;

export function parseLockState(slateRow = {}) {
  const lockTime = slateRow.lock_time || slateRow.lockTime || null;
  const lockAtRaw = slateRow.lock_at || slateRow.lockAt || null;
  const lockAt = lockAtRaw ? new Date(lockAtRaw) : null;
  const hasLockSchedule = Boolean(lockAt && Number.isFinite(lockAt.getTime()));
  const isLocked = hasLockSchedule ? Date.now() >= lockAt.getTime() : false;

  return {
    lockTime,
    lockAt: hasLockSchedule ? lockAt.toISOString() : null,
    hasLockSchedule,
    isLocked,
    lockMessage: !lockTime && !hasLockSchedule
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

  const payload = await loadLatestFantasySlate(seasonId);
  if (!payload?.slate?.id) return { slate: null, lineup: null, lock: null };

  const slateRow = payload.slate;
  const lock = parseLockState(slateRow);

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
        ...lock,
      },
      lineup: null,
      lock,
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
      ...lock,
    },
    lineup: normalizeLineupRow({ ...lineup, status }, driverRows || []),
    lock,
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
  const payload = await loadLatestFantasySlate(seasonId);
  if (!payload?.slate?.id) throw new Error('No fantasy slate available.');

  const slateRow = payload.slate;
  const lock = parseLockState(slateRow);
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

export async function getFantasyLaunchDashboard(user) {
  const settings = await getSettings();
  const seasonId = String(settings.seasonId || '27987');
  const profile = user ? await ensureFantasyProfile(user) : null;
  const lineupState = user
    ? await getUserLineupForCurrentSlate(user.id, seasonId)
    : { slate: null, lineup: null, lock: null };

  if (!lineupState.slate) {
    const payload = await loadLatestFantasySlate(seasonId);
    if (payload?.slate) {
      const lock = parseLockState(payload.slate);
      lineupState.slate = {
        id: payload.slate.id,
        seasonId: payload.slate.season_id,
        raceNumber: payload.slate.race_number,
        track: payload.slate.track,
        status: payload.slate.status,
        salaryCap: SALARY_CAP,
        lineupSize: LINEUP_SIZE,
        ...lock,
      };
      lineupState.lock = lock;
    }
  }

  return {
    profile: profile
      ? {
          email: profile.email,
          displayName: profile.display_name || profile.displayName,
        }
      : null,
    ...lineupState,
  };
}
