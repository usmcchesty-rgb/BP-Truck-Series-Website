import {
  buildMomentumComponent,
  buildRaceImpactComponent,
  buildRecentFormComponent,
  clampScore,
  explainSeasonPerformanceScore,
} from './_power-rankings-scoring.js';
import { getCompletedPointsRaces } from './_schedule-points-races.js';

export const FANTASY_MODEL_VERSION = 'fantasy-salary-v2.1';

export const FANTASY_TIER_WEIGHTS = {
  seasonPerformance: 0.25,
  recentForm: 0.2,
  careerTrackHistory: 0.2,
  raceImpact: 0.1,
  momentum: 0.1,
  reliability: 0.15,
};

export const FANTASY_COMPONENT_KEYS = [
  'seasonPerformance',
  'recentForm',
  'careerTrackHistory',
  'raceImpact',
  'momentum',
  'reliability',
];

export const FANTASY_TIER_SLOT_ORDER = [
  'top_tier',
  'elite',
  'strong',
  'midrange',
  'value',
];

export const FANTASY_TIER_SLOT_PERCENTAGES = {
  top_tier: 0.08,
  elite: 0.16,
  strong: 0.24,
  midrange: 0.32,
};

export const FANTASY_TIERS = [
  {
    key: 'top_tier',
    label: 'Top Tier',
    salaryMin: 13500,
    salaryMax: 15000,
  },
  {
    key: 'elite',
    label: 'Elite',
    salaryMin: 11000,
    salaryMax: 13500,
  },
  {
    key: 'strong',
    label: 'Strong',
    salaryMin: 9000,
    salaryMax: 11000,
  },
  {
    key: 'midrange',
    label: 'Midrange',
    salaryMin: 7000,
    salaryMax: 9000,
  },
  {
    key: 'value',
    label: 'Value',
    salaryMin: 4500,
    salaryMax: 7000,
  },
];

export const FANTASY_NEUTRAL_COMPONENT_SCORE = 50;

export const FANTASY_TIER_RANK = {
  top_tier: 5,
  elite: 4,
  strong: 3,
  midrange: 2,
  value: 1,
};

export const FANTASY_SEASON_ATTENDANCE_CAP_THRESHOLD = 0.6;
export const FANTASY_SEASON_ATTENDANCE_ELITE_THRESHOLD = 0.8;
export const FANTASY_ELITE_RECOVERY_TARGET = 3;

export const SALARY_GLOBAL_MIN = 4500;
export const SALARY_GLOBAL_MAX = 15000;
export const SALARY_ROUND_TO = 100;
export const SALARY_SMOOTHING_PRIOR_WEIGHT = 0.3;

export function priorTierScoreToMomentumRank(priorTierScore) {
  if (priorTierScore == null || priorTierScore === '') return null;
  const score = Number(priorTierScore);
  if (!Number.isFinite(score)) return null;
  if (score >= 90) return 1;
  if (score >= 78) return 3;
  if (score >= 64) return 6;
  if (score >= 48) return 8;
  return 10;
}

export function normalizeFieldComponentScores(rawScores = []) {
  const values = rawScores.map((value) => Number(value));
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return values.map(() => FANTASY_NEUTRAL_COMPONENT_SCORE);
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) {
    return values.map((value) =>
      Number.isFinite(value) ? FANTASY_NEUTRAL_COMPONENT_SCORE : FANTASY_NEUTRAL_COMPONENT_SCORE
    );
  }

  return values.map((value) => {
    if (!Number.isFinite(value)) return FANTASY_NEUTRAL_COMPONENT_SCORE;
    return Number(clampScore(((value - min) / (max - min)) * 100, 0, 100).toFixed(2));
  });
}

export function computeFantasyTierSlotCounts(fieldSize) {
  const n = Math.max(0, Number(fieldSize) || 0);
  if (!n) {
    return { top_tier: 0, elite: 0, strong: 0, midrange: 0, value: 0 };
  }

  const top = Math.max(1, Math.round(n * FANTASY_TIER_SLOT_PERCENTAGES.top_tier));
  const elite = Math.round(n * FANTASY_TIER_SLOT_PERCENTAGES.elite);
  const strong = Math.round(n * FANTASY_TIER_SLOT_PERCENTAGES.strong);
  const midrange = Math.round(n * FANTASY_TIER_SLOT_PERCENTAGES.midrange);
  const assigned = top + elite + strong + midrange;
  const value = Math.max(0, n - assigned);

  return { top_tier: top, elite, strong, midrange, value };
}

export function assignTiersByPercentileSlots(drivers = []) {
  const sorted = [...drivers].sort(
    (a, b) => Number(b.fantasyTierScore) - Number(a.fantasyTierScore)
  );
  const slots = computeFantasyTierSlotCounts(sorted.length);
  const tierByKey = Object.fromEntries(FANTASY_TIERS.map((tier) => [tier.key, tier]));
  let index = 0;

  for (const key of FANTASY_TIER_SLOT_ORDER) {
    const count = slots[key] || 0;
    const tier = tierByKey[key];
    for (let i = 0; i < count && index < sorted.length; i += 1, index += 1) {
      sorted[index].computedTierKey = tier.key;
      sorted[index].computedTier = tier.label;
      sorted[index].salaryBand = {
        min: tier.salaryMin,
        max: tier.salaryMax,
      };
    }
  }

  while (index < sorted.length) {
    const tier = tierByKey.value;
    sorted[index].computedTierKey = tier.key;
    sorted[index].computedTier = tier.label;
    sorted[index].salaryBand = {
      min: tier.salaryMin,
      max: tier.salaryMax,
    };
    index += 1;
  }

  return sorted;
}

export function mapScoreToSalaryInTierBand(tier, tierScores, driverScore) {
  const scores = tierScores
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!scores.length) {
    return Math.round((tier.salaryMin + tier.salaryMax) / 2);
  }

  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const score = Number(driverScore);
  const progress = max > min ? (score - min) / (max - min) : 0.5;
  const bandSpan = tier.salaryMax - tier.salaryMin;
  return Math.round(tier.salaryMin + progress * bandSpan);
}

export function clampSalaryToBand(value, band) {
  const n = Number(value);
  const min = Number(band?.min);
  const max = Number(band?.max);
  if (!Number.isFinite(n)) {
    return Number.isFinite(min) ? min : SALARY_GLOBAL_MIN;
  }
  const lo = Number.isFinite(min) ? min : SALARY_GLOBAL_MIN;
  const hi = Number.isFinite(max) ? max : SALARY_GLOBAL_MAX;
  return Math.min(hi, Math.max(lo, n));
}

export function roundSalary(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SALARY_GLOBAL_MIN;
  const rounded = Math.round(n / SALARY_ROUND_TO) * SALARY_ROUND_TO;
  return Math.min(SALARY_GLOBAL_MAX, Math.max(SALARY_GLOBAL_MIN, rounded));
}

export function roundSalaryInBand(value, band) {
  const clamped = clampSalaryToBand(value, band);
  const rounded = Math.round(clamped / SALARY_ROUND_TO) * SALARY_ROUND_TO;
  return clampSalaryToBand(rounded, band);
}

export function applySalarySmoothing(computedSalary, priorSalary, priorWeight = SALARY_SMOOTHING_PRIOR_WEIGHT) {
  const prior = Number(priorSalary);
  const next = Number(computedSalary);
  if (!Number.isFinite(prior) || prior <= 0) {
    return {
      applied: false,
      priorSalary: null,
      weight: 0,
      salary: next,
    };
  }

  const weight = Math.min(1, Math.max(0, Number(priorWeight) || 0));
  const blended = prior * weight + next * (1 - weight);
  return {
    applied: true,
    priorSalary: prior,
    weight,
    salary: blended,
  };
}

export function buildFantasyRecentFormRaw(grounding, alignedRaces, driverId) {
  const windowSize = Array.isArray(alignedRaces) ? alignedRaces.length : 0;
  const recentFinishes = (grounding?.recentRaceFinishes || [])
    .map((race) => Number(race.finish))
    .filter((finish) => Number.isFinite(finish) && finish >= 1);

  if (windowSize === 0) {
    return {
      score: FANTASY_NEUTRAL_COMPONENT_SCORE,
      details: {
        neutralApplied: true,
        reason: 'No completed recent race window; neutral 50 before field normalization.',
        last3Finishes: [],
        last3RaceStarts: 0,
        last3RaceWindowSize: 0,
      },
    };
  }

  const recentForm = buildRecentFormComponent(grounding, alignedRaces, driverId);
  return {
    score: Number(recentForm.score.toFixed(2)),
    details: {
      neutralApplied: false,
      dnpPathApplied: recentFinishes.length === 0,
      ...recentForm.details,
      last3RaceWindowSize: windowSize,
    },
  };
}

export function buildFantasyAttendanceContext({
  driverId,
  standingsRow,
  grounding,
  alignedRaces,
  slateRaceNumber,
  scheduleRaces,
  driverRaceRows = [],
  settings = null,
  now = new Date(),
}) {
  const completed = getCompletedPointsRaces(scheduleRaces, { now, settings }).filter(
    (race) =>
      race.officialPointsRaceNumber != null &&
      Number(race.officialPointsRaceNumber) < Number(slateRaceNumber)
  );
  const completedRacesBeforeSlate = completed.length;
  const seasonStarts = Number(standingsRow?.races) || 0;
  const seasonAttendanceRate =
    completedRacesBeforeSlate > 0
      ? Number((seasonStarts / completedRacesBeforeSlate).toFixed(3))
      : null;

  const last5Races = completed.slice(-5);
  const last5WindowSize = last5Races.length;
  const last5RaceNumbers = new Set(
    last5Races.map((race) => Number(race.officialPointsRaceNumber))
  );
  const last5Starts = (driverRaceRows || []).filter((row) =>
    last5RaceNumbers.has(Number(row.pointsRaceNumber))
  ).length;
  const last5AttendanceRate =
    last5WindowSize > 0 ? Number((last5Starts / last5WindowSize).toFixed(3)) : null;

  const last3WindowSize = Array.isArray(alignedRaces) ? alignedRaces.length : 0;
  const last3Starts =
    grounding?.last3RaceStarts ??
    (grounding?.recentRaceFinishes || []).filter((race) =>
      Number.isFinite(Number(race.finish))
    ).length;
  const last3DnpCount =
    grounding?.last3RaceDnpCount ??
    Math.max(0, last3WindowSize - last3Starts);

  const latestRace = alignedRaces?.[alignedRaces.length - 1] || null;
  const latestFinish = latestRace?.finishes?.[String(driverId)];
  const missedLatestRace =
    latestRace != null && !Number.isFinite(Number(latestFinish));

  const seasonPart =
    seasonAttendanceRate != null ? seasonAttendanceRate * 100 : FANTASY_NEUTRAL_COMPONENT_SCORE;
  const recentPart =
    last5AttendanceRate != null ? last5AttendanceRate * 100 : FANTASY_NEUTRAL_COMPONENT_SCORE;
  const reliabilityScore = Number(
    clampScore(seasonPart * 0.5 + recentPart * 0.5, 0, 100).toFixed(2)
  );

  return {
    completedRacesBeforeSlate,
    seasonStarts,
    seasonAttendanceRate,
    last5WindowSize,
    last5Starts,
    last5AttendanceRate,
    last3WindowSize,
    last3Starts,
    last3DnpCount,
    missedLatestRace,
    reliabilityScore,
    missedRecentRaceNames: grounding?.missedRecentRaceNames || [],
  };
}

export function computeMaxAllowedTierKey(attendance = {}) {
  const reasons = [];
  let maxTierKey = 'top_tier';
  let maxRank = FANTASY_TIER_RANK.top_tier;

  const applyCap = (tierKey, reason) => {
    const rank = FANTASY_TIER_RANK[tierKey];
    if (rank != null && rank < maxRank) {
      maxRank = rank;
      maxTierKey = tierKey;
      reasons.push(reason);
    }
  };

  if (attendance.last3WindowSize > 0 && attendance.last3Starts === 0) {
    applyCap('midrange', 'Missed all last 3 races → max tier Midrange');
  }

  if (
    attendance.completedRacesBeforeSlate > 0 &&
    attendance.seasonAttendanceRate != null &&
    attendance.seasonAttendanceRate < FANTASY_SEASON_ATTENDANCE_CAP_THRESHOLD
  ) {
    applyCap(
      'midrange',
      `Season attendance below ${Math.round(FANTASY_SEASON_ATTENDANCE_CAP_THRESHOLD * 100)}% → max tier Midrange`
    );
  }

  if (attendance.last3WindowSize > 0 && attendance.last3DnpCount >= 2) {
    if (
      attendance.seasonAttendanceRate != null &&
      attendance.seasonAttendanceRate < FANTASY_SEASON_ATTENDANCE_ELITE_THRESHOLD
    ) {
      applyCap(
        'strong',
        `Missed 2+ of last 3 races with season attendance below ${Math.round(FANTASY_SEASON_ATTENDANCE_ELITE_THRESHOLD * 100)}% → max Strong`
      );
    } else {
      applyCap('elite', 'Missed 2+ of last 3 races → max Elite');
    }
  }

  if (attendance.missedLatestRace && attendance.last3Starts < 2) {
    applyCap(
      'elite',
      'Missed latest race with fewer than 2 last-3 starts → cannot be Top Tier'
    );
  }

  return { maxTierKey, reasons };
}

export function isPremiumRecoveryEligible(driver, targetTierKey = 'top_tier') {
  const attendance = driver.attendanceContext || {};
  const { maxTierKey } = computeMaxAllowedTierKey(attendance);
  const targetRank = FANTASY_TIER_RANK[targetTierKey] ?? 0;
  const maxRank = FANTASY_TIER_RANK[maxTierKey] ?? 0;
  if (maxRank < targetRank) return false;

  return isTopTierRecoveryEligible(driver);
}

export function isTopTierRecoveryEligible(driver) {
  const attendance = driver.attendanceContext || {};

  if (attendance.last3WindowSize > 0 && attendance.last3Starts === 0) return false;

  if (
    attendance.completedRacesBeforeSlate > 0 &&
    attendance.seasonAttendanceRate != null &&
    attendance.seasonAttendanceRate < FANTASY_SEASON_ATTENDANCE_CAP_THRESHOLD
  ) {
    return false;
  }

  if (
    attendance.seasonAttendanceRate != null &&
    attendance.seasonAttendanceRate < FANTASY_SEASON_ATTENDANCE_ELITE_THRESHOLD
  ) {
    return false;
  }

  if (attendance.last3Starts < 1) return false;

  return true;
}

function assignDriverToRecoveredTier(driver, tierKey, tierByKey, reason, recoveryType) {
  const tier = tierByKey[tierKey];
  const previousTier = driver.computedTier;
  const previousTierKey = driver.computedTierKey;

  driver.computedTierKey = tier.key;
  driver.computedTier = tier.label;
  driver.salaryBand = {
    min: tier.salaryMin,
    max: tier.salaryMax,
  };
  driver.tierRecovery = {
    applied: true,
    type: recoveryType,
    previousTier,
    previousTierKey,
    reason,
  };
  if (driver.scoreBreakdown) {
    driver.scoreBreakdown._tierRecovery = driver.tierRecovery;
  }
}

export function applyPremiumTierRecovery(drivers = []) {
  const tierByKey = Object.fromEntries(FANTASY_TIERS.map((tier) => [tier.key, tier]));
  const sorted = [...drivers].sort(
    (a, b) => Number(b.fantasyTierScore) - Number(a.fantasyTierScore)
  );

  const countByTierKey = () => {
    const counts = Object.fromEntries(FANTASY_TIERS.map((tier) => [tier.key, 0]));
    for (const driver of drivers) {
      if (driver.computedTierKey) {
        counts[driver.computedTierKey] = (counts[driver.computedTierKey] || 0) + 1;
      }
    }
    return counts;
  };

  let topTierRecoveryApplied = 0;
  let eliteRecoveryApplied = 0;
  const recoveredDrivers = [];

  let counts = countByTierKey();
  const slotTargets = computeFantasyTierSlotCounts(drivers.length);
  const topTierTarget = slotTargets.top_tier || 1;

  if ((counts.top_tier || 0) < topTierTarget) {
    const needed = topTierTarget - (counts.top_tier || 0);
    const candidates = sorted.filter(
      (driver) =>
        driver.computedTierKey !== 'top_tier' && isTopTierRecoveryEligible(driver)
    );

    for (const candidate of candidates.slice(0, needed)) {
      assignDriverToRecoveredTier(
        candidate,
        'top_tier',
        tierByKey,
        'Premium tier recovery: promoted to Top Tier (eligible highest score)',
        'top_tier'
      );
      topTierRecoveryApplied += 1;
      recoveredDrivers.push({
        driverId: candidate.driverId,
        driverName: candidate.driverName,
        tier: 'Top Tier',
      });
    }
  }

  counts = countByTierKey();

  const eliteTarget = Math.max(FANTASY_ELITE_RECOVERY_TARGET, slotTargets.elite || 0);

  if ((counts.elite || 0) < eliteTarget) {
    const needed = eliteTarget - (counts.elite || 0);
    const candidates = sorted.filter(
      (driver) =>
        driver.computedTierKey !== 'top_tier' &&
        driver.computedTierKey !== 'elite' &&
        isTopTierRecoveryEligible(driver)
    );

    for (const candidate of candidates.slice(0, needed)) {
      assignDriverToRecoveredTier(
        candidate,
        'elite',
        tierByKey,
        'Premium tier recovery: promoted to Elite (eligible)',
        'elite'
      );
      eliteRecoveryApplied += 1;
      recoveredDrivers.push({
        driverId: candidate.driverId,
        driverName: candidate.driverName,
        tier: 'Elite',
      });
    }
  }

  return {
    topTierRecoveryApplied,
    eliteRecoveryApplied,
    recoveredDrivers,
  };
}

export function applyAttendanceTierCaps(drivers = []) {
  const tierByKey = Object.fromEntries(FANTASY_TIERS.map((tier) => [tier.key, tier]));

  for (const driver of drivers) {
    const attendance = driver.attendanceContext || {};
    const { maxTierKey, reasons } = computeMaxAllowedTierKey(attendance);
    const assignedKey = driver.computedTierKey;
    const assignedRank = FANTASY_TIER_RANK[assignedKey] || 0;
    const maxRank = FANTASY_TIER_RANK[maxTierKey] || 0;

    if (assignedRank > maxRank) {
      const cappedTier = tierByKey[maxTierKey];
      driver.uncappedTierKey = assignedKey;
      driver.uncappedTier = driver.computedTier;
      driver.computedTierKey = cappedTier.key;
      driver.computedTier = cappedTier.label;
      driver.salaryBand = {
        min: cappedTier.salaryMin,
        max: cappedTier.salaryMax,
      };
      driver.tierCap = {
        applied: true,
        maxTierKey,
        previousTierKey: assignedKey,
        previousTier: driver.uncappedTier,
        reasons,
      };
      if (driver.scoreBreakdown) {
        driver.scoreBreakdown._tierCap = driver.tierCap;
      }
    } else {
      driver.tierCap = {
        applied: false,
        maxTierKey,
        reasons: reasons.length ? reasons : [],
      };
      if (driver.scoreBreakdown && reasons.length) {
        driver.scoreBreakdown._tierCap = driver.tierCap;
      }
    }
  }

  return drivers;
}

export function buildFantasyMomentumRaw(priorTierScore) {
  if (priorTierScore == null || priorTierScore === '') {
    return {
      score: FANTASY_NEUTRAL_COMPONENT_SCORE,
      details: {
        neutralApplied: true,
        reason: 'First slate with no prior fantasy score; neutral 50 before field normalization.',
        priorTierScore: null,
        mappedMomentumRank: null,
      },
    };
  }

  const momentumRank = priorTierScoreToMomentumRank(priorTierScore);
  if (momentumRank == null) {
    return {
      score: FANTASY_NEUTRAL_COMPONENT_SCORE,
      details: {
        neutralApplied: true,
        priorTierScore,
        mappedMomentumRank: null,
      },
    };
  }

  const momentum = buildMomentumComponent(momentumRank);
  return {
    score: Number(momentum.score.toFixed(2)),
    details: {
      neutralApplied: false,
      priorTierScore,
      mappedMomentumRank: momentumRank,
      ...momentum.details,
    },
  };
}

export function buildFantasyRawComponents({
  driverId,
  standingsRow,
  grounding,
  alignedRaces,
  schedules,
  careerTrackHistoryScore,
  priorTierScore = null,
  attendanceContext = null,
}) {
  const latestRace = alignedRaces?.[alignedRaces.length - 1] || null;
  const season = explainSeasonPerformanceScore(standingsRow, schedules, driverId);
  const recentForm = buildFantasyRecentFormRaw(grounding, alignedRaces, driverId);
  const raceImpact = buildRaceImpactComponent(latestRace, schedules, driverId);
  const momentum = buildFantasyMomentumRaw(priorTierScore);
  const reliabilityScore =
    attendanceContext?.reliabilityScore ?? FANTASY_NEUTRAL_COMPONENT_SCORE;

  const components = {
    seasonPerformance: {
      rawScore: Number(season.seasonNormalizedScore.toFixed(2)),
      normalizedScore: null,
      score: Number(season.seasonNormalizedScore.toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.seasonPerformance,
      details: {
        ...season.details,
        components: season.components,
        seasonRawTotal: season.seasonRawTotal,
      },
    },
    recentForm: {
      rawScore: recentForm.score,
      normalizedScore: null,
      score: recentForm.score,
      weight: FANTASY_TIER_WEIGHTS.recentForm,
      details: recentForm.details,
    },
    careerTrackHistory: {
      rawScore: Number(clampScore(careerTrackHistoryScore, 0, 100).toFixed(2)),
      normalizedScore: null,
      score: Number(clampScore(careerTrackHistoryScore, 0, 100).toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.careerTrackHistory,
      details: {},
    },
    raceImpact: {
      rawScore: Number(raceImpact.score.toFixed(2)),
      normalizedScore: null,
      score: Number(raceImpact.score.toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.raceImpact,
      details: raceImpact.details,
    },
    momentum: {
      rawScore: momentum.score,
      normalizedScore: null,
      score: momentum.score,
      weight: FANTASY_TIER_WEIGHTS.momentum,
      details: momentum.details,
    },
    reliability: {
      rawScore: reliabilityScore,
      normalizedScore: null,
      score: reliabilityScore,
      weight: FANTASY_TIER_WEIGHTS.reliability,
      details: attendanceContext
        ? {
            seasonStarts: attendanceContext.seasonStarts,
            completedRacesBeforeSlate: attendanceContext.completedRacesBeforeSlate,
            seasonAttendanceRate: attendanceContext.seasonAttendanceRate,
            last3Starts: attendanceContext.last3Starts,
            last3WindowSize: attendanceContext.last3WindowSize,
            last5Starts: attendanceContext.last5Starts,
            last5WindowSize: attendanceContext.last5WindowSize,
            last5AttendanceRate: attendanceContext.last5AttendanceRate,
            missedLatestRace: attendanceContext.missedLatestRace,
          }
        : {},
    },
  };

  const fantasyTierScoreRaw = Number(
    (
      components.seasonPerformance.rawScore * FANTASY_TIER_WEIGHTS.seasonPerformance +
      components.recentForm.rawScore * FANTASY_TIER_WEIGHTS.recentForm +
      components.careerTrackHistory.rawScore * FANTASY_TIER_WEIGHTS.careerTrackHistory +
      components.raceImpact.rawScore * FANTASY_TIER_WEIGHTS.raceImpact +
      components.momentum.rawScore * FANTASY_TIER_WEIGHTS.momentum +
      components.reliability.rawScore * FANTASY_TIER_WEIGHTS.reliability
    ).toFixed(2)
  );

  return {
    fantasyTierScoreRaw,
    fantasyTierScore: null,
    components,
  };
}

export function computeWeightedFantasyTierScore(components) {
  return Number(
    (
      components.seasonPerformance.normalizedScore * FANTASY_TIER_WEIGHTS.seasonPerformance +
      components.recentForm.normalizedScore * FANTASY_TIER_WEIGHTS.recentForm +
      components.careerTrackHistory.normalizedScore * FANTASY_TIER_WEIGHTS.careerTrackHistory +
      components.raceImpact.normalizedScore * FANTASY_TIER_WEIGHTS.raceImpact +
      components.momentum.normalizedScore * FANTASY_TIER_WEIGHTS.momentum +
      components.reliability.normalizedScore * FANTASY_TIER_WEIGHTS.reliability
    ).toFixed(2)
  );
}

export function normalizeFantasySlateComponents(drivers = []) {
  for (const key of FANTASY_COMPONENT_KEYS) {
    const rawScores = drivers.map((driver) => driver.scoreBreakdown?.[key]?.rawScore);
    const normalizedScores = normalizeFieldComponentScores(rawScores);

    drivers.forEach((driver, index) => {
      const component = driver.scoreBreakdown[key];
      component.normalizedScore = normalizedScores[index];
      component.score = normalizedScores[index];
    });
  }

  for (const driver of drivers) {
    driver.fantasyTierScore = clampScore(
      computeWeightedFantasyTierScore(driver.scoreBreakdown),
      0,
      100
    );
  }

  return drivers;
}

export function computeFantasySlateSalaries(drivers = []) {
  const tierGroups = Object.fromEntries(FANTASY_TIERS.map((tier) => [tier.key, []]));

  for (const driver of drivers) {
    tierGroups[driver.computedTierKey]?.push(driver);
  }

  for (const tier of FANTASY_TIERS) {
    const group = tierGroups[tier.key] || [];
    const tierScores = group.map((driver) => driver.fantasyTierScore);

    for (const driver of group) {
      driver.baseSalaryInBand = mapScoreToSalaryInTierBand(
        tier,
        tierScores,
        driver.fantasyTierScore
      );

      const trackAdjustment = driver.trackAdjustment || {
        tier: 'neutral',
        amount: 0,
        reason: 'No track adjustment.',
      };
      const afterTrackAdjustment =
        driver.baseSalaryInBand + (Number(trackAdjustment.amount) || 0);
      driver.smoothing = applySalarySmoothing(afterTrackAdjustment, driver.priorSalary);

      const unclampedSalary = driver.smoothing.salary;
      const band = driver.salaryBand || { min: SALARY_GLOBAL_MIN, max: SALARY_GLOBAL_MAX };
      const preBandSalary = roundSalary(unclampedSalary);
      const generatedSalary = roundSalaryInBand(unclampedSalary, band);

      driver.bandEnforcement = {
        applied: preBandSalary !== generatedSalary,
        unclampedSalary: preBandSalary,
        generatedSalary,
      };

      driver.generatedSalary = generatedSalary;
      driver.salaryOverride = driver.salaryOverride ?? null;
      driver.finalSalary = driver.salaryOverride ?? driver.generatedSalary;
    }
  }

  return drivers;
}

export function finalizeFantasySlateSalaries(drivers = []) {
  assignTiersByPercentileSlots(drivers);
  applyAttendanceTierCaps(drivers);
  const tierRecovery = applyPremiumTierRecovery(drivers);
  computeFantasySlateSalaries(drivers);
  const sorted = drivers.sort(
    (a, b) => Number(b.fantasyTierScore) - Number(a.fantasyTierScore)
  );
  sorted.tierRecoveryMeta = tierRecovery;
  return sorted;
}

export function scoreFantasyDriverRaw({
  driverId,
  driverName,
  carNumber,
  standingsRow,
  grounding,
  alignedRaces,
  schedules,
  trackHistory,
  priorTierScore = null,
  priorSalary = null,
  attendanceContext = null,
}) {
  const { fantasyTierScoreRaw, components } = buildFantasyRawComponents({
    driverId,
    standingsRow,
    grounding,
    alignedRaces,
    schedules,
    careerTrackHistoryScore: trackHistory?.score ?? FANTASY_NEUTRAL_COMPONENT_SCORE,
    priorTierScore,
    attendanceContext,
  });

  components.careerTrackHistory.details = {
    scope: trackHistory?.scoringScope ?? trackHistory?.scope ?? null,
    historyScope: trackHistory?.historyScope ?? 'current_season',
    scoringScope: trackHistory?.scoringScope ?? trackHistory?.scope ?? null,
    fallbackUsed: trackHistory?.fallbackUsed ?? false,
    summary: trackHistory?.summary ?? null,
    scoreDetails: trackHistory?.scoreDetails ?? null,
    actualTrackScore: trackHistory?.actualTrackScore ?? null,
    sampleSize: trackHistory?.summary?.starts ?? trackHistory?.scoreDetails?.sampleSize ?? null,
    regressionApplied: trackHistory?.scoreDetails?.regressionApplied ?? false,
    regressedScore: trackHistory?.score ?? null,
    upcomingTrackMatch: trackHistory?.upcomingTrackMatch ?? null,
    trackTypeUsed: trackHistory?.trackTypeUsed ?? null,
    exactTrackStarts: trackHistory?.exactTrackStarts ?? null,
    similarTrackStarts: trackHistory?.similarTrackStarts ?? null,
    exactStarts: trackHistory?.exactStarts ?? null,
    similarStarts: trackHistory?.similarStarts ?? null,
    diagnostics: trackHistory?.diagnostics ?? null,
  };

  return {
    driverId: String(driverId),
    driverName: driverName || standingsRow?.driverName || '',
    carNumber: carNumber || standingsRow?.carNumber || '',
    fantasyTierScoreRaw,
    fantasyTierScore: null,
    computedTier: null,
    computedTierKey: null,
    salaryBand: null,
    baseSalaryInBand: null,
    scoreBreakdown: components,
    trackHistorySummary: trackHistory?.summary
      ? {
          historyScope: trackHistory.historyScope ?? 'current_season',
          scope: trackHistory.scoringScope ?? trackHistory.scope,
          fallbackUsed: trackHistory.fallbackUsed,
          similarTrackType: trackHistory.similarTrackType,
          upcomingTrack: trackHistory.upcomingTrack,
          ...trackHistory.summary,
        }
      : {},
    trackAdjustment: trackHistory?.trackAdjustment || {
      tier: 'neutral',
      amount: 0,
      reason: 'No track adjustment.',
    },
    smoothing: null,
    priorSalary: priorSalary ?? null,
    generatedSalary: null,
    salaryOverride: null,
    finalSalary: null,
    attendanceContext: attendanceContext || null,
    tierCap: null,
    uncappedTier: null,
    uncappedTierKey: null,
  };
}

export function summarizeFantasyScoreStats(drivers = []) {
  const scores = drivers
    .map((driver) => Number(driver.fantasyTierScore))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!scores.length) {
    return { max: null, avg: null, median: null };
  }

  const total = scores.reduce((sum, value) => sum + value, 0);
  const mid = Math.floor(scores.length / 2);
  const median =
    scores.length % 2 === 0
      ? Number(((scores[mid - 1] + scores[mid]) / 2).toFixed(2))
      : scores[mid];

  return {
    max: scores[scores.length - 1],
    avg: Number((total / scores.length).toFixed(2)),
    median,
  };
}

export function summarizeFantasyTierCounts(drivers = []) {
  const counts = Object.fromEntries(FANTASY_TIERS.map((tier) => [tier.label, 0]));
  for (const driver of drivers) {
    if (driver.computedTier && counts[driver.computedTier] != null) {
      counts[driver.computedTier] += 1;
    }
  }
  return counts;
}

export function detectSalaryBandViolations(drivers = []) {
  const violations = [];

  for (const driver of drivers) {
    const band = driver.salaryBand;
    const generated = Number(driver.generatedSalary);
    if (!band || !Number.isFinite(generated)) continue;

    if (generated < band.min || generated > band.max) {
      violations.push({
        driverId: driver.driverId,
        driverName: driver.driverName,
        computedTier: driver.computedTier,
        generatedSalary: generated,
        salaryBand: { min: band.min, max: band.max },
      });
    }
  }

  return violations;
}

export function summarizeCappedDrivers(drivers = []) {
  const capped = drivers.filter((driver) => driver.tierCap?.applied);
  return {
    count: capped.length,
    drivers: capped.map((driver) => ({
      driverId: driver.driverId,
      driverName: driver.driverName,
      previousTier: driver.tierCap?.previousTier,
      computedTier: driver.computedTier,
      reasons: driver.tierCap?.reasons || [],
    })),
  };
}
