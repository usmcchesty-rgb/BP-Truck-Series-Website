import { fetchHtml, getDriverProfiles, getSettings, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getRecentPointsRaceResults,
} from './_schedule-points-races.js';
import { findEffectiveNextPointsRace } from './_race-date-status.js';
import { buildFactualGroundingContext } from './_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from './_power-rankings-results-audit.js';
import {
  buildDriverLookup,
  fetchStandingsRows,
} from './power-rankings-generate.js';
import {
  alignAllCompletedPointsRaces,
  buildDriverCareerRaceResultsByDriver,
  buildDriverRaceResultsByDriver,
  resolveTrackType,
} from './_fantasy-track-history.js';
import {
  buildFantasyDriverSalaries,
  FANTASY_MODEL_VERSION,
  summarizeFantasySlateMeta,
} from './_fantasy-salary-scoring.js';
import {
  computeFantasyLockAt,
  DEFAULT_FANTASY_LOCK_DISPLAY,
} from './_fantasy-lock-time.js';
import {
  enrichFantasySlateDrivers,
  summarizeFantasySlateAnalytics,
} from './_fantasy-admin-analytics.js';
import {
  loadEligibleFantasyStandingsPool,
  refreshFantasyDriverPoolMetadata,
  SLATE_MAX_STANDINGS_POSITION,
} from './_fantasy-driver-pool.js';

export { SLATE_MAX_STANDINGS_POSITION };

export function extractScheduleIdFromRace(race) {
  if (race?.scheduleId) return String(race.scheduleId);
  const match = String(race?.link || '').match(/schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

async function loadPriorSlateSalaryMaps(seasonId, beforeRaceNumber) {
  const maps = await loadPriorFantasySlateMaps(seasonId, beforeRaceNumber);
  return {
    priorSalariesByDriver: maps.priorSalariesByDriver,
    priorRaceNumber: maps.priorRaceNumber,
  };
}

export async function loadPriorFantasySlateMaps(seasonId, beforeRaceNumber) {
  const sb = supabase();
  const empty = {
    priorSalariesByDriver: new Map(),
    priorTierScoresByDriver: new Map(),
    priorRaceNumber: null,
  };
  if (!sb) return empty;

  const { data: slates, error } = await sb
    .from('fantasy_slates')
    .select('id, race_number, status')
    .eq('season_id', String(seasonId))
    .lt('race_number', Number(beforeRaceNumber))
    .order('race_number', { ascending: false })
    .limit(1);

  if (error || !slates?.length) return empty;

  const slate = slates[0];
  const { data: drivers } = await sb
    .from('fantasy_slate_drivers')
    .select('driver_id, final_salary, fantasy_tier_score')
    .eq('slate_id', slate.id);

  const priorSalariesByDriver = new Map();
  const priorTierScoresByDriver = new Map();
  for (const row of drivers || []) {
    priorSalariesByDriver.set(String(row.driver_id), Number(row.final_salary));
    priorTierScoresByDriver.set(String(row.driver_id), Number(row.fantasy_tier_score));
  }

  return {
    priorSalariesByDriver,
    priorTierScoresByDriver,
    priorRaceNumber: slate.race_number,
  };
}

async function loadPriorPublishedSlateMaps(seasonId, beforeRaceNumber) {
  const sb = supabase();
  const empty = {
    priorSalariesByDriver: new Map(),
    priorTierScoresByDriver: new Map(),
    priorRaceNumber: null,
  };
  if (!sb) return empty;

  const { data: slates, error } = await sb
    .from('fantasy_slates')
    .select('id, race_number')
    .eq('season_id', String(seasonId))
    .eq('status', 'published')
    .lt('race_number', Number(beforeRaceNumber))
    .order('race_number', { ascending: false })
    .limit(1);

  if (error || !slates?.length) return empty;

  const slate = slates[0];
  const { data: drivers } = await sb
    .from('fantasy_slate_drivers')
    .select('driver_id, final_salary, fantasy_tier_score')
    .eq('slate_id', slate.id);

  const priorSalariesByDriver = new Map();
  const priorTierScoresByDriver = new Map();
  for (const row of drivers || []) {
    priorSalariesByDriver.set(String(row.driver_id), Number(row.final_salary));
    priorTierScoresByDriver.set(String(row.driver_id), Number(row.fantasy_tier_score));
  }

  return {
    priorSalariesByDriver,
    priorTierScoresByDriver,
    priorRaceNumber: slate.race_number,
  };
}

async function loadSlateRowForRace(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return null;

  const { data: row, error } = await sb
    .from('fantasy_slates')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .maybeSingle();

  if (error || !row || isBackfilledSlate(row)) return null;
  return row;
}

export async function loadFantasySlateForRace(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return null;

  const row = await loadSlateRowForRace(seasonId, raceNumber);
  if (!row?.id) return null;

  const drivers = await loadFantasySlateDrivers(sb, row.id);
  return enrichFantasyDraftPayload({
    slate: row,
    drivers,
  });
}

async function deleteExistingDraft(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb) return;

  const { data: existing } = await sb
    .from('fantasy_slates')
    .select('id')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .eq('status', 'draft')
    .maybeSingle();

  if (!existing?.id) return;

  await sb.from('fantasy_slate_drivers').delete().eq('slate_id', existing.id);
  await sb.from('fantasy_slates').delete().eq('id', existing.id);
}

async function saveDraftSlate(slateRow, driverRows, options = {}) {
  const sb = supabase();
  if (!sb) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const existing = await loadSlateRowForRace(slateRow.season_id, slateRow.race_number);
  if (existing?.status === 'published' && !options.allowPublishedUpdate) {
    const error = new Error(
      `Race ${existing.race_number} already has a published fantasy slate. Use Add Missing or Regenerate Published Slate instead.`
    );
    error.code = 'PUBLISHED_SLATE_EXISTS';
    error.existingSlateId = existing.id;
    error.raceNumber = existing.race_number;
    throw error;
  }

  const now = new Date().toISOString();
  const payload = driverRows.map((row) => ({
    driver_id: row.driverId,
    driver_name: row.driverName,
    car_number: row.carNumber,
    computed_tier: row.computedTier,
    fantasy_tier_score: row.fantasyTierScore,
    score_breakdown: row.scoreBreakdown,
    generated_salary: row.generatedSalary,
    salary_override: row.salaryOverride,
    final_salary: row.finalSalary,
    track_history_summary: row.trackHistorySummary,
    track_adjustment: row.trackAdjustment,
    salary_reasons: row.salaryReasons,
    prior_salary: row.priorSalary,
  }));

  let slateRecord = existing;

  if (existing?.id) {
    const updates = {
      schedule_id: slateRow.schedule_id ?? existing.schedule_id,
      track: slateRow.track ?? existing.track,
      track_type: slateRow.track_type ?? existing.track_type,
      lock_time: slateRow.lock_time ?? existing.lock_time,
      model_version: slateRow.model_version ?? existing.model_version,
      meta: slateRow.meta ?? existing.meta,
      updated_at: now,
    };
    if (options.allowPublishedUpdate) {
      updates.status = existing.status;
    } else {
      updates.status = 'draft';
      updates.generated_at = now;
    }

    const { data: updated, error } = await sb
      .from('fantasy_slates')
      .update(updates)
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message || 'Failed to update fantasy slate.');
    }

    await sb.from('fantasy_slate_drivers').delete().eq('slate_id', existing.id);
    slateRecord = updated;
  } else {
    const { data: inserted, error } = await sb
      .from('fantasy_slates')
      .insert({
        ...slateRow,
        status: 'draft',
        generated_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message || 'Failed to save fantasy slate.');
    }
    slateRecord = inserted;
  }

  const driverInsertPayload = payload.map((row) => ({
    ...row,
    slate_id: slateRecord.id,
  }));

  const { error: driversError } = await sb.from('fantasy_slate_drivers').insert(driverInsertPayload);
  if (driversError) {
    if (!existing?.id) {
      await sb.from('fantasy_slates').delete().eq('id', slateRecord.id);
    }
    throw new Error(driversError.message || 'Failed to save fantasy slate drivers.');
  }

  return {
    slate: slateRecord,
    drivers: driverInsertPayload,
    existingSlateFound: Boolean(existing?.id),
    actionTaken: existing?.id ? 'updated_existing' : 'created_draft',
  };
}

export function normalizeSlateDriver(row) {
  return {
    driverId: String(row.driver_id),
    driverName: row.driver_name || '',
    carNumber: row.car_number || '',
    computedTier: row.computed_tier || '',
    fantasyTierScore: Number(row.fantasy_tier_score),
    fantasyTierScoreRaw:
      row.score_breakdown?._fantasyTierScoreRaw != null
        ? Number(row.score_breakdown._fantasyTierScoreRaw)
        : null,
    scoreBreakdown: row.score_breakdown || {},
    generatedSalary: Number(row.generated_salary),
    salaryOverride: row.salary_override != null ? Number(row.salary_override) : null,
    finalSalary: Number(row.final_salary),
    trackHistorySummary: row.track_history_summary || {},
    trackHistoryRank:
      row.track_history_summary?.trackHistoryRank ??
      row.score_breakdown?.careerTrackHistory?.details?.trackHistoryRank ??
      null,
    provenTrackHistoryRank:
      row.track_history_summary?.provenTrackHistoryRank ??
      row.score_breakdown?.careerTrackHistory?.details?.provenTrackHistoryRank ??
      null,
    trackHistorySampleQuality:
      row.track_history_summary?.trackHistorySampleQuality ??
      row.score_breakdown?.careerTrackHistory?.details?.trackHistorySampleQuality ??
      null,
    trackHistoryLimitedSample:
      row.track_history_summary?.trackHistoryLimitedSample ??
      row.score_breakdown?.careerTrackHistory?.details?.trackHistoryLimitedSample ??
      false,
    trackAdjustment: row.track_adjustment || {},
    salaryReasons: row.salary_reasons || [],
    priorSalary: row.prior_salary != null ? Number(row.prior_salary) : null,
  };
}

function isBackfilledSlate(row) {
  const meta = row?.meta;
  if (!meta) return false;
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta)?.backfilled === true;
    } catch {
      return false;
    }
  }
  return meta.backfilled === true;
}

function compareFantasySlateRows(a, b, { preferDraft = false } = {}) {
  const raceDiff = Number(b.race_number) - Number(a.race_number);
  if (raceDiff !== 0) return raceDiff;

  if (preferDraft) {
    const aDraft = a.status === 'draft' ? 1 : 0;
    const bDraft = b.status === 'draft' ? 1 : 0;
    if (bDraft !== aDraft) return bDraft - aDraft;
  }

  const aGenerated = new Date(a.generated_at || 0).getTime();
  const bGenerated = new Date(b.generated_at || 0).getTime();
  return bGenerated - aGenerated;
}

function pickFantasySlateRow(rows, options = {}) {
  const eligible = (rows || []).filter((row) => !isBackfilledSlate(row));
  if (!eligible.length) return null;

  return [...eligible].sort((a, b) => compareFantasySlateRows(a, b, options))[0];
}

async function loadFantasySlateDrivers(sb, slateId) {
  const { data: drivers } = await sb
    .from('fantasy_slate_drivers')
    .select('*')
    .eq('slate_id', slateId)
    .order('fantasy_tier_score', { ascending: false });

  return (drivers || []).map(normalizeSlateDriver);
}

export async function loadFantasySlateById(slateId) {
  const sb = supabase();
  if (!sb || slateId == null) return null;

  const { data: slate, error } = await sb
    .from('fantasy_slates')
    .select('*')
    .eq('id', Number(slateId))
    .maybeSingle();

  if (error || !slate) return null;

  const drivers = await loadFantasySlateDrivers(sb, slate.id);
  return enrichFantasyDraftPayload({
    slate,
    drivers,
  });
}

export async function loadFantasyDraftSlate(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb) return null;

  let query = sb.from('fantasy_slates').select('*');

  if (seasonId) query = query.eq('season_id', String(seasonId));
  if (raceNumber != null) query = query.eq('race_number', Number(raceNumber));

  const { data: rows, error } = await query;
  if (error || !rows?.length) return null;

  const slate = pickFantasySlateRow(rows, { preferDraft: true });
  if (!slate) return null;

  const drivers = await loadFantasySlateDrivers(sb, slate.id);
  return enrichFantasyDraftPayload({
    slate,
    drivers,
  });
}

async function loadFantasyDraftSlateForPublish(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb) return null;

  let query = sb.from('fantasy_slates').select('*').eq('status', 'draft');

  if (seasonId) query = query.eq('season_id', String(seasonId));
  if (raceNumber != null) query = query.eq('race_number', Number(raceNumber));

  const { data: rows, error } = await query;
  if (error || !rows?.length) return null;

  const slate = pickFantasySlateRow(rows);
  if (!slate) return null;

  const drivers = await loadFantasySlateDrivers(sb, slate.id);
  return enrichFantasyDraftPayload({
    slate,
    drivers,
  });
}

export async function enrichFantasyDraftPayload(payload = {}) {
  const slate = payload.slate || null;
  const seasonId = slate?.season_id || payload.seasonId || null;
  const raceNumber = slate?.race_number ?? payload.raceNumber ?? null;

  let priorMaps = {
    priorSalariesByDriver: new Map(),
    priorRaceNumber: null,
  };
  if (seasonId && raceNumber != null) {
    priorMaps = await loadPriorSlateSalaryMaps(seasonId, raceNumber);
  }

  const drivers = enrichFantasySlateDrivers(payload.drivers || [], priorMaps.priorSalariesByDriver);
  const analytics = summarizeFantasySlateAnalytics(drivers);
  analytics.priorSlateRaceNumber = priorMaps.priorRaceNumber;

  return {
    ...payload,
    drivers,
    analytics,
  };
}

export async function generateFantasyDraftSlate(options = {}) {
  const settings = await getSettings();
  const seasonId = String(settings.seasonId || '27987');
  const now = new Date();

  const scheduleHtml = await fetchHtml(settings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));

  let targetRace = null;
  if (options.raceNumber != null) {
    targetRace = scheduleRaces.find(
      (race) =>
        !race.nonPoints &&
        race.officialPointsRaceNumber === Number(options.raceNumber)
    );
  }
  if (!targetRace) {
    const next = findEffectiveNextPointsRace(scheduleRaces, { now, settings });
    targetRace = next.race;
  }

  if (!targetRace) {
    throw new Error('No upcoming points race found on the schedule.');
  }

  const raceNumber = targetRace.officialPointsRaceNumber;

  const existingSlate = await loadFantasySlateForRace(seasonId, raceNumber);
  if (
    existingSlate?.slate?.status === 'published' &&
    !options.forceRegenerate &&
    !options.allowPublishedUpdate
  ) {
    return enrichFantasyDraftPayload({
      ...existingSlate,
      existingSlateFound: true,
      slateId: existingSlate.slate.id,
      raceNumber,
      actionTaken: 'loaded_existing',
    });
  }

  const poolContext = await loadEligibleFantasyStandingsPool({
    raceNumber,
    settings,
    now,
    scheduleRaces,
  });
  const standings = poolContext.eligibleRows;
  const standingsResult = poolContext.standingsResult;
  const profiles = poolContext.profiles;
  const raceDebug = poolContext.raceDebug;

  if (!standings.length) {
    throw new Error('No active standings drivers with race starts available for fantasy salary generation.');
  }

  const driverLookup = buildDriverLookup(standings, profiles);
  const alignedRaces = getAlignedRaceFinishes(
    scheduleRaces,
    raceNumber,
    standingsResult.schedules,
    driverLookup
  );

  const recentResults = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3).map((race) => ({
    raceNumber: race.officialPointsRaceNumber,
    scheduleRow: race.scheduleRow,
    date: race.date,
    track: race.track,
    winner: race.winner,
  }));

  const factualGrounding = buildFactualGroundingContext({
    standings,
    scheduleRaces,
    raceNumber,
    schedules: standingsResult.schedules,
    driverLookup,
    recentResults,
    manualRaceNotes: '',
    transcriptSummary: '',
    seasonCatalog: null,
  });

  const allAligned = alignAllCompletedPointsRaces(
    scheduleRaces,
    standingsResult.schedules,
    driverLookup,
    { now, settings }
  );
  const driverIds = standings.map((row) => String(row.driverId));
  const driverRaceResultsByDriver = buildDriverRaceResultsByDriver(
    allAligned,
    standingsResult.schedules,
    driverIds
  );
  const leagueId = String(standingsResult.lss?.league_id || settings.leagueId || '1783');
  const driverCareerRaceRowsByDriver = await buildDriverCareerRaceResultsByDriver(
    driverIds,
    leagueId
  );

  const priorMaps = await loadPriorPublishedSlateMaps(seasonId, raceNumber);
  const upcomingTrack = targetRace.track || 'TBD';
  const trackType = resolveTrackType(upcomingTrack);
  const lockTime = String(settings.serverOpenTime ?? settings.raceStartTime ?? '').trim();

  const drivers = buildFantasyDriverSalaries({
    standings,
    groundingByDriver: factualGrounding.drivers,
    alignedRaces,
    schedules: standingsResult.schedules,
    upcomingTrack,
    driverRaceResultsByDriver,
    driverCareerRaceRowsByDriver,
    priorSalariesByDriver: priorMaps.priorSalariesByDriver,
    priorTierScoresByDriver: priorMaps.priorTierScoresByDriver,
    slateRaceNumber: raceNumber,
    scheduleRaces,
    allAlignedRaces: allAligned,
    settings,
    now,
  }).sort((a, b) => b.fantasyTierScore - a.fantasyTierScore);

  const meta = {
    ...summarizeFantasySlateMeta(drivers),
    priorPublishedRaceNumber: priorMaps.priorRaceNumber,
    standingsScheduleId: raceDebug.standingsScheduleId,
    alignedRecentRaceCount: alignedRaces.length,
    completedRaceHistoryCount: allAligned.length,
  };

  const slateRow = {
    season_id: seasonId,
    race_number: raceNumber,
    schedule_id: extractScheduleIdFromRace(targetRace),
    track: upcomingTrack,
    track_type: trackType,
    lock_time: lockTime || null,
    model_version: FANTASY_MODEL_VERSION,
    meta,
  };

  const priorDisplayMaps = await loadPriorSlateSalaryMaps(seasonId, raceNumber);
  const enrichedDrivers = enrichFantasySlateDrivers(
    drivers,
    priorDisplayMaps.priorSalariesByDriver
  );

  const saved = await saveDraftSlate(slateRow, enrichedDrivers, {
    allowPublishedUpdate: options.allowPublishedUpdate === true || options.forceRegenerate === true,
  });

  if (saved?.slate?.id) {
    await refreshFantasyDriverPoolMetadata(seasonId, { raceNumber }).catch(() => {});
  }

  return enrichFantasyDraftPayload({
    slate: saved.slate,
    drivers: enrichedDrivers,
    meta,
    targetRace: {
      raceNumber,
      track: upcomingTrack,
      date: targetRace.date || null,
      lockTime: lockTime || null,
    },
    existingSlateFound: Boolean(saved.existingSlateFound),
    slateId: saved.slate?.id ?? null,
    actionTaken: saved.actionTaken || 'created_draft',
  });
}

export async function publishFantasySlate(options = {}) {
  const settings = await getSettings();
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const raceNumber = options.raceNumber != null ? Number(options.raceNumber) : null;
  const requestedSlateId =
    options.slateId != null && Number.isFinite(Number(options.slateId))
      ? Number(options.slateId)
      : null;

  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  let draft = null;
  let targetSlateId = requestedSlateId;

  if (requestedSlateId != null) {
    const { data: row, error: rowError } = await sb
      .from('fantasy_slates')
      .select('*')
      .eq('id', requestedSlateId)
      .maybeSingle();

    if (rowError || !row) {
      throw new Error(`Fantasy slate ${requestedSlateId} not found.`);
    }
    if (String(row.season_id) !== seasonId) {
      throw new Error(`Fantasy slate ${requestedSlateId} does not belong to the current season.`);
    }
    if (isBackfilledSlate(row)) {
      throw new Error('Historical backfill slates cannot be published from admin.');
    }
    if (row.status !== 'draft') {
      throw new Error(`Fantasy slate ${requestedSlateId} is not a draft slate.`);
    }

    draft = await loadFantasySlateById(requestedSlateId);
    targetSlateId = requestedSlateId;
  } else {
    draft = await loadFantasyDraftSlateForPublish(seasonId, raceNumber);
    targetSlateId = draft?.slate?.id ?? null;
  }

  if (!draft?.slate?.id || targetSlateId == null) {
    throw new Error('No draft fantasy slate found to publish.');
  }

  const now = new Date().toISOString();
  const updates = {
    status: 'published',
    published_at: now,
    updated_at: now,
  };

  const lockFields = await computeFantasyLockAt({
    raceNumber: draft.slate.race_number,
    lockTimeDisplay: options.lockTime ?? draft.slate.lock_time ?? DEFAULT_FANTASY_LOCK_DISPLAY,
    lockAtOverride: options.lockAt,
    useLockOverride: options.useLockOverride === true,
    seasonId,
    settings,
  });
  updates.lock_time = lockFields.lock_time;
  updates.lock_at = lockFields.lock_at;

  const { data, error } = await sb
    .from('fantasy_slates')
    .update(updates)
    .eq('id', targetSlateId)
    .eq('status', 'draft')
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to publish fantasy slate.');
  }

  if (Number(data.id) !== targetSlateId) {
    throw new Error('Published slate id mismatch.');
  }

  return {
    ...enrichFantasyDraftPayload({
      slate: data,
      drivers: draft.drivers || [],
    }),
    lockPreview: lockFields,
  };
}

export async function updateFantasySlateLock(options = {}) {
  const settings = await getSettings();
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const raceNumber = options.raceNumber != null ? Number(options.raceNumber) : null;
  const slateId =
    options.slateId != null && Number.isFinite(Number(options.slateId))
      ? Number(options.slateId)
      : null;

  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  let slate = null;

  if (slateId != null) {
    const { data, error: slateError } = await sb
      .from('fantasy_slates')
      .select('*')
      .eq('id', slateId)
      .maybeSingle();

    if (slateError || !data) throw new Error(`Fantasy slate ${slateId} not found.`);
    if (String(data.season_id) !== seasonId) {
      throw new Error(`Fantasy slate ${slateId} does not belong to the current season.`);
    }
    slate = data;
  } else {
    const payload = await loadFantasyDraftSlate(seasonId, raceNumber);
    slate = payload?.slate || null;
  }

  if (!slate) throw new Error('No fantasy slate found to update lock time.');

  const lockFields = await computeFantasyLockAt({
    raceNumber: slate.race_number,
    lockTimeDisplay: options.lockTime ?? slate.lock_time ?? DEFAULT_FANTASY_LOCK_DISPLAY,
    lockAtOverride: options.lockAt,
    useLockOverride: options.useLockOverride === true,
    seasonId,
    settings,
  });

  const updates = {
    updated_at: new Date().toISOString(),
    lock_time: lockFields.lock_time,
    lock_at: lockFields.lock_at,
  };

  const { data, error } = await sb.from('fantasy_slates').update(updates).eq('id', slate.id).select('*').single();
  if (error) throw new Error(error.message || 'Failed to update lock time.');

  return { slate: data, lockPreview: lockFields };
}
