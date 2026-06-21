import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getCompletedPointsRaces } from './_schedule-points-races.js';
import { alignFinishRacesWithTrace } from './_power-rankings-schedule-alignment.js';
import { extractFinishRacesFromSchedules } from './_simracerhub-schedule-results.js';
import { isDnfFinish } from './_power-rankings-scoring.js';

const DNF_FINISH_THRESHOLD = 35;

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

export function tracksLikelyMatch(left, right) {
  const a = normalizeTrackName(left);
  const b = normalizeTrackName(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const aTokens = trackTokens(left);
  const bTokens = trackTokens(right);
  if (!aTokens.length || !bTokens.length) return false;

  const overlap = aTokens.filter((token) => bTokens.includes(token)).length;
  return overlap >= Math.min(2, aTokens.length, bTokens.length);
}

export function resolveTrackMetadata(trackName) {
  const catalog = loadTracksCatalog()?.tracks || [];
  const normalized = normalizeTrackName(trackName);

  for (const entry of catalog) {
    if (tracksLikelyMatch(trackName, entry.trackName)) {
      return entry;
    }
    for (const alias of entry.aliases || []) {
      if (tracksLikelyMatch(trackName, alias)) {
        return entry;
      }
    }
  }

  return {
    trackName: String(trackName || '').trim(),
    aliases: [],
    trackType: 'intermediate',
  };
}

export function resolveTrackType(trackName) {
  return resolveTrackMetadata(trackName).trackType || 'intermediate';
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
  return {
    track: alignedRace.track,
    pointsRaceNumber: alignedRace.pointsRaceNumber,
    finish,
    lapsLed: result?.lapsLed ?? null,
    dnf: isDnfFinish(finish),
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
  return rows.filter((row) => resolveTrackType(row.track) === trackType);
}

function filterRowsByExactTrack(rows, upcomingTrack) {
  return rows.filter((row) => tracksLikelyMatch(row.track, upcomingTrack));
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
        reason: 'No track history available; neutral score applied.',
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

export function buildCareerTrackHistoryForDriver(driverRaceRows, upcomingTrack) {
  const exactRows = filterRowsByExactTrack(driverRaceRows, upcomingTrack);
  const trackMeta = resolveTrackMetadata(upcomingTrack);
  const trackType = trackMeta.trackType || 'intermediate';
  const similarRows = filterRowsByTrackType(driverRaceRows, trackType).filter(
    (row) => !tracksLikelyMatch(row.track, upcomingTrack)
  );

  const exactStats = aggregateRaceRows(exactRows);
  const similarStats = aggregateRaceRows(similarRows);

  let scope = 'exact_track';
  let stats = exactStats;
  let fallbackUsed = false;

  if (exactStats.starts < 2) {
    fallbackUsed = true;
    scope = exactStats.starts === 0 ? 'similar_track_type' : 'exact_track_blended';

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

  return {
    scope,
    fallbackUsed,
    similarTrackType: fallbackUsed ? trackType : null,
    upcomingTrack: trackMeta.trackName || upcomingTrack,
    exactTrackStarts: exactStats.starts,
    similarTrackStarts: similarStats.starts,
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
    score: scored.score,
    scoreDetails: scored.details,
  };
}

export function computeTrackDollarAdjustment(trackHistory) {
  const stats = trackHistory?.summary || {};
  const score = Number(trackHistory?.score);
  const dnfRate = Number(stats.dnfRate) || 0;

  let tier = 'neutral';
  let amount = 0;
  let reason = 'Neutral track history adjustment.';

  if (stats.starts >= 2 && score >= 88) {
    tier = 'career_track_ace';
    amount = 1500 + Math.round((score - 88) * 25);
    amount = Math.min(2000, Math.max(1000, amount));
    reason = `Career track ace profile (${stats.starts} starts, score ${score}).`;
  } else if (score >= 72) {
    tier = 'good_track_history';
    amount = 500 + Math.round((score - 72) * 35);
    amount = Math.min(1000, Math.max(500, amount));
    reason = `Good history at this track type (${stats.starts} relevant starts).`;
  } else if (score < 52) {
    tier = 'poor_history';
    amount = -500 - Math.round((52 - score) * 20);
    amount = Math.max(-1500, Math.min(-500, amount));
    reason = `Weak history at this track profile (${stats.starts} relevant starts).`;
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
