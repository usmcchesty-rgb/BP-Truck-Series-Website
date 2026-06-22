import {
  buildMomentumComponent,
  buildRaceImpactComponent,
  buildRecentFormComponent,
  clampScore,
  explainSeasonPerformanceScore,
} from './_power-rankings-scoring.js';

export const FANTASY_MODEL_VERSION = 'fantasy-salary-v2';

export const FANTASY_TIER_WEIGHTS = {
  seasonPerformance: 0.3,
  recentForm: 0.25,
  careerTrackHistory: 0.25,
  raceImpact: 0.1,
  momentum: 0.1,
};

export const FANTASY_COMPONENT_KEYS = [
  'seasonPerformance',
  'recentForm',
  'careerTrackHistory',
  'raceImpact',
  'momentum',
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
  const recentFinishes = (grounding?.recentRaceFinishes || [])
    .map((race) => Number(race.finish))
    .filter((finish) => Number.isFinite(finish) && finish >= 1);

  if (!recentFinishes.length) {
    return {
      score: FANTASY_NEUTRAL_COMPONENT_SCORE,
      details: {
        neutralApplied: true,
        reason: 'No recent race finishes available; neutral 50 before field normalization.',
        last3Finishes: [],
        last3RaceStarts: 0,
      },
    };
  }

  const recentForm = buildRecentFormComponent(grounding, alignedRaces, driverId);
  return {
    score: Number(recentForm.score.toFixed(2)),
    details: {
      neutralApplied: false,
      ...recentForm.details,
    },
  };
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
}) {
  const latestRace = alignedRaces?.[alignedRaces.length - 1] || null;
  const season = explainSeasonPerformanceScore(standingsRow, schedules, driverId);
  const recentForm = buildFantasyRecentFormRaw(grounding, alignedRaces, driverId);
  const raceImpact = buildRaceImpactComponent(latestRace, schedules, driverId);
  const momentum = buildFantasyMomentumRaw(priorTierScore);

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
  };

  const fantasyTierScoreRaw = Number(
    (
      components.seasonPerformance.rawScore * FANTASY_TIER_WEIGHTS.seasonPerformance +
      components.recentForm.rawScore * FANTASY_TIER_WEIGHTS.recentForm +
      components.careerTrackHistory.rawScore * FANTASY_TIER_WEIGHTS.careerTrackHistory +
      components.raceImpact.rawScore * FANTASY_TIER_WEIGHTS.raceImpact +
      components.momentum.rawScore * FANTASY_TIER_WEIGHTS.momentum
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
      components.momentum.normalizedScore * FANTASY_TIER_WEIGHTS.momentum
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

export function finalizeFantasySlateSalaries(drivers = []) {
  const tiered = assignTiersByPercentileSlots(drivers);
  const tierGroups = Object.fromEntries(FANTASY_TIERS.map((tier) => [tier.key, []]));

  for (const driver of tiered) {
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

  return tiered.sort((a, b) => Number(b.fantasyTierScore) - Number(a.fantasyTierScore));
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
}) {
  const { fantasyTierScoreRaw, components } = buildFantasyRawComponents({
    driverId,
    standingsRow,
    grounding,
    alignedRaces,
    schedules,
    careerTrackHistoryScore: trackHistory?.score ?? FANTASY_NEUTRAL_COMPONENT_SCORE,
    priorTierScore,
  });

  components.careerTrackHistory.details = {
    scope: trackHistory?.scope ?? null,
    fallbackUsed: trackHistory?.fallbackUsed ?? false,
    summary: trackHistory?.summary ?? null,
    scoreDetails: trackHistory?.scoreDetails ?? null,
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
          scope: trackHistory.scope,
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
