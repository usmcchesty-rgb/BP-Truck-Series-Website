import {
  buildMomentumComponent,
  buildRaceImpactComponent,
  buildRecentFormComponent,
  clampScore,
  explainSeasonPerformanceScore,
} from './_power-rankings-scoring.js';

export const FANTASY_MODEL_VERSION = 'fantasy-salary-v1';

export const FANTASY_TIER_WEIGHTS = {
  seasonPerformance: 0.3,
  recentForm: 0.25,
  careerTrackHistory: 0.25,
  raceImpact: 0.1,
  momentum: 0.1,
};

export const FANTASY_TIERS = [
  {
    key: 'top_tier',
    label: 'Top Tier',
    minScore: 90,
    maxScore: 100,
    salaryMin: 13500,
    salaryMax: 15000,
  },
  {
    key: 'elite',
    label: 'Elite',
    minScore: 78,
    maxScore: 89,
    salaryMin: 11000,
    salaryMax: 13500,
  },
  {
    key: 'strong',
    label: 'Strong',
    minScore: 64,
    maxScore: 77,
    salaryMin: 9000,
    salaryMax: 11000,
  },
  {
    key: 'midrange',
    label: 'Midrange',
    minScore: 48,
    maxScore: 63,
    salaryMin: 7000,
    salaryMax: 9000,
  },
  {
    key: 'value',
    label: 'Value',
    minScore: 0,
    maxScore: 47,
    salaryMin: 4500,
    salaryMax: 7000,
  },
];

export const SALARY_GLOBAL_MIN = 4500;
export const SALARY_GLOBAL_MAX = 15000;
export const SALARY_ROUND_TO = 100;
export const SALARY_SMOOTHING_PRIOR_WEIGHT = 0.3;

export function priorTierScoreToMomentumRank(priorTierScore) {
  const score = Number(priorTierScore);
  if (!Number.isFinite(score)) return null;
  if (score >= 90) return 1;
  if (score >= 78) return 3;
  if (score >= 64) return 6;
  if (score >= 48) return 8;
  return 10;
}

export function assignTierFromScore(fantasyTierScore) {
  const score = clampScore(Number(fantasyTierScore), 0, 100);
  const tier =
    FANTASY_TIERS.find(
      (entry) => score >= entry.minScore && score <= entry.maxScore
    ) || FANTASY_TIERS[FANTASY_TIERS.length - 1];

  return {
    ...tier,
    fantasyTierScore: score,
  };
}

export function mapScoreToSalaryInBand(fantasyTierScore, tier) {
  const score = clampScore(Number(fantasyTierScore), tier.minScore, tier.maxScore);
  const span = Math.max(tier.maxScore - tier.minScore, 1);
  const progress = (score - tier.minScore) / span;
  const bandSpan = tier.salaryMax - tier.salaryMin;
  return Math.round(tier.salaryMin + progress * bandSpan);
}

export function roundSalary(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SALARY_GLOBAL_MIN;
  const rounded = Math.round(n / SALARY_ROUND_TO) * SALARY_ROUND_TO;
  return Math.min(SALARY_GLOBAL_MAX, Math.max(SALARY_GLOBAL_MIN, rounded));
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

export function buildFantasyTierScoreComponents({
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
  const recentForm = buildRecentFormComponent(grounding, alignedRaces, driverId);
  const raceImpact = buildRaceImpactComponent(latestRace, schedules, driverId);
  const momentumRank = priorTierScoreToMomentumRank(priorTierScore);
  const momentum = buildMomentumComponent(momentumRank);

  const components = {
    seasonPerformance: {
      score: Number(season.seasonNormalizedScore.toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.seasonPerformance,
      details: {
        ...season.details,
        components: season.components,
        seasonRawTotal: season.seasonRawTotal,
      },
    },
    recentForm: {
      score: Number(recentForm.score.toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.recentForm,
      details: recentForm.details,
    },
    careerTrackHistory: {
      score: Number(clampScore(careerTrackHistoryScore, 0, 100).toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.careerTrackHistory,
      details: {},
    },
    raceImpact: {
      score: Number(raceImpact.score.toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.raceImpact,
      details: raceImpact.details,
    },
    momentum: {
      score: Number(momentum.score.toFixed(2)),
      weight: FANTASY_TIER_WEIGHTS.momentum,
      details: {
        ...momentum.details,
        priorTierScore: priorTierScore ?? null,
        mappedMomentumRank: momentumRank,
      },
    },
  };

  const fantasyTierScore = Number(
    (
      components.seasonPerformance.score * FANTASY_TIER_WEIGHTS.seasonPerformance +
      components.recentForm.score * FANTASY_TIER_WEIGHTS.recentForm +
      components.careerTrackHistory.score * FANTASY_TIER_WEIGHTS.careerTrackHistory +
      components.raceImpact.score * FANTASY_TIER_WEIGHTS.raceImpact +
      components.momentum.score * FANTASY_TIER_WEIGHTS.momentum
    ).toFixed(2)
  );

  return {
    fantasyTierScore: clampScore(fantasyTierScore, 0, 100),
    components,
  };
}

export function scoreFantasyDriver({
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
  const { fantasyTierScore, components } = buildFantasyTierScoreComponents({
    driverId,
    standingsRow,
    grounding,
    alignedRaces,
    schedules,
    careerTrackHistoryScore: trackHistory?.score ?? 50,
    priorTierScore,
  });

  components.careerTrackHistory.details = {
    scope: trackHistory?.scope ?? null,
    fallbackUsed: trackHistory?.fallbackUsed ?? false,
    summary: trackHistory?.summary ?? null,
    scoreDetails: trackHistory?.scoreDetails ?? null,
  };

  const tier = assignTierFromScore(fantasyTierScore);
  const baseSalaryInBand = mapScoreToSalaryInBand(fantasyTierScore, tier);
  const trackAdjustment = trackHistory?.trackAdjustment || {
    tier: 'neutral',
    amount: 0,
    reason: 'No track adjustment.',
  };

  const afterTrackAdjustment = baseSalaryInBand + (Number(trackAdjustment.amount) || 0);
  const smoothing = applySalarySmoothing(afterTrackAdjustment, priorSalary);
  const generatedSalary = roundSalary(smoothing.salary);

  return {
    driverId: String(driverId),
    driverName: driverName || standingsRow?.driverName || '',
    carNumber: carNumber || standingsRow?.carNumber || '',
    fantasyTierScore,
    computedTier: tier.label,
    computedTierKey: tier.key,
    salaryBand: {
      min: tier.salaryMin,
      max: tier.salaryMax,
    },
    baseSalaryInBand,
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
    trackAdjustment,
    smoothing,
    priorSalary: priorSalary ?? null,
    generatedSalary,
    salaryOverride: null,
    finalSalary: generatedSalary,
  };
}
