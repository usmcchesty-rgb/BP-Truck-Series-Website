import { fetchHtml, getDriverProfiles, getSettings } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getCompletedPointsRaces,
  getRecentPointsRaceResults,
} from './_schedule-points-races.js';
import { parseScheduleDateParts } from './_race-date-status.js';
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
} from './_fantasy-track-history.js';
import {
  buildFantasyDriverSalaries,
  FANTASY_MODEL_VERSION,
} from './_fantasy-salary-scoring.js';
import {
  finishPositionProxyPoints,
  LINEUP_BACKTEST_NOTICE,
  optimizeFantasyLineup,
} from './_fantasy-lineup-optimizer.js';

const SLATE_MAX_STANDINGS_POSITION = 30;
const LINEUP_SALARY_CAP = 50000;
const APPROXIMATION_NOTICE =
  'Approximate backtest — not locked pre-race simulation yet.';

export function simulatedNowForRace(race, fallbackNow) {
  const parts = parseScheduleDateParts(race?.date);
  if (!parts?.year || !parts?.month || !parts?.day) return fallbackNow;
  const simulated = new Date(parts.year, parts.month - 1, parts.day, 23, 59, 59);
  if (Number.isNaN(simulated.getTime())) return fallbackNow;
  simulated.setDate(simulated.getDate() + 1);
  return simulated;
}

function average(values = []) {
  const nums = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!nums.length) return null;
  return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(2));
}

function pearsonCorrelation(xs = [], ys = []) {
  if (xs.length !== ys.length || xs.length < 2) return null;

  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(3));
}

function buildFantasyRankMap(drivers = []) {
  const sorted = [...drivers].sort(
    (a, b) => Number(b.fantasyTierScore) - Number(a.fantasyTierScore)
  );
  const rankByDriver = new Map();
  sorted.forEach((driver, index) => {
    rankByDriver.set(String(driver.driverId), index + 1);
  });
  return { rankByDriver, fieldSize: sorted.length };
}

function findWinnerDriverId(finishes = {}) {
  for (const [driverId, finish] of Object.entries(finishes)) {
    if (Number(finish) === 1) return String(driverId);
  }
  return null;
}

function findDriverName(drivers, driverId) {
  const match = drivers.find((driver) => String(driver.driverId) === String(driverId));
  return match?.driverName || null;
}

function buildRaceModelNotes({
  winnerName,
  winnerFantasyRank,
  fieldSize,
  topModelName,
  topModelFinish,
}) {
  const parts = [];
  if (winnerName && winnerFantasyRank != null) {
    parts.push(`Winner ${winnerName} ranked P${winnerFantasyRank} of ${fieldSize}`);
  }
  if (topModelName && topModelFinish != null) {
    parts.push(`Top model pick ${topModelName} finished P${topModelFinish}`);
  }
  return parts.join('. ') || 'No model notes available.';
}

export async function buildFantasyDriversForRace({
  scheduleRaces,
  raceNumber,
  settings,
  now,
  priorSalariesByDriver = new Map(),
  priorTierScoresByDriver = new Map(),
}) {
  const raceDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { now, settings });
  const standingsResult = await fetchStandingsRows(settings, raceDebug.standingsScheduleId);
  const standings = standingsResult.rows.filter(
    (row) =>
      Number(row.races) > 0 &&
      Number(row.position) >= 1 &&
      Number(row.position) <= SLATE_MAX_STANDINGS_POSITION
  );

  if (!standings.length) return null;

  const profiles = await getDriverProfiles();
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

  const targetRace = scheduleRaces.find(
    (race) => !race.nonPoints && race.officialPointsRaceNumber === Number(raceNumber)
  );

  const drivers = buildFantasyDriverSalaries({
    standings,
    groundingByDriver: factualGrounding.drivers,
    alignedRaces,
    schedules: standingsResult.schedules,
    upcomingTrack: targetRace?.track || 'TBD',
    driverRaceResultsByDriver,
    driverCareerRaceRowsByDriver,
    priorSalariesByDriver,
    priorTierScoresByDriver,
    slateRaceNumber: raceNumber,
    scheduleRaces,
    allAlignedRaces: allAligned,
    settings,
    now,
  }).sort((a, b) => b.fantasyTierScore - a.fantasyTierScore);

  return {
    drivers,
    standingsResult,
    allAligned,
  };
}

export async function runFantasySeasonBacktest() {
  const settings = await getSettings();
  const now = new Date();
  const scheduleHtml = await fetchHtml(settings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
  const completedRaces = getCompletedPointsRaces(scheduleRaces, { now, settings }).filter(
    (race) => race.winner && race.officialPointsRaceNumber != null
  );

  const raceRows = [];
  const winnerRanks = [];
  const top5AverageRanks = [];
  const top10AverageRanks = [];
  const correlationScores = [];
  const correlationFinishes = [];
  const missCandidates = [];

  for (const race of completedRaces) {
    const raceNumber = Number(race.officialPointsRaceNumber);
    const simulatedNow = simulatedNowForRace(race, now);

    const built = await buildFantasyDriversForRace({
      scheduleRaces,
      raceNumber,
      settings,
      now: simulatedNow,
    });
    if (!built?.drivers?.length) continue;

    const alignedRace = (built.allAligned || []).find(
      (entry) => Number(entry.pointsRaceNumber) === raceNumber
    );
    const finishes = alignedRace?.finishes || {};
    if (!Object.keys(finishes).length) continue;

    const { rankByDriver, fieldSize } = buildFantasyRankMap(built.drivers);
    const winnerDriverId = findWinnerDriverId(finishes);
    const winnerFantasyRank = winnerDriverId ? rankByDriver.get(winnerDriverId) ?? null : null;
    const winnerName =
      findDriverName(built.drivers, winnerDriverId) || race.winner || 'Unknown';

    const finishEntries = Object.entries(finishes)
      .map(([driverId, finish]) => ({ driverId: String(driverId), finish: Number(finish) }))
      .filter((entry) => Number.isFinite(entry.finish) && entry.finish > 0);

    const top5Ranks = finishEntries
      .filter((entry) => entry.finish <= 5)
      .map((entry) => rankByDriver.get(entry.driverId))
      .filter((rank) => rank != null);
    const top10Ranks = finishEntries
      .filter((entry) => entry.finish <= 10)
      .map((entry) => rankByDriver.get(entry.driverId))
      .filter((rank) => rank != null);

    const topModelDriver = built.drivers[0];
    const topModelFinish = topModelDriver
      ? finishes[String(topModelDriver.driverId)] ?? null
      : null;

    for (const driver of built.drivers) {
      const finish = finishes[String(driver.driverId)];
      if (!Number.isFinite(Number(finish))) continue;
      correlationScores.push(Number(driver.fantasyTierScore));
      correlationFinishes.push(Number(finish));
    }

    if (winnerFantasyRank != null) {
      winnerRanks.push(winnerFantasyRank);
      missCandidates.push({
        raceNumber,
        track: race.track || 'Unknown',
        winner: winnerName,
        winnerFantasyRank,
        fieldSize,
        missScore: winnerFantasyRank,
      });
    }

    const top5Avg = average(top5Ranks);
    const top10Avg = average(top10Ranks);
    if (top5Avg != null) top5AverageRanks.push(top5Avg);
    if (top10Avg != null) top10AverageRanks.push(top10Avg);

    const modelLineupResult = optimizeFantasyLineup(built.drivers, {
      salaryCap: LINEUP_SALARY_CAP,
      lineupSize: 5,
    });

    const driversWithFinishScore = built.drivers.map((driver) => ({
      ...driver,
      finishProxyScore: finishPositionProxyPoints(finishes[String(driver.driverId)]),
    }));

    const optimalActualResult = optimizeFantasyLineup(driversWithFinishScore, {
      salaryCap: LINEUP_SALARY_CAP,
      lineupSize: 5,
      scoreField: 'finishProxyScore',
    });

    const modelLineupPoints = (modelLineupResult.optimalLineup?.drivers || []).reduce(
      (sum, driver) =>
        sum + finishPositionProxyPoints(finishes[String(driver.driverId)]),
      0
    );
    const optimalLineupPoints = optimalActualResult.optimalLineup?.projectedScore ?? 0;
    const lineupEfficiency =
      optimalLineupPoints > 0
        ? Number(((modelLineupPoints / optimalLineupPoints) * 100).toFixed(1))
        : null;

    raceRows.push({
      raceNumber,
      track: race.track || 'Unknown',
      winner: winnerName,
      winnerFantasyRank,
      top5AverageFantasyRank: top5Avg,
      top10AverageFantasyRank: top10Avg,
      fieldSize,
      modelNotes: buildRaceModelNotes({
        winnerName,
        winnerFantasyRank,
        fieldSize,
        topModelName: topModelDriver?.driverName || null,
        topModelFinish,
      }),
      modelLineupPoints,
      optimalLineupPoints,
      lineupEfficiency,
      modelLineupDrivers: modelLineupResult.optimalLineup?.drivers?.map((d) => d.driverName) || [],
      optimalLineupDrivers: optimalActualResult.optimalLineup?.drivers?.map((d) => d.driverName) || [],
    });
  }

  missCandidates.sort((a, b) => b.missScore - a.missScore);

  const lineupEfficiencies = raceRows
    .map((row) => row.lineupEfficiency)
    .filter((value) => value != null);
  const bestLineupRace = [...raceRows]
    .filter((row) => row.lineupEfficiency != null)
    .sort((a, b) => b.lineupEfficiency - a.lineupEfficiency)[0] || null;
  const worstLineupRace = [...raceRows]
    .filter((row) => row.lineupEfficiency != null)
    .sort((a, b) => a.lineupEfficiency - b.lineupEfficiency)[0] || null;

  return {
    approximationNotice: APPROXIMATION_NOTICE,
    lineupApproximationNotice: LINEUP_BACKTEST_NOTICE,
    modelVersion: FANTASY_MODEL_VERSION,
    completedRacesTested: raceRows.length,
    averageWinnerFantasyRank: average(winnerRanks),
    averageTop5FinisherFantasyRank: average(top5AverageRanks),
    averageTop10FinisherFantasyRank: average(top10AverageRanks),
    fantasyScoreFinishCorrelation: pearsonCorrelation(correlationScores, correlationFinishes),
    averageLineupEfficiency: average(lineupEfficiencies),
    bestLineupRace: bestLineupRace
      ? {
          raceNumber: bestLineupRace.raceNumber,
          track: bestLineupRace.track,
          lineupEfficiency: bestLineupRace.lineupEfficiency,
        }
      : null,
    worstLineupRace: worstLineupRace
      ? {
          raceNumber: worstLineupRace.raceNumber,
          track: worstLineupRace.track,
          lineupEfficiency: worstLineupRace.lineupEfficiency,
        }
      : null,
    biggestMisses: missCandidates.slice(0, 5).map((entry) => ({
      raceNumber: entry.raceNumber,
      track: entry.track,
      winner: entry.winner,
      winnerFantasyRank: entry.winnerFantasyRank,
      fieldSize: entry.fieldSize,
    })),
    races: raceRows,
    generatedAt: new Date().toISOString(),
  };
}
