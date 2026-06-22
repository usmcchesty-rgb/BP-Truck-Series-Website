import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { fetchDriverCareerRaceEntriesByDriver } from './_driver-career-history.js';
import { getCompletedPointsRaces } from './_schedule-points-races.js';
import { alignFinishRacesWithTrace } from './_power-rankings-schedule-alignment.js';
import { extractFinishRacesFromSchedules } from './_simracerhub-schedule-results.js';
import { isDnfFinish } from './_power-rankings-scoring.js';

/**
 * Career Track History (Phase 2):
 * - Source multi-season race rows from SimRacerHub driver_stats.php (league-scoped)
 * - Map track_config_id -> track_name via embedded configs payload
 * - Score with exact-track -> track-type -> neutral blend hierarchy
 */

const DNF_FINISH_THRESHOLD = 35;

const GENERIC_TRACK_TOKENS = new Set([
  'speedway',
  'international',
  'motor',
  'raceway',
  'park',
  'oval',
  'night',
  'cup',
  'nascar',
  'the',
  'w',
  'open',
  'dogleg',
  'dual',
  'pit',
  'roads',
  'short',
  'mile',
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
let tracksCatalogCache = null;

function loadTracksCatalog() {
  if (tracksCatalogCache) return tracksCatalogCache;
  const raw = readFileSync(join(__dirname, '../data/tracks.json'), 'utf8');
  tracksCatalogCache = JSON.parse(raw);
  return tracksCatalogCache;
}

export function normalizeTrackName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trackTokens(value) {
  return normalizeTrackName(value)
    .split(' ')
    .filter((token) => token.length > 2);
}

function distinctiveTokens(value) {
  return trackTokens(value).filter((token) => !GENERIC_TRACK_TOKENS.has(token));
}

function buildCatalogMatch(entry, matchMethod) {
  return {
    matchedTrackName: entry.trackName,
    matchedTrackType: entry.trackType || 'intermediate',
    matchMethod,
    catalogEntry: entry,
  };
}

function buildUnmatchedMatch(trackName) {
  const label = String(trackName || '').trim();
  return {
    matchedTrackName: label,
    matchedTrackType: 'intermediate',
    matchMethod: 'unmatched',
    catalogEntry: null,
  };
}

/**
 * Match a schedule/API track label to tracks.json.
 * Priority: exact name → exact alias → normalized contains → distinctive tokens only.
 * Generic tokens (speedway, international, motor, raceway, park, …) never drive a match alone.
 */
export function matchTrackToCatalog(trackName) {
  const catalog = loadTracksCatalog()?.tracks || [];
  const input = String(trackName || '').trim();
  const normalizedInput = normalizeTrackName(input);

  if (!normalizedInput) {
    return buildUnmatchedMatch(input);
  }

  for (const entry of catalog) {
    if (normalizeTrackName(entry.trackName) === normalizedInput) {
      return buildCatalogMatch(entry, 'exact_name');
    }
  }

  for (const entry of catalog) {
    for (const alias of entry.aliases || []) {
      if (normalizeTrackName(alias) === normalizedInput) {
        return buildCatalogMatch(entry, 'exact_alias');
      }
    }
  }

  for (const entry of catalog) {
    const normEntry = normalizeTrackName(entry.trackName);
    if (
      normEntry.length >= 6 &&
      (normalizedInput.includes(normEntry) || normEntry.includes(normalizedInput))
    ) {
      return buildCatalogMatch(entry, 'normalized_contains');
    }
    for (const alias of entry.aliases || []) {
      const normAlias = normalizeTrackName(alias);
      if (
        normAlias.length >= 4 &&
        (normalizedInput.includes(normAlias) || normAlias.includes(normalizedInput))
      ) {
        return buildCatalogMatch(entry, 'normalized_alias_contains');
      }
    }
  }

  let bestEntry = null;
  let bestOverlap = 0;
  const inputDistinct = distinctiveTokens(input);

  for (const entry of catalog) {
    const entryDistinct = new Set([
      ...distinctiveTokens(entry.trackName),
      ...(entry.aliases || []).flatMap((alias) => distinctiveTokens(alias)),
    ]);
    if (!entryDistinct.size || !inputDistinct.length) continue;

    const overlap = inputDistinct.filter((token) => entryDistinct.has(token)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestOverlap >= 1) {
    return buildCatalogMatch(bestEntry, 'distinctive_token');
  }

  return buildUnmatchedMatch(input);
}

export function tracksLikelyMatch(left, right) {
  const leftMatch = matchTrackToCatalog(left);
  const rightMatch = matchTrackToCatalog(right);

  if (leftMatch.matchMethod !== 'unmatched' && rightMatch.matchMethod !== 'unmatched') {
    return leftMatch.matchedTrackName === rightMatch.matchedTrackName;
  }

  const a = normalizeTrackName(left);
  const b = normalizeTrackName(right);
  return Boolean(a && b && a === b);
}

export function resolveTrackMetadata(trackName) {
  const match = matchTrackToCatalog(trackName);
  if (match.catalogEntry) {
    return {
      ...match.catalogEntry,
      matchedTrackName: match.matchedTrackName,
      matchedTrackType: match.matchedTrackType,
      matchMethod: match.matchMethod,
    };
  }

  return {
    trackName: match.matchedTrackName,
    aliases: [],
    trackType: match.matchedTrackType,
    matchedTrackName: match.matchedTrackName,
    matchedTrackType: match.matchedTrackType,
    matchMethod: match.matchMethod,
  };
}

export function resolveTrackType(trackName) {
  return matchTrackToCatalog(trackName).matchedTrackType || 'intermediate';
}

export function alignAllCompletedPointsRaces(scheduleRaces, schedules, driverLookup, options = {}) {
  const completedPoints = getCompletedPointsRaces(scheduleRaces, options);
  const pointsOnly = completedPoints.filter(
    (race) => race.officialPointsRaceNumber != null && race.winner
  );
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  return alignFinishRacesWithTrace(pointsOnly, finishRaces, driverLookup);
}

function raceResultForDriver(alignedRace, driverId, schedules) {
  const finish = alignedRace.finishes?.[String(driverId)];
  if (!Number.isFinite(finish)) return null;

  const result = alignedRace.driverResults?.[String(driverId)] || null;
  const trackMatch = matchTrackToCatalog(alignedRace.track);
  return {
    track: alignedRace.track,
    pointsRaceNumber: alignedRace.pointsRaceNumber,
    finish,
    lapsLed: result?.lapsLed ?? null,
    dnf: isDnfFinish(finish),
    matchedTrackName: trackMatch.matchedTrackName,
    matchedTrackType: trackMatch.matchedTrackType,
    matchMethod: trackMatch.matchMethod,
  };
}

export function buildDriverRaceResultsByDriver(alignedRaces, schedules, driverIds) {
  const byDriver = new Map();

  for (const driverId of driverIds) {
    const rows = [];
    for (const race of alignedRaces || []) {
      const row = raceResultForDriver(race, driverId, schedules);
      if (row) rows.push(row);
    }
    byDriver.set(String(driverId), rows);
  }

  return byDriver;
}

function aggregateRaceRows(rows = []) {
  const starts = rows.length;
  if (!starts) {
    return {
      starts: 0,
      averageFinish: null,
      bestFinish: null,
      wins: 0,
      top5s: 0,
      top10s: 0,
      lapsLed: 0,
      dnfCount: 0,
      dnfRate: null,
    };
  }

  const finishes = rows.map((row) => row.finish);
  const totalFinish = finishes.reduce((sum, value) => sum + value, 0);
  const wins = rows.filter((row) => row.finish === 1).length;
  const top5s = rows.filter((row) => row.finish >= 1 && row.finish <= 5).length;
  const top10s = rows.filter((row) => row.finish >= 1 && row.finish <= 10).length;
  const lapsLed = rows.reduce((sum, row) => sum + (Number(row.lapsLed) || 0), 0);
  const dnfCount = rows.filter((row) => row.dnf || row.finish >= DNF_FINISH_THRESHOLD).length;

  return {
    starts,
    averageFinish: Number((totalFinish / starts).toFixed(1)),
    bestFinish: Math.min(...finishes),
    wins,
    top5s,
    top10s,
    lapsLed,
    dnfCount,
    dnfRate: Number((dnfCount / starts).toFixed(2)),
  };
}

function filterRowsByTrackType(rows, trackType) {
  if (!trackType) return [];
  return rows.filter((row) => {
    const rowType = row.matchedTrackType || resolveTrackType(row.track);
    return rowType === trackType;
  });
}

function filterRowsByExactTrack(rows, upcomingTrack) {
  return rows.filter((row) => tracksLikelyMatch(row.track, upcomingTrack));
}

function buildSkippedRaceDiagnostics(alignedRaces, driverId) {
  if (!driverId || !Array.isArray(alignedRaces)) return [];

  return alignedRaces
    .filter((race) => !Number.isFinite(race.finishes?.[String(driverId)]))
    .map((race) => {
      const trackMatch = matchTrackToCatalog(race.track);
      return {
        pointsRaceNumber: race.pointsRaceNumber,
        track: race.track,
        skipReason: 'No finish in aligned race (DNP or schedules API gap)',
        matchedTrackName: trackMatch.matchedTrackName,
        matchedTrackType: trackMatch.matchedTrackType,
        matchMethod: trackMatch.matchMethod,
      };
    });
}

function invertFinishScore(finish, fieldSize = 30) {
  const f = Number(finish);
  if (!Number.isFinite(f) || f < 1) return 0;
  const size = Math.max(fieldSize, f, 20);
  return Math.min(100, Math.max(0, ((size - f + 1) / size) * 100));
}

export function scoreTrackHistoryStats(stats) {
  if (!stats?.starts) {
    return {
      score: 50,
      details: {
        reason: 'No career track history available; neutral score applied.',
      },
    };
  }

  const avgFinishScore = stats.averageFinish != null
    ? invertFinishScore(stats.averageFinish) * 0.35
    : 0;
  const winRate = stats.wins / stats.starts;
  const top5Rate = stats.top5s / stats.starts;
  const rateScore = (winRate * 60 + top5Rate * 40) * 0.25;
  const bestFinishScore = stats.bestFinish != null
    ? invertFinishScore(stats.bestFinish) * 0.15
    : 0;
  const lapsLedScore = Math.min(stats.lapsLed, 80) / 80 * 100 * 0.1;
  const dnfPenalty = (stats.dnfRate ?? 0) * 100 * 0.15;

  const raw = avgFinishScore + rateScore + bestFinishScore + lapsLedScore - dnfPenalty;
  const score = Math.min(100, Math.max(0, Number(raw.toFixed(2))));

  return {
    score,
    details: {
      avgFinishScore: Number(avgFinishScore.toFixed(2)),
      rateScore: Number(rateScore.toFixed(2)),
      bestFinishScore: Number(bestFinishScore.toFixed(2)),
      lapsLedScore: Number(lapsLedScore.toFixed(2)),
      dnfPenalty: Number(dnfPenalty.toFixed(2)),
    },
  };
}

const TRACK_HISTORY_NEUTRAL_SCORE = 50;
const EXACT_TRACK_CAREER_MIN = 3;
const TRACK_TYPE_CAREER_MIN = 5;
const DEFAULT_CAREER_LEAGUE_ID = '1783';

export function mapCareerEntryToRaceRow(entry) {
  const track = entry?.trackName || 'Unknown Track';
  const trackMatch = matchTrackToCatalog(track);

  return {
    track,
    seasonId: entry?.seasonId ?? null,
    finish: entry.finish,
    lapsLed: entry?.lapsLed ?? null,
    dnf: isDnfFinish(entry.finish),
    matchedTrackName: trackMatch.matchedTrackName,
    matchedTrackType: trackMatch.matchedTrackType,
    matchMethod: trackMatch.matchMethod,
    dataSource: 'career history',
  };
}

export function buildCareerRaceRowsFromEntries(entries = []) {
  return (entries || [])
    .map(mapCareerEntryToRaceRow)
    .filter((row) => row.track && Number.isFinite(row.finish));
}

export async function buildDriverCareerRaceResultsByDriver(
  driverIds = [],
  leagueId = DEFAULT_CAREER_LEAGUE_ID,
  options = {}
) {
  const entriesByDriver = await fetchDriverCareerRaceEntriesByDriver(driverIds, leagueId, options);
  const map = new Map();

  for (const [driverId, entries] of entriesByDriver.entries()) {
    map.set(String(driverId), buildCareerRaceRowsFromEntries(entries));
  }

  return map;
}

function filterRowsByTrackTypeIncludingExact(rows, trackType) {
  if (!trackType) return [];
  return rows.filter((row) => {
    const rowType = row.matchedTrackType || resolveTrackType(row.track);
    return rowType === trackType;
  });
}

function blendCareerTrackScoreTowardNeutral(actualScore, sampleSize, maxSample = TRACK_TYPE_CAREER_MIN) {
  const safeActual = Number.isFinite(Number(actualScore))
    ? Number(actualScore)
    : TRACK_HISTORY_NEUTRAL_SCORE;
  const size = Math.max(0, Number(sampleSize) || 0);

  if (size >= maxSample) {
    return {
      score: safeActual,
      neutralWeight: 0,
      actualWeight: 1,
      blendApplied: false,
    };
  }

  const neutralWeight = maxSample > 0 ? (maxSample - size) / maxSample : 1;
  const actualWeight = 1 - neutralWeight;
  const score = Number(
    (TRACK_HISTORY_NEUTRAL_SCORE * neutralWeight + safeActual * actualWeight).toFixed(2)
  );

  return {
    score,
    neutralWeight: Number(neutralWeight.toFixed(2)),
    actualWeight: Number(actualWeight.toFixed(2)),
    blendApplied: neutralWeight > 0,
  };
}

export function regressTrackHistoryScoreForSampleSize(actualScore, starts) {
  const sampleSize = Math.max(0, Number(starts) || 0);
  const actual = Number(actualScore);
  const safeActual = Number.isFinite(actual) ? actual : TRACK_HISTORY_NEUTRAL_SCORE;

  let neutralWeight = 0;
  if (sampleSize <= 0) neutralWeight = 1;
  else if (sampleSize === 1) neutralWeight = 0.75;
  else if (sampleSize === 2) neutralWeight = 0.5;
  else if (sampleSize === 3) neutralWeight = 0.25;

  const actualWeight = 1 - neutralWeight;
  const regressedScore = Number(
    (TRACK_HISTORY_NEUTRAL_SCORE * neutralWeight + safeActual * actualWeight).toFixed(2)
  );

  return {
    actualScore: safeActual,
    regressedScore,
    sampleSize,
    neutralWeight,
    actualWeight,
    regressionApplied: neutralWeight > 0,
  };
}

/** Phase 1 current-season track history (kept for audits/comparison). */
export function buildCurrentSeasonTrackHistoryForDriver(driverRaceRows, upcomingTrack, options = {}) {
  const { alignedRaces = null, driverId = null } = options;
  const exactRows = filterRowsByExactTrack(driverRaceRows, upcomingTrack);
  const upcomingMatch = matchTrackToCatalog(upcomingTrack);
  const trackType = upcomingMatch.matchedTrackType || 'intermediate';
  const similarRows = filterRowsByTrackType(driverRaceRows, trackType).filter(
    (row) => !tracksLikelyMatch(row.track, upcomingTrack)
  );

  const exactStats = aggregateRaceRows(exactRows);
  const similarStats = aggregateRaceRows(similarRows);

  let scoringScope = 'exact_track';
  let stats = exactStats;
  let fallbackUsed = false;

  if (exactStats.starts < 2) {
    fallbackUsed = true;
    scoringScope = exactStats.starts === 0 ? 'similar_track_type' : 'exact_track_blended';

    if (exactStats.starts === 0) {
      stats = similarStats.starts ? similarStats : exactStats;
    } else {
      const exactWeight = 0.5;
      const similarWeight = 0.5;
      const blendedStarts = exactStats.starts + similarStats.starts;
      stats = {
        starts: blendedStarts,
        averageFinish:
          blendedStarts > 0
            ? Number(
                (
                  (exactStats.averageFinish ?? 0) * exactStats.starts * exactWeight +
                  (similarStats.averageFinish ?? 0) * similarStats.starts * similarWeight
                ) /
                  Math.max(
                    exactStats.starts * exactWeight + similarStats.starts * similarWeight,
                    1
                  )
              ).toFixed(1)
            : exactStats.averageFinish,
        bestFinish:
          exactStats.bestFinish != null && similarStats.bestFinish != null
            ? Math.min(exactStats.bestFinish, similarStats.bestFinish)
            : exactStats.bestFinish ?? similarStats.bestFinish,
        wins: exactStats.wins + Math.round(similarStats.wins * similarWeight),
        top5s: exactStats.top5s + Math.round(similarStats.top5s * similarWeight),
        top10s: exactStats.top10s + Math.round(similarStats.top10s * similarWeight),
        lapsLed: exactStats.lapsLed + Math.round(similarStats.lapsLed * similarWeight),
        dnfCount: exactStats.dnfCount + Math.round(similarStats.dnfCount * similarWeight),
        dnfRate:
          blendedStarts > 0
            ? Number(
                (
                  (exactStats.dnfCount + similarStats.dnfCount * similarWeight) /
                  blendedStarts
                ).toFixed(2)
              )
            : exactStats.dnfRate,
      };
    }
  }

  const scored = scoreTrackHistoryStats(stats);
  const regression = regressTrackHistoryScoreForSampleSize(scored.score, stats.starts);
  const racesIncluded = driverRaceRows.map((row) => ({
    pointsRaceNumber: row.pointsRaceNumber,
    track: row.track,
    finish: row.finish,
    matchedTrackName: row.matchedTrackName,
    matchedTrackType: row.matchedTrackType,
    matchMethod: row.matchMethod,
    countsAsExact: tracksLikelyMatch(row.track, upcomingTrack),
    countsAsSimilar:
      (row.matchedTrackType || resolveTrackType(row.track)) === trackType &&
      !tracksLikelyMatch(row.track, upcomingTrack),
  }));
  const racesSkipped = buildSkippedRaceDiagnostics(alignedRaces, driverId);

  return {
    scope: scoringScope,
    historyScope: 'current_season',
    scoringScope,
    fallbackUsed,
    similarTrackType: fallbackUsed ? trackType : null,
    upcomingTrack: upcomingMatch.matchedTrackName || upcomingTrack,
    upcomingTrackMatch: {
      matchedTrackName: upcomingMatch.matchedTrackName,
      matchedTrackType: upcomingMatch.matchedTrackType,
      matchMethod: upcomingMatch.matchMethod,
    },
    trackTypeUsed: trackType,
    exactTrackStarts: exactStats.starts,
    similarTrackStarts: similarStats.starts,
    exactStarts: exactStats.starts,
    similarStarts: similarStats.starts,
    diagnostics: {
      exactTrackStarts: exactStats.starts,
      similarTrackStarts: similarStats.starts,
      trackTypeUsed: trackType,
      matchMethod: upcomingMatch.matchMethod,
      racesIncluded,
      racesSkipped,
    },
    summary: {
      starts: stats.starts,
      averageFinish: stats.averageFinish,
      bestFinish: stats.bestFinish,
      wins: stats.wins,
      top5s: stats.top5s,
      top10s: stats.top10s,
      lapsLed: stats.lapsLed,
      dnfRate: stats.dnfRate,
    },
    score: regression.regressedScore,
    actualTrackScore: regression.actualScore,
    scoreDetails: {
      ...scored.details,
      sampleSize: regression.sampleSize,
      regressionApplied: regression.regressionApplied,
      neutralWeight: regression.neutralWeight,
      actualWeight: regression.actualWeight,
      actualScore: regression.actualScore,
      regressedScore: regression.regressedScore,
    },
  };
}

export function buildCareerTrackHistoryForDriver(driverRaceRows, upcomingTrack, options = {}) {
  const upcomingMatch = matchTrackToCatalog(upcomingTrack);
  const trackType = upcomingMatch.matchedTrackType || 'intermediate';
  const exactRows = filterRowsByExactTrack(driverRaceRows, upcomingTrack);
  const trackTypeRows = filterRowsByTrackTypeIncludingExact(driverRaceRows, trackType);

  const exactStats = aggregateRaceRows(exactRows);
  const trackTypeStats = aggregateRaceRows(trackTypeRows);

  let historyScope = 'blended_neutral';
  let scoringScope = 'blended_neutral';
  let stats = trackTypeStats.starts ? trackTypeStats : exactStats;
  let fallbackUsed = false;
  let neutralBlend = null;

  if (exactStats.starts >= EXACT_TRACK_CAREER_MIN) {
    historyScope = 'career_track';
    scoringScope = 'career_track';
    stats = exactStats;
  } else {
    fallbackUsed = true;
    historyScope = 'career_track_type';
    scoringScope = 'career_track_type';
    stats = trackTypeStats.starts ? trackTypeStats : exactStats;

    if (trackTypeStats.starts < TRACK_TYPE_CAREER_MIN) {
      historyScope = 'blended_neutral';
      scoringScope = 'blended_neutral';
    }
  }

  const scored = scoreTrackHistoryStats(stats);
  const careerTrackHistoryRaw = scored.score;
  let careerTrackHistoryNormalized = careerTrackHistoryRaw;
  let regression = null;

  if (historyScope === 'blended_neutral') {
    neutralBlend = blendCareerTrackScoreTowardNeutral(
      careerTrackHistoryRaw,
      trackTypeStats.starts
    );
    careerTrackHistoryNormalized = neutralBlend.score;
  } else {
    regression = regressTrackHistoryScoreForSampleSize(careerTrackHistoryRaw, stats.starts);
    careerTrackHistoryNormalized = regression.regressedScore;
  }

  const racesIncluded = (driverRaceRows || []).map((row) => ({
    seasonId: row.seasonId ?? null,
    track: row.track,
    finish: row.finish,
    matchedTrackName: row.matchedTrackName,
    matchedTrackType: row.matchedTrackType,
    matchMethod: row.matchMethod,
    countsAsExact: tracksLikelyMatch(row.track, upcomingTrack),
    countsAsTrackType:
      (row.matchedTrackType || resolveTrackType(row.track)) === trackType,
  }));

  return {
    scope: scoringScope,
    historyScope,
    scoringScope,
    fallbackUsed,
    dataSource: 'career history',
    similarTrackType: fallbackUsed ? trackType : null,
    upcomingTrack: upcomingMatch.matchedTrackName || upcomingTrack,
    upcomingTrackMatch: {
      matchedTrackName: upcomingMatch.matchedTrackName,
      matchedTrackType: upcomingMatch.matchedTrackType,
      matchMethod: upcomingMatch.matchMethod,
    },
    trackTypeUsed: trackType,
    exactTrackStarts: exactStats.starts,
    similarTrackStarts: trackTypeStats.starts,
    exactStarts: exactStats.starts,
    similarStarts: trackTypeStats.starts,
    careerExactTrackStarts: exactStats.starts,
    careerTrackTypeStarts: trackTypeStats.starts,
    careerTrackWins: exactStats.wins,
    careerTrackTop5s: exactStats.top5s,
    careerTrackTop10s: exactStats.top10s,
    careerTrackAverageFinish: exactStats.averageFinish,
    careerTrackTypeWins: trackTypeStats.wins,
    careerTrackTypeTop5s: trackTypeStats.top5s,
    careerTrackTypeTop10s: trackTypeStats.top10s,
    careerTrackTypeAverageFinish: trackTypeStats.averageFinish,
    careerTrackHistoryRaw,
    careerTrackHistoryNormalized,
    diagnostics: {
      exactTrackStarts: exactStats.starts,
      similarTrackStarts: trackTypeStats.starts,
      careerExactTrackStarts: exactStats.starts,
      careerTrackTypeStarts: trackTypeStats.starts,
      trackTypeUsed: trackType,
      matchMethod: upcomingMatch.matchMethod,
      dataSource: 'career history',
      racesIncluded,
    },
    summary: {
      starts: stats.starts,
      averageFinish: stats.averageFinish,
      bestFinish: stats.bestFinish,
      wins: stats.wins,
      top5s: stats.top5s,
      top10s: stats.top10s,
      lapsLed: stats.lapsLed,
      dnfRate: stats.dnfRate,
    },
    score: careerTrackHistoryNormalized,
    actualTrackScore: careerTrackHistoryRaw,
    scoreDetails: {
      ...scored.details,
      sampleSize: stats.starts,
      regressionApplied: regression?.regressionApplied ?? false,
      neutralWeight: neutralBlend?.neutralWeight ?? regression?.neutralWeight ?? 0,
      actualWeight: neutralBlend?.actualWeight ?? regression?.actualWeight ?? 1,
      actualScore: careerTrackHistoryRaw,
      regressedScore: careerTrackHistoryNormalized,
      neutralBlendApplied: neutralBlend?.blendApplied ?? false,
      careerTrackHistoryRaw,
      careerTrackHistoryNormalized,
    },
  };
}

export function computeTrackDollarAdjustment(trackHistory) {
  const stats = trackHistory?.summary || {};
  const score = Number(trackHistory?.score);
  const dnfRate = Number(stats.dnfRate) || 0;

  let tier = 'neutral';
  let amount = 0;
  let reason = 'Neutral career track history adjustment.';

  if (stats.starts >= 2 && score >= 88) {
    tier = 'track_ace';
    amount = 1500 + Math.round((score - 88) * 25);
    amount = Math.min(2000, Math.max(1000, amount));
    reason = `Career track ace profile (${stats.starts} starts, score ${score}).`;
  } else if (score >= 72) {
    tier = 'good_track_history';
    amount = 500 + Math.round((score - 72) * 35);
    amount = Math.min(1000, Math.max(500, amount));
    reason = `Good career history at this track profile (${stats.starts} relevant starts).`;
  } else if (score < 52) {
    tier = 'poor_history';
    amount = -500 - Math.round((52 - score) * 20);
    amount = Math.max(-1500, Math.min(-500, amount));
    reason = `Weak career history at this track profile (${stats.starts} relevant starts).`;
  }

  if (dnfRate >= 0.35 && stats.starts >= 2) {
    const dnfPenalty = -Math.round(Math.min(500, dnfRate * 800));
    amount += dnfPenalty;
    reason += ` DNF-prone (${Math.round(dnfRate * 100)}% DNF rate, ${dnfPenalty}).`;
    tier = `${tier}_dnf_prone`;
  }

  return {
    tier,
    amount,
    reason: reason.trim(),
  };
}
