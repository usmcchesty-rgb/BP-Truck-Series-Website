import { getRecentPointsRaceResults } from './_schedule-points-races.js';
import { alignFinishRacesWithTrace } from './_power-rankings-schedule-alignment.js';
import { extractFinishRacesFromSchedules } from './_simracerhub-schedule-results.js';

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameTokens(value) {
  return normalizeName(value).split(' ').filter((token) => token.length > 1);
}

export function matchDriverIdByName(name, driverLookup) {
  const target = normalizeName(name);
  if (!target) return null;

  for (const [driverId, driver] of driverLookup.entries()) {
    const display = normalizeName(driver.driverName);
    if (display === target) return String(driverId);
    if (display && (target.includes(display) || display.includes(target))) {
      return String(driverId);
    }
  }

  const targetTokens = nameTokens(name);
  if (targetTokens.length < 2) return null;

  let bestId = null;
  let bestScore = 0;
  for (const [driverId, driver] of driverLookup.entries()) {
    const driverTokens = nameTokens(driver.driverName);
    const overlap = targetTokens.filter((token) => driverTokens.includes(token)).length;
    if (overlap > bestScore) {
      bestScore = overlap;
      bestId = String(driverId);
    }
  }

  return bestScore >= 2 ? bestId : null;
}

function summarizeDriver(driverLookup, driverId) {
  const driver = driverLookup.get(String(driverId));
  if (!driver) return null;
  return {
    driverId: String(driverId),
    driverName: driver.driverName,
    pointsPosition: driver.position ?? null,
  };
}

function driversWithMultipleTop5Last3(alignedRaces) {
  const counts = new Map();

  for (const race of alignedRaces) {
    for (const [driverId, finishPosition] of Object.entries(race.finishes || {})) {
      if (finishPosition > 5) continue;
      counts.set(String(driverId), (counts.get(String(driverId)) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([driverId, top5CountLast3]) => ({ driverId, top5CountLast3 }));
}

function driversWithBackToBackPodiums(alignedRaces) {
  if (alignedRaces.length < 2) return [];
  const lastTwo = alignedRaces.slice(-2);
  const podiumDrivers = [];

  for (const driverId of new Set([
    ...Object.keys(lastTwo[0].finishes || {}),
    ...Object.keys(lastTwo[1].finishes || {}),
  ])) {
    const first = lastTwo[0].finishes?.[driverId];
    const second = lastTwo[1].finishes?.[driverId];
    if (first >= 1 && first <= 3 && second >= 1 && second <= 3) {
      podiumDrivers.push(String(driverId));
    }
  }

  return podiumDrivers;
}

function driversWithBackToBackWins(alignedRaces) {
  if (alignedRaces.length < 2) return [];
  const lastTwo = alignedRaces.slice(-2);
  const firstWinner = lastTwo[0].winnerDriverId;
  const secondWinner = lastTwo[1].winnerDriverId;
  if (firstWinner && secondWinner && firstWinner === secondWinner) {
    return [firstWinner];
  }
  if (
    lastTwo[0].winner &&
    lastTwo[1].winner &&
    normalizeName(lastTwo[0].winner) === normalizeName(lastTwo[1].winner)
  ) {
    return [secondWinner || firstWinner].filter(Boolean);
  }
  return [];
}

function outsidePointsTop10(driverId, standings) {
  const row = standings.find((entry) => String(entry.driverId) === String(driverId));
  if (!row) return true;
  return Number(row.position) > 10 || !Number.isFinite(Number(row.position));
}

export function buildRecentFormAnalysis({
  scheduleRaces,
  raceNumber,
  standings,
  schedules,
  driverLookup,
}) {
  const recentPointsRaces = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3);
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  const alignedRaces = alignFinishRacesWithTrace(recentPointsRaces, finishRaces, driverLookup);

  const last3RaceWinners = alignedRaces
    .map((race) =>
      race.winnerDriverId
        ? summarizeDriver(driverLookup, race.winnerDriverId)
        : race.winner
          ? { driverId: null, driverName: race.winner, pointsPosition: null }
          : null
    )
    .filter(Boolean);

  const last2RaceWinners = last3RaceWinners.slice(-2);
  const mostRecentRaceWinner = last3RaceWinners[last3RaceWinners.length - 1] || null;

  const backToBackWinnerIds = driversWithBackToBackWins(alignedRaces);
  const backToBackPodiumIds = driversWithBackToBackPodiums(alignedRaces);
  const multipleTop5Ids = driversWithMultipleTop5Last3(alignedRaces);

  const backToBackWinners = backToBackWinnerIds
    .map((driverId) => summarizeDriver(driverLookup, driverId))
    .filter(Boolean);
  const backToBackPodiumDrivers = backToBackPodiumIds
    .map((driverId) => summarizeDriver(driverLookup, driverId))
    .filter(Boolean);
  const multipleTop5Last3Drivers = multipleTop5Ids
    .map(({ driverId, top5CountLast3 }) => ({
      ...summarizeDriver(driverLookup, driverId),
      top5CountLast3,
    }))
    .filter((entry) => entry.driverId);

  const recentWinnerIds = new Set(
    last2RaceWinners.map((entry) => entry?.driverId).filter(Boolean)
  );
  const hotDriverIds = new Set([
    ...backToBackWinnerIds,
    ...backToBackPodiumIds,
    ...multipleTop5Ids.map((entry) => entry.driverId),
    ...last2RaceWinners.map((entry) => entry?.driverId).filter(Boolean),
  ]);

  const recentWinnersOutsideTop10 = [...recentWinnerIds]
    .filter((driverId) => outsidePointsTop10(driverId, standings))
    .map((driverId) => summarizeDriver(driverLookup, driverId))
    .filter(Boolean);

  const hotDriversOutsideTop10 = [...hotDriverIds]
    .filter((driverId) => outsidePointsTop10(driverId, standings))
    .map((driverId) => summarizeDriver(driverLookup, driverId))
    .filter(Boolean);

  return {
    mostRecentRaceWinner,
    last2RaceWinners,
    last3RaceWinners,
    backToBackWinners,
    backToBackPodiumDrivers,
    multipleTop5Last3Drivers,
    recentWinnersOutsideTop10,
    hotDriversOutsideTop10,
    alignedRecentRaces: alignedRaces.map((race) => ({
      pointsRaceNumber: race.pointsRaceNumber,
      track: race.track,
      winner: race.winner,
      winnerDriverId: race.winnerDriverId,
    })),
  };
}

export function validateRecentFormCoverage(entries, honorableMentions, recentFormAnalysis) {
  const warnings = [];
  if (!recentFormAnalysis) return warnings;

  const rankedIds = new Set((entries || []).map((entry) => String(entry.driverId)));
  const mentionIds = new Set((honorableMentions || []).map((entry) => String(entry.driverId)));
  const isCovered = (driverId) =>
    driverId && (rankedIds.has(String(driverId)) || mentionIds.has(String(driverId)));

  if (
    (recentFormAnalysis.backToBackWinners || []).some(
      (driver) => driver?.driverId && !isCovered(driver.driverId)
    )
  ) {
    warnings.push('Back-to-back winner omitted from rankings and honorable mentions.');
  }

  if (
    (recentFormAnalysis.backToBackPodiumDrivers || []).some(
      (driver) => driver?.driverId && !isCovered(driver.driverId)
    )
  ) {
    warnings.push('Back-to-back podium driver omitted from rankings and honorable mentions.');
  }

  if (
    (recentFormAnalysis.last2RaceWinners || []).some(
      (driver) => driver?.driverId && !isCovered(driver.driverId)
    )
  ) {
    warnings.push('Recent winner omitted from rankings and honorable mentions.');
  }

  return warnings;
}
