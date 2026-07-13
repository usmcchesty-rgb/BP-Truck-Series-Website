import { getSettings, supabase } from './_lib.js';
import { loadDisplayFantasySlate, loadLatestFantasySlate } from './_fantasy-public-slate.js';
import { ensureFantasyProfile } from './_fantasy-auth.js';
import { deriveDriverActivityStatus } from './_fantasy-public-analysis.js';
import {
  buildFantasyProgressionMeta,
  isFantasyRaceComplete,
  resolveFantasySlateProgression,
} from './_fantasy-slate-progression.js';

async function loadFantasyRaceScoringModule() {
  return import('./_fantasy-race-scoring.js');
}

const SALARY_CAP = 50000;
const LINEUP_SIZE = 5;

export function parseLockState(slateRow = {}, options = {}) {
  const lockTime = slateRow.lock_time || slateRow.lockTime || null;
  const lockAtRaw = slateRow.lock_at || slateRow.lockAt || null;
  const lockAt = lockAtRaw ? new Date(lockAtRaw) : null;
  const hasLockSchedule = Boolean(lockAt && Number.isFinite(lockAt.getTime()));
  const raceComplete = Boolean(options.raceComplete);
  const nowMs = (options.now instanceof Date ? options.now : new Date()).getTime();
  const timeLocked = hasLockSchedule ? nowMs >= lockAt.getTime() : false;
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

export async function loadSlateById(slateId) {
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

export async function getFantasyPublicStandings(seasonId, options = {}) {
  const settings = options.settings || (await getSettings());
  const resolvedSeasonId = String(seasonId || settings.seasonId || '27987');

  if (options.autoScore !== false) {
    const { runFantasyPostRaceAutomation } = await import('./_fantasy-post-race-automation.js');
    await runFantasyPostRaceAutomation(resolvedSeasonId, { settings });
  }

  const progression = await resolveFantasySlateProgression(resolvedSeasonId, { settings });
  let slateRow = progression.archivedSlateRow || progression.activeSlateRow;
  if (!slateRow?.id) {
    return {
      slate: null,
      entries: [],
      scoringAvailable: false,
      scoringPhase: 'pending',
      progression: buildFantasyProgressionMeta(progression),
      message: 'Standings will appear after a slate is published and race scoring is complete.',
    };
  }

  const { refreshPublishedSlateRow, resolveStandingsDisplayState } = await import(
    './_fantasy-post-race-automation.js'
  );
  const refreshedSlate = await refreshPublishedSlateRow(slateRow.id);
  if (refreshedSlate) slateRow = refreshedSlate;

  const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number);
  const lock = parseLockState(slateRow, { raceComplete });
  const lineups = await listSubmittedLineupsForSlate(slateRow.id);
  const { loadFantasyLineupScoresForSlate, loadFantasySeasonPointTotals } =
    await loadFantasyRaceScoringModule();
  const lineupScores = await loadFantasyLineupScoresForSlate(slateRow.id);
  const scoreByLineupId = new Map(lineupScores.map((row) => [String(row.lineup_id), row]));
  const seasonTotals = await loadFantasySeasonPointTotals(resolvedSeasonId);
  const scoringMeta = parseSlateScoringMeta(slateRow);
  const displayState = resolveStandingsDisplayState(scoringMeta, lineupScores);

  const entries = lineups
    .map((entry) => {
      const scored = scoreByLineupId.get(String(entry.lineupId)) || null;
      const showPoints = displayState.showPoints && scored;
      return {
        rank: showPoints ? Number(scored.rank) : null,
        lineupId: entry.lineupId,
        displayName: entry.displayName,
        totalSalary: entry.totalSalary,
        submittedAt: entry.submittedAt,
        status: lock.isLocked && entry.status !== 'locked' ? 'locked' : entry.status,
        racePoints: showPoints ? Number(scored.total_points) : null,
        totalPoints: showPoints
          ? Number((seasonTotals.get(String(entry.userId)) || scored.total_points).toFixed(2))
          : null,
        driverCount: entry.drivers.length,
        breakdown: showPoints ? scored?.breakdown || null : null,
        drivers: entry.drivers,
      };
    })
    .sort((a, b) => {
      if (displayState.showPoints) {
        return Number(a.rank || 999) - Number(b.rank || 999);
      }
      return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
    });

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
      scoringStatus: scoringMeta?.status || null,
      scoringPhase: displayState.phase,
      scoringLabel: displayState.label,
      scoredAt: scoringMeta?.scoredAt || null,
      ...lock,
    },
    entries,
    scoringAvailable: displayState.scoringAvailable,
    scoringPhase: displayState.phase,
    scoringLabel: displayState.label,
    scoringMeta,
    progression: buildFantasyProgressionMeta(progression),
    message: displayState.message,
  };
}

function parseSlateScoringMeta(slateRow) {
  const meta = slateRow?.meta;
  if (!meta) return null;
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta)?.scoring || null;
    } catch {
      return null;
    }
  }
  return meta?.scoring || null;
}

async function loadPublishedSlateForRace(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return null;

  const { data, error } = await sb
    .from('fantasy_slates')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .eq('status', 'published')
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

function normalizeSubmittedLineupsOptions(options = null) {
  if (typeof options === 'number' || options === null || options === undefined) {
    return { slateId: options ?? null };
  }
  return {
    slateId:
      options.slateId != null && Number.isFinite(Number(options.slateId))
        ? Number(options.slateId)
        : null,
    raceNumber:
      options.raceNumber != null && Number.isFinite(Number(options.raceNumber))
        ? Number(options.raceNumber)
        : null,
  };
}

export async function resolveAdminSubmittedLineupsSlate(seasonId, options = {}) {
  const opts = normalizeSubmittedLineupsOptions(options);
  const progression = await resolveFantasySlateProgression(seasonId, opts);

  let slateRow = null;
  let source = 'none';

  if (opts.slateId) {
    slateRow = await loadSlateById(opts.slateId);
    source = 'requested';
  } else if (opts.raceNumber != null) {
    slateRow = await loadPublishedSlateForRace(seasonId, opts.raceNumber);
    source = 'requested';
  } else if (progression.activeSlateRow?.id) {
    slateRow = progression.activeSlateRow;
    source = 'active';
  } else if (progression.archivedSlateRow?.id) {
    slateRow = progression.archivedSlateRow;
    source = 'archived';
  }

  const selectedSlatePhase =
    source === 'active'
      ? 'active'
      : source === 'archived'
        ? 'race-complete'
        : slateRow &&
            isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number)
          ? 'race-complete'
          : progression.slatePhase;

  const selection = {
    selectedSlateId: slateRow?.id ?? null,
    selectedRaceNumber: slateRow?.race_number ?? null,
    selectedSlatePhase,
    selectedTrack: slateRow?.track ?? null,
    source,
    activeSlateId: progression.activeSlateRow?.id ?? null,
    activeRaceNumber: progression.activeSlateRow?.race_number ?? null,
    activeTrack: progression.activeSlateRow?.track ?? null,
    archivedSlateId: progression.archivedSlateRow?.id ?? null,
    archivedRaceNumber: progression.archivedSlateRow?.race_number ?? null,
    archivedTrack: progression.archivedSlateRow?.track ?? null,
  };

  return { progression, slateRow, selection };
}

export async function getFantasyAdminSubmittedLineups(seasonId, options = {}) {
  const { progression, slateRow, selection } = await resolveAdminSubmittedLineupsSlate(
    seasonId,
    options,
  );

  if (!slateRow?.id) {
    return {
      slate: null,
      lineups: [],
      lineupCount: 0,
      progression: buildFantasyProgressionMeta(progression),
      selection,
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
      publishedAt: slateRow.published_at || null,
      raceComplete,
      slatePhase: raceComplete ? 'race-complete' : selection.selectedSlatePhase,
      ...lock,
    },
    lineups,
    lineupCount: lineups.length,
    progression: buildFantasyProgressionMeta(progression),
    selection,
  };
}

export async function getFantasyLaunchDashboard(user) {
  const settings = await getSettings();
  const seasonId = String(settings.seasonId || '27987');
  const progression = await resolveFantasySlateProgression(seasonId);
  const { runFantasyPostRaceAutomation } = await import('./_fantasy-post-race-automation.js');
  await runFantasyPostRaceAutomation(seasonId, { settings });
  const profile = user ? await ensureFantasyProfile(user) : null;
  const lineupState = user
    ? await getUserLineupForCurrentSlate(user.id, seasonId)
    : { slate: null, lineup: null, lock: null, progression: buildFantasyProgressionMeta(progression) };

  let scoring = null;
  let scoringPhase = 'pending';
  let scoringLabel = 'Pending';
  if (lineupState.lineup?.id && lineupState.slate?.id) {
    const { loadFantasyLineupScoresForSlate, loadFantasySeasonPointTotals } =
      await loadFantasyRaceScoringModule();
    const { refreshPublishedSlateRow, resolveStandingsDisplayState } = await import(
      './_fantasy-post-race-automation.js'
    );
    const refreshedSlate = await refreshPublishedSlateRow(lineupState.slate.id);
    const scoringMeta = parseSlateScoringMeta(refreshedSlate || lineupState.slate);
    const scores = await loadFantasyLineupScoresForSlate(lineupState.slate.id);
    const displayState = resolveStandingsDisplayState(scoringMeta, scores);
    scoringPhase = displayState.phase;
    scoringLabel = displayState.label;
    const mine = scores.find((row) => String(row.lineup_id) === String(lineupState.lineup.id));
    const seasonTotals = await loadFantasySeasonPointTotals(seasonId);
    if (displayState.showPoints && mine) {
      scoring = {
        racePoints: Number(mine.total_points),
        raceRank: Number(mine.rank),
        seasonPoints: Number(seasonTotals.get(String(user.id)) || mine.total_points),
        breakdown: mine.breakdown || null,
        scoredAt: mine.scored_at || null,
        scoringPhase: displayState.phase,
        scoringLabel: displayState.label,
      };
    }
  }

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
    scoring,
    scoringPhase,
    scoringLabel,
    ...lineupState,
  };
}
