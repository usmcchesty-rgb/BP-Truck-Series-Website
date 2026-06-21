import { buildCareerTrackHistoryForDriver, computeTrackDollarAdjustment } from './_fantasy-track-history.js';
import { FANTASY_MODEL_VERSION, scoreFantasyDriver } from './_fantasy-tier-scoring.js';
import { buildFantasySalaryReasons } from './_fantasy-salary-reasons.js';

export { FANTASY_MODEL_VERSION };

export function buildFantasyDriverSalaries({
  standings,
  groundingByDriver,
  alignedRaces,
  schedules,
  upcomingTrack,
  driverRaceResultsByDriver,
  priorSalariesByDriver = new Map(),
  priorTierScoresByDriver = new Map(),
}) {
  return standings.map((row) => {
    const driverId = String(row.driverId);
    const grounding = groundingByDriver?.[driverId] || {
      recentRaceFinishes: [],
    };
    const raceRows = driverRaceResultsByDriver?.get(driverId) || [];
    const trackHistory = buildCareerTrackHistoryForDriver(raceRows, upcomingTrack);
    trackHistory.trackAdjustment = computeTrackDollarAdjustment(trackHistory);

    const scored = scoreFantasyDriver({
      driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
      standingsRow: row,
      grounding,
      alignedRaces,
      schedules,
      trackHistory,
      priorTierScore: priorTierScoresByDriver.get(driverId) ?? null,
      priorSalary: priorSalariesByDriver.get(driverId) ?? null,
    });

    scored.salaryReasons = buildFantasySalaryReasons(scored);
    return scored;
  });
}

export function summarizeFantasySlateMeta(drivers = []) {
  const salaries = drivers.map((row) => Number(row.finalSalary)).filter(Number.isFinite);
  const total = salaries.reduce((sum, value) => sum + value, 0);
  return {
    driverCount: drivers.length,
    avgSalary: salaries.length ? Math.round(total / salaries.length) : null,
    minSalary: salaries.length ? Math.min(...salaries) : null,
    maxSalary: salaries.length ? Math.max(...salaries) : null,
  };
}
