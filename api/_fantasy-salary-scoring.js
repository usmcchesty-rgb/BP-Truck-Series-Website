import { buildCareerTrackHistoryForDriver, computeTrackDollarAdjustment } from './_fantasy-track-history.js';
import {
  FANTASY_MODEL_VERSION,
  detectSalaryBandViolations,
  finalizeFantasySlateSalaries,
  normalizeFantasySlateComponents,
  scoreFantasyDriverRaw,
  summarizeFantasyScoreStats,
  summarizeFantasyTierCounts,
} from './_fantasy-tier-scoring.js';
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
  const rawDrivers = standings.map((row) => {
    const driverId = String(row.driverId);
    const grounding = groundingByDriver?.[driverId] || {
      recentRaceFinishes: [],
    };
    const raceRows = driverRaceResultsByDriver?.get(driverId) || [];
    const trackHistory = buildCareerTrackHistoryForDriver(raceRows, upcomingTrack);
    trackHistory.trackAdjustment = computeTrackDollarAdjustment(trackHistory);

    return scoreFantasyDriverRaw({
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
  });

  normalizeFantasySlateComponents(rawDrivers);
  const drivers = finalizeFantasySlateSalaries(rawDrivers);

  for (const driver of drivers) {
    driver.salaryReasons = buildFantasySalaryReasons(driver);
    if (driver.scoreBreakdown && driver.fantasyTierScoreRaw != null) {
      driver.scoreBreakdown._fantasyTierScoreRaw = driver.fantasyTierScoreRaw;
    }
  }

  return drivers;
}

export function summarizeFantasySlateMeta(drivers = []) {
  const salaries = drivers.map((row) => Number(row.finalSalary)).filter(Number.isFinite);
  const total = salaries.reduce((sum, value) => sum + value, 0);
  const scoreStats = summarizeFantasyScoreStats(drivers);
  const tierCounts = summarizeFantasyTierCounts(drivers);
  const violations = detectSalaryBandViolations(drivers);

  return {
    driverCount: drivers.length,
    avgSalary: salaries.length ? Math.round(total / salaries.length) : null,
    minSalary: salaries.length ? Math.min(...salaries) : null,
    maxSalary: salaries.length ? Math.max(...salaries) : null,
    scoreStats,
    tierCounts,
    salaryBandViolations: {
      count: violations.length,
      violations,
    },
  };
}
