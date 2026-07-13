import { fetchHtml, getDriverProfiles, getSettings, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getPointsRaceByNumber,
} from './_schedule-points-races.js';
import { hasRaceResults } from './_race-date-status.js';
import { fetchStandingsRows, buildDriverLookup } from './_standings-rows.js';
import { getAlignedRaceFinishes } from './_power-rankings-results-audit.js';
import {
  extractOfficialRaceFinishes,
  findScheduleEntryByScheduleId,
} from './_simracerhub-schedule-results.js';
import { matchDriverIdByName } from './_power-rankings-recent-form.js';
import {
  isFantasyRaceComplete,
  resolveFantasySlateProgression,
} from './_fantasy-slate-progression.js';
import {
  DEFAULT_FANTASY_RACE_SCORING_CONFIG,
  FANTASY_RACE_SCORING_VERSION,
  finishPositionPoints,
  resolveFantasyRaceScoringConfig,
} from './_fantasy-race-scoring-config.js';

async function loadSlateRowById(slateId) {
  const sb = supabase();
  if (!sb || !slateId) return null;
  const { data, error } = await sb.from('fantasy_slates').select('*').eq('id', slateId).maybeSingle();
  if (error || !data) return null;
  return data;
}

async function listSubmittedLineupsForSlateId(slateId) {
  const { listSubmittedLineupsForSlate } = await import('./_fantasy-lineups.js');
  return listSubmittedLineupsForSlate(slateId);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSlateMeta(row) {
  const meta = row?.meta;
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta) || {};
    } catch {
      return {};
    }
  }
  return meta;
}

export function getSlateScoringMeta(slateRow) {
  return parseSlateMeta(slateRow)?.scoring || null;
}

function buildScoringMetaPatch(existingMeta, scoringPatch) {
  return {
    ...(existingMeta || {}),
    scoring: {
      ...(existingMeta?.scoring || {}),
      ...scoringPatch,
    },
  };
}

export function calculateDriverRacePoints(result, config = DEFAULT_FANTASY_RACE_SCORING_CONFIG) {
  if (!result?.finish) {
    return {
      basePoints: 0,
      bonusPoints: 0,
      penaltyPoints: 0,
      totalPoints: Number(config.dnsPoints ?? 0),
      breakdown: { status: 'dns', reason: 'No official finish recorded' },
    };
  }

  const finish = Number(result.finish);
  const start = Number(result.startingPos);
  const basePoints = finishPositionPoints(finish, config);
  let bonusPoints = 0;
  const bonusBreakdown = {};

  if (finish === 1) {
    bonusPoints += Number(config.bonuses?.win ?? 0);
    bonusBreakdown.win = Number(config.bonuses?.win ?? 0);
  }
  if (finish <= 5) {
    bonusPoints += Number(config.bonuses?.top5 ?? 0);
    bonusBreakdown.top5 = Number(config.bonuses?.top5 ?? 0);
  }
  if (finish <= 10) {
    bonusPoints += Number(config.bonuses?.top10 ?? 0);
    bonusBreakdown.top10 = Number(config.bonuses?.top10 ?? 0);
  }

  let positionsGained = null;
  if (Number.isFinite(start) && start > 0 && Number.isFinite(finish)) {
    positionsGained = start - finish;
    if (positionsGained > 0) {
      const gainedBonus = positionsGained * Number(config.bonuses?.positionGainedPer ?? 0);
      bonusPoints += gainedBonus;
      bonusBreakdown.positionsGained = gainedBonus;
    } else if (positionsGained < 0 && Number(config.bonuses?.positionLostPer) > 0) {
      const lostPenalty = Math.abs(positionsGained) * Number(config.bonuses.positionLostPer);
      bonusBreakdown.positionsLost = -lostPenalty;
      bonusPoints -= lostPenalty;
    }
  }

  let penaltyPoints = 0;
  if (config.penalties?.enabled && Number.isFinite(result.incidents)) {
    penaltyPoints = result.incidents * Number(config.penalties.incidentPer ?? 0);
  }

  const totalPoints = Number((basePoints + bonusPoints - penaltyPoints).toFixed(2));

  return {
    basePoints,
    bonusPoints: Number(bonusPoints.toFixed(2)),
    penaltyPoints: Number(penaltyPoints.toFixed(2)),
    totalPoints,
    positionsGained,
    breakdown: {
      finish,
      start: Number.isFinite(start) ? start : null,
      basePoints,
      bonuses: bonusBreakdown,
      penalties: penaltyPoints ? { incidents: penaltyPoints } : null,
    },
  };
}

export function rankCompetition(lineupTotals = []) {
  const sorted = [...lineupTotals].sort((a, b) => b.totalPoints - a.totalPoints);
  let lastPoints = null;
  let lastRank = 0;
  let index = 0;

  return sorted.map((row) => {
    index += 1;
    if (lastPoints === null || row.totalPoints < lastPoints) {
      lastRank = index;
      lastPoints = row.totalPoints;
    }
    return { ...row, rank: lastRank };
  });
}

export function matchFantasyDriverToResult(driver, context = {}) {
  const driverId = String(driver.driverId || driver.driver_id || '').trim();
  const driverName = driver.driverName || driver.driver_name || '';
  const carNumber = String(driver.carNumber || driver.car_number || '').trim();
  const warnings = [];

  if (driverId && context.driverResults?.[driverId]) {
    return {
      matched: true,
      method: 'driver_id',
      driverId,
      result: context.driverResults[driverId],
    };
  }

  const profile = context.profileByDriverId?.get(driverId) || null;
  if (profile?.iracing_id != null) {
    const iracingKey = String(profile.iracing_id);
    if (context.driverResults?.[iracingKey]) {
      return {
        matched: true,
        method: 'iracing_id',
        driverId,
        result: context.driverResults[iracingKey],
      };
    }
  }

  const exactNameId = matchDriverIdByName(driverName, context.driverLookup || new Map());
  if (exactNameId && context.driverResults?.[exactNameId]) {
    return {
      matched: true,
      method: 'normalized_name',
      driverId: exactNameId,
      result: context.driverResults[exactNameId],
    };
  }

  if (carNumber) {
    for (const [candidateId, result] of Object.entries(context.driverResults || {})) {
      const lookupDriver = context.driverLookup?.get(String(candidateId));
      if (!lookupDriver) continue;
      if (String(lookupDriver.carNumber || '').trim() !== carNumber) continue;
      if (normalizeName(lookupDriver.driverName) === normalizeName(driverName)) {
        return {
          matched: true,
          method: 'car_number_name',
          driverId: candidateId,
          result,
        };
      }
    }
  }

  warnings.push(`Unresolved driver mapping for ${driverName || driverId || 'unknown driver'}`);
  console.warn('[FantasyScoring] unresolved driver', {
    driverId,
    driverName,
    carNumber,
    raceNumber: context.raceNumber ?? null,
  });

  return {
    matched: false,
    method: 'unresolved',
    driverId,
    result: null,
    warnings,
  };
}

export async function loadOfficialRaceResultsContext({
  raceNumber,
  settings = null,
  scheduleRaces = null,
}) {
  const resolvedSettings = settings || (await getSettings());
  let races = scheduleRaces;
  if (!races?.length) {
    const html = await fetchHtml(resolvedSettings.scheduleUrl);
    races = enrichScheduleRaces(parseScheduleRacesFromHtml(html));
  }

  const race = getPointsRaceByNumber(races, Number(raceNumber));
  if (!race) {
    return {
      ready: false,
      reason: `Race ${raceNumber} not found on schedule.`,
      race: null,
      driverResults: {},
      alignment: null,
    };
  }

  if (!hasRaceResults(race)) {
    return {
      ready: false,
      reason: 'Official race results are not available yet.',
      race,
      driverResults: {},
      alignment: null,
    };
  }

  const raceDebug = buildRaceNumberDebug(races, Number(raceNumber), {
    now: new Date(),
    settings: resolvedSettings,
  });
  const standingsResult = await fetchStandingsRows(
    resolvedSettings,
    raceDebug.standingsScheduleId,
  );
  const profiles = await getDriverProfiles();
  const driverLookup = buildDriverLookup(standingsResult.rows, profiles);
  const alignedRaces = getAlignedRaceFinishes(
    races,
    Number(raceNumber),
    standingsResult.schedules,
    driverLookup,
  );
  const alignment =
    alignedRaces.find((row) => Number(row.pointsRaceNumber) === Number(raceNumber)) || null;

  let driverResults = {};
  if (alignment?.schedulesApiScheduleId) {
    const scheduleEntry = findScheduleEntryByScheduleId(
      standingsResult.schedules,
      alignment.schedulesApiScheduleId,
    );
    if (scheduleEntry) {
      driverResults = extractOfficialRaceFinishes(scheduleEntry).driverResults || {};
    }
  }

  if (!Object.keys(driverResults).length && alignment?.finishes) {
    for (const [driverId, finish] of Object.entries(alignment.finishes)) {
      driverResults[driverId] = {
        finish: Number(finish),
        startingPos: null,
        incidents: null,
      };
    }
  }

  return {
    ready: Object.keys(driverResults).length > 0,
    reason: Object.keys(driverResults).length
      ? null
      : 'Official results exist on schedule but SimRacerHub race finishes could not be aligned.',
    race,
    driverResults,
    alignment,
    driverLookup,
    profileByDriverId: new Map(profiles.map((row) => [String(row.driver_id), row])),
    standingsScheduleId: raceDebug.standingsScheduleId,
  };
}

async function upsertDriverScores(sb, slateId, raceNumber, rows, scoringVersion) {
  for (const row of rows) {
    const { error } = await sb.from('fantasy_driver_scores').upsert(
      {
        slate_id: slateId,
        driver_id: row.driverId,
        race_number: raceNumber,
        finish_position: row.finishPosition,
        start_position: row.startPosition,
        positions_gained: row.positionsGained,
        base_points: row.basePoints,
        bonus_points: row.bonusPoints,
        penalty_points: row.penaltyPoints,
        total_points: row.totalPoints,
        breakdown: row.breakdown,
        scoring_version: scoringVersion,
        scored_at: new Date().toISOString(),
      },
      { onConflict: 'slate_id,driver_id' },
    );
    if (error) throw new Error(error.message || 'Failed to save driver scores.');
  }
}

async function upsertLineupScores(sb, slateId, raceNumber, rows, scoringVersion) {
  for (const row of rows) {
    const { error } = await sb.from('fantasy_lineup_scores').upsert(
      {
        slate_id: slateId,
        lineup_id: row.lineupId,
        user_id: row.userId,
        race_number: raceNumber,
        total_points: row.totalPoints,
        rank: row.rank,
        breakdown: row.breakdown,
        scoring_version: scoringVersion,
        scored_at: new Date().toISOString(),
      },
      { onConflict: 'lineup_id,slate_id' },
    );
    if (error) throw new Error(error.message || 'Failed to save lineup scores.');
  }
}

async function updateSlateScoringMeta(sb, slateRow, scoringMeta) {
  const existingMeta = parseSlateMeta(slateRow);
  const { error } = await sb
    .from('fantasy_slates')
    .update({
      meta: buildScoringMetaPatch(existingMeta, scoringMeta),
      updated_at: new Date().toISOString(),
    })
    .eq('id', slateRow.id);
  if (error) throw new Error(error.message || 'Failed to update slate scoring metadata.');
}

export async function scoreFantasySlate(options = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Database not configured.');

  const settings = options.settings || (await getSettings());
  const config = resolveFantasyRaceScoringConfig(settings);
  const scoringVersion = config.version || FANTASY_RACE_SCORING_VERSION;

  let slateRow = null;
  if (options.slateId) {
    slateRow = await loadSlateRowById(options.slateId);
  } else if (options.raceNumber != null) {
    const { data } = await sb
      .from('fantasy_slates')
      .select('*')
      .eq('season_id', String(options.seasonId || settings.seasonId || '27987'))
      .eq('race_number', Number(options.raceNumber))
      .eq('status', 'published')
      .maybeSingle();
    slateRow = data || null;
  }

  if (!slateRow) {
    throw new Error('Published fantasy slate not found for scoring.');
  }

  const seasonId = String(slateRow.season_id);
  const raceNumber = Number(slateRow.race_number);
  const progression = await resolveFantasySlateProgression(seasonId, { settings });
  const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, raceNumber);

  if (!raceComplete && !options.adminOverride) {
    throw new Error('Race is not complete. Scoring requires official results or admin override.');
  }

  const resultsContext = await loadOfficialRaceResultsContext({
    raceNumber,
    settings,
    scheduleRaces: progression.scheduleRaces,
  });

  if (!resultsContext.ready && !options.adminOverride) {
    throw new Error(resultsContext.reason || 'Official results are not ready for scoring.');
  }

  const lineups = await listSubmittedLineupsForSlateId(slateRow.id);
  const warnings = [];
  const unresolvedDrivers = [];
  const driverScoreRows = [];
  const scoredDrivers = new Map();

  const uniqueDrivers = new Map();
  for (const lineup of lineups) {
    for (const driver of lineup.drivers || []) {
      uniqueDrivers.set(String(driver.driverId), driver);
    }
  }

  for (const driver of uniqueDrivers.values()) {
    const match = matchFantasyDriverToResult(driver, {
      ...resultsContext,
      raceNumber,
    });
    if (match.warnings?.length) warnings.push(...match.warnings);
    if (!match.matched) {
      unresolvedDrivers.push({
        driverId: driver.driverId,
        driverName: driver.driverName,
      });
      scoredDrivers.set(String(driver.driverId), {
        totalPoints: Number(config.dnsPoints ?? 0),
        breakdown: { status: 'unresolved', points: Number(config.dnsPoints ?? 0) },
      });
      continue;
    }

    const computed = calculateDriverRacePoints(match.result, config);
    scoredDrivers.set(String(driver.driverId), computed);
    driverScoreRows.push({
      driverId: String(driver.driverId),
      finishPosition: match.result?.finish ?? null,
      startPosition: match.result?.startingPos ?? null,
      positionsGained: computed.positionsGained,
      basePoints: computed.basePoints,
      bonusPoints: computed.bonusPoints,
      penaltyPoints: computed.penaltyPoints,
      totalPoints: computed.totalPoints,
      breakdown: computed.breakdown,
    });
  }

  const lineupTotals = lineups.map((lineup) => {
    const driverBreakdown = (lineup.drivers || []).map((driver) => {
      const scored = scoredDrivers.get(String(driver.driverId)) || {
        totalPoints: Number(config.dnsPoints ?? 0),
        breakdown: { status: 'missing' },
      };
      return {
        driverId: driver.driverId,
        driverName: driver.driverName,
        points: scored.totalPoints,
        breakdown: scored.breakdown,
      };
    });
    const totalPoints = Number(
      driverBreakdown.reduce((sum, row) => sum + Number(row.points || 0), 0).toFixed(2),
    );
    return {
      lineupId: lineup.lineupId,
      userId: lineup.userId,
      displayName: lineup.displayName,
      totalPoints,
      breakdown: { drivers: driverBreakdown },
    };
  });

  const rankedLineups = rankCompetition(lineupTotals);

  await upsertDriverScores(sb, slateRow.id, raceNumber, driverScoreRows, scoringVersion);
  await upsertLineupScores(sb, slateRow.id, raceNumber, rankedLineups, scoringVersion);

  const status = unresolvedDrivers.length ? 'needs_review' : 'scored';
  const scoringMeta = {
    status,
    scoredAt: new Date().toISOString(),
    scoringVersion,
    lineupCount: lineups.length,
    driverCount: driverScoreRows.length,
    unresolvedDrivers,
    warnings,
    source: options.source || 'manual',
    resultsReady: resultsContext.ready,
    alignmentMethod: resultsContext.alignment?.alignmentMethod || null,
  };

  await updateSlateScoringMeta(sb, slateRow, scoringMeta);

  return {
    slateId: slateRow.id,
    raceNumber,
    seasonId,
    status,
    scoringVersion,
    lineupCount: lineups.length,
    scoredLineups: rankedLineups.length,
    unresolvedDrivers,
    warnings,
    lineups: rankedLineups,
    config,
  };
}

export async function getFantasyRaceScoringStatus(options = {}) {
  const settings = options.settings || (await getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const sb = supabase();

  let slateRow = null;
  if (options.slateId) {
    slateRow = await loadSlateRowById(options.slateId);
  } else if (options.raceNumber != null) {
    if (!sb) return { status: 'not_ready', reason: 'Database not configured.' };
    const { data } = await sb
      .from('fantasy_slates')
      .select('*')
      .eq('season_id', seasonId)
      .eq('race_number', Number(options.raceNumber))
      .eq('status', 'published')
      .maybeSingle();
    slateRow = data || null;
  } else {
    const progression = await resolveFantasySlateProgression(seasonId, { settings });
    slateRow = progression.archivedSlateRow || progression.activeSlateRow || null;
  }

  if (!slateRow) {
    return {
      status: 'not_ready',
      reason: 'No published fantasy slate found.',
      slate: null,
    };
  }

  const progression = await resolveFantasySlateProgression(seasonId, { settings });
  const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slateRow.race_number);
  const scoringMeta = getSlateScoringMeta(slateRow);
  const lineups = sb ? await listSubmittedLineupsForSlateId(slateRow.id) : [];
  const resultsContext = await loadOfficialRaceResultsContext({
    raceNumber: slateRow.race_number,
    settings,
    scheduleRaces: progression.scheduleRaces,
  });

  let status = 'not_ready';
  if (scoringMeta?.status === 'scored') status = 'scored';
  else if (scoringMeta?.status === 'needs_review') status = 'needs_review';
  else if (raceComplete && resultsContext.ready) status = 'ready';

  return {
    status,
    raceComplete,
    resultsReady: resultsContext.ready,
    resultsReason: resultsContext.reason || null,
    scoringMeta,
    config: resolveFantasyRaceScoringConfig(settings),
    slate: {
      id: slateRow.id,
      raceNumber: slateRow.race_number,
      track: slateRow.track,
      seasonId: slateRow.season_id,
    },
    lineupCount: lineups.length,
    unresolvedDrivers: scoringMeta?.unresolvedDrivers || [],
    warnings: scoringMeta?.warnings || [],
    alignmentMethod: resultsContext.alignment?.alignmentMethod || null,
  };
}

export async function loadFantasyLineupScoresForSlate(slateId) {
  const sb = supabase();
  if (!sb || !slateId) return [];

  const { data, error } = await sb
    .from('fantasy_lineup_scores')
    .select('*')
    .eq('slate_id', Number(slateId))
    .order('rank', { ascending: true });

  if (error || !data?.length) return [];
  return data;
}

export async function loadFantasySeasonPointTotals(seasonId) {
  const sb = supabase();
  if (!sb) return new Map();

  const { data: slates } = await sb
    .from('fantasy_slates')
    .select('id')
    .eq('season_id', String(seasonId))
    .eq('status', 'published');

  const slateIds = (slates || []).map((row) => row.id);
  if (!slateIds.length) return new Map();

  const { data, error } = await sb
    .from('fantasy_lineup_scores')
    .select('user_id, total_points, race_number, slate_id')
    .in('slate_id', slateIds);

  if (error || !data?.length) return new Map();

  const totals = new Map();
  for (const row of data) {
    const key = String(row.user_id);
    totals.set(key, Number((totals.get(key) || 0) + Number(row.total_points || 0)));
  }
  return totals;
}

export async function maybeAutoScoreFantasySlates(seasonId, options = {}) {
  const settings = options.settings || (await getSettings());
  const progression = await resolveFantasySlateProgression(seasonId, { settings });
  const candidates = [];

  if (options.raceNumber != null) {
    const sb = supabase();
    if (sb) {
      const { data } = await sb
        .from('fantasy_slates')
        .select('*')
        .eq('season_id', String(seasonId))
        .eq('race_number', Number(options.raceNumber))
        .eq('status', 'published')
        .maybeSingle();
      if (data) candidates.push(data);
    }
  } else {
    if (progression.archivedSlateRow) candidates.push(progression.archivedSlateRow);
  }

  const results = [];
  for (const slate of candidates) {
    const meta = getSlateScoringMeta(slate);
    if (meta?.status === 'scored' && !(meta?.unresolvedDrivers || []).length) {
      results.push({ slateId: slate.id, skipped: true, reason: 'already_scored' });
      continue;
    }
    const raceComplete = isFantasyRaceComplete(progression.scheduleRaces, slate.race_number);
    if (!raceComplete) {
      results.push({ slateId: slate.id, skipped: true, reason: 'race_not_complete' });
      continue;
    }
    try {
      const scored = await scoreFantasySlate({
        slateId: slate.id,
        seasonId,
        settings,
        source: 'auto',
      });
      results.push({ slateId: slate.id, skipped: false, scored });
    } catch (error) {
      results.push({
        slateId: slate.id,
        skipped: false,
        error: error.message || 'auto_score_failed',
      });
    }
  }

  return results;
}
