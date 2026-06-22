import { buildCareerTrackHistoryForDriver, computeTrackDollarAdjustment, buildCurrentSeasonTrackHistoryForDriver } from './_fantasy-track-history.js';
import {
  FANTASY_MODEL_VERSION,
  assignTrackHistoryRanks,
  buildFantasyAttendanceContext,
  buildSlateRecentRaceContext,
  detectSalaryBandViolations,
  finalizeFantasySlateSalaries,
  getEffectiveFantasyTierWeights,
  normalizeFantasySlateComponents,
  scoreFantasyDriverRaw,
  summarizeCappedDrivers,
  summarizeFantasyScoreStats,
  summarizeFantasyTierCounts,
  summarizeTierEligibility,
  summarizeTopTrackHistoryDrivers,
  summarizeTopProvenTrackHistoryDrivers,
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
  driverCareerRaceRowsByDriver = null,
  trackHistoryMode = 'career',
  priorSalariesByDriver = new Map(),
  priorTierScoresByDriver = new Map(),
  slateRaceNumber = null,
  scheduleRaces = null,
  allAlignedRaces = null,
  settings = null,
  now = new Date(),
}) {
  const recentRaceContext =
    slateRaceNumber != null && scheduleRaces
      ? buildSlateRecentRaceContext({
          scheduleRaces,
          slateRaceNumber,
          alignedRaces,
          allAlignedRaces: allAlignedRaces || [],
          settings,
          now,
        })
      : null;

  const rawDrivers = standings.map((row) => {
    const driverId = String(row.driverId);
    const grounding = groundingByDriver?.[driverId] || {
      recentRaceFinishes: [],
    };
    const careerRows = driverCareerRaceRowsByDriver?.get(driverId) || [];
    const seasonRows = driverRaceResultsByDriver?.get(driverId) || [];
    const useCareerTrackHistory = trackHistoryMode !== 'current_season';
    const trackHistoryRows = useCareerTrackHistory ? careerRows : seasonRows;
    const trackHistory = useCareerTrackHistory
      ? buildCareerTrackHistoryForDriver(trackHistoryRows, upcomingTrack)
      : buildCurrentSeasonTrackHistoryForDriver(trackHistoryRows, upcomingTrack, {
          alignedRaces,
          driverId,
        });
    trackHistory.trackAdjustment = computeTrackDollarAdjustment(trackHistory);

    const attendanceContext =
      slateRaceNumber != null && scheduleRaces
        ? buildFantasyAttendanceContext({
            driverId,
            standingsRow: row,
            grounding,
            alignedRaces,
            slateRaceNumber,
            scheduleRaces,
            driverRaceRows: seasonRows,
            recentRaceContext,
            settings,
            now,
          })
        : null;

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
      attendanceContext,
    });
  });

  const sparseInfo = recentRaceContext
    ? {
        recentDataSparse: recentRaceContext.recentDataSparse,
        validRecentRaceCount: recentRaceContext.validRecentRaceCount,
        attendanceCapsEnabled: recentRaceContext.attendanceCapsEnabled,
        validLast5Entries: recentRaceContext.validLast5Entries,
        excludedLast5Entries: recentRaceContext.excludedLast5Entries,
        validLast3Entries: recentRaceContext.validLast3Entries,
        excludedLast3Entries: recentRaceContext.excludedLast3Entries,
        last5ScheduleWindowSize: recentRaceContext.last5ScheduleWindowSize,
        last3AlignedWindowSize: recentRaceContext.last3AlignedWindowSize,
      }
    : {
        recentDataSparse: false,
        validRecentRaceCount: 0,
        attendanceCapsEnabled: false,
      };
  const effectiveWeights = getEffectiveFantasyTierWeights(sparseInfo.recentDataSparse);

  normalizeFantasySlateComponents(rawDrivers, {
    effectiveWeights,
    recentDataSparse: sparseInfo.recentDataSparse,
  });
  const drivers = finalizeFantasySlateSalaries(rawDrivers);
  const tierRecovery = drivers.tierRecoveryMeta || {
    topTierRecoveryApplied: 0,
    eliteRecoveryApplied: 0,
    recoveredDrivers: [],
    topTierSlotsUnfilled: 0,
    topTierRecoverySkippedNoEligible: false,
  };
  drivers.tierRecoveryMeta = {
    ...tierRecovery,
    ...sparseInfo,
    effectiveWeights,
  };

  for (const driver of drivers) {
    driver.salaryReasons = buildFantasySalaryReasons(driver);
    if (driver.scoreBreakdown && driver.fantasyTierScoreRaw != null) {
      driver.scoreBreakdown._fantasyTierScoreRaw = driver.fantasyTierScoreRaw;
    }
  }

  assignTrackHistoryRanks(drivers);

  return drivers;
}

export function summarizeFantasySlateMeta(drivers = []) {
  const salaries = drivers.map((row) => Number(row.finalSalary)).filter(Number.isFinite);
  const total = salaries.reduce((sum, value) => sum + value, 0);
  const scoreStats = summarizeFantasyScoreStats(drivers);
  const tierCounts = summarizeFantasyTierCounts(drivers);
  const violations = detectSalaryBandViolations(drivers);
  const cappedDrivers = summarizeCappedDrivers(drivers);
  const tierRecovery = drivers.tierRecoveryMeta || {
    topTierRecoveryApplied: 0,
    eliteRecoveryApplied: 0,
    recoveredDrivers: [],
    topTierSlotsUnfilled: 0,
    topTierRecoverySkippedNoEligible: false,
    recentDataSparse: false,
  };
  const eligibility = summarizeTierEligibility(drivers);

  return {
    modelVersion: FANTASY_MODEL_VERSION,
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
    cappedDrivers,
    topTierEligible: eligibility.topTierEligible,
    eliteEligible: eligibility.eliteEligible,
    topTrackHistoryDrivers: summarizeTopProvenTrackHistoryDrivers(drivers),
    topProvenTrackHistoryDrivers: summarizeTopProvenTrackHistoryDrivers(drivers),
    recentDataSparse: tierRecovery.recentDataSparse ?? false,
    topTierRecoveryApplied: tierRecovery.topTierRecoveryApplied ?? 0,
    eliteRecoveryApplied: tierRecovery.eliteRecoveryApplied ?? 0,
    topTierSlotsUnfilled: tierRecovery.topTierSlotsUnfilled ?? 0,
    topTierRecoverySkippedNoEligible: tierRecovery.topTierRecoverySkippedNoEligible ?? false,
    validRecentRaceCount: tierRecovery.validRecentRaceCount ?? null,
    attendanceCapsEnabled: tierRecovery.attendanceCapsEnabled ?? null,
    excludedRecentRaces: tierRecovery.excludedLast5Entries ?? [],
    tierRecovery,
  };
}
