import {
  buildMomentumComponent,
  buildRaceImpactComponent,
  buildRecentFormComponent,
  clampScore,
  explainSeasonPerformanceScore,
} from './_power-rankings-scoring.js';
import { getCompletedPointsRaces } from './_schedule-points-races.js';

export const FANTASY_MODEL_VERSION = 'fantasy-salary-v2.5.0';

export const FANTASY_TIER_WEIGHTS = {
  seasonPerformance: 0.35,
  recentForm: 0.2,
  careerTrackHistory: 0.1,
  raceImpact: 0.1,
  momentum: 0.1,
  reliability: 0.15,
};

export const FANTASY_SPARSE_RECENT_WEIGHT_REDUCTION = 0.5;
export const FANTASY_TOP_TIER_RECENT_ATTENDANCE_THRESHOLD = 0.6;
export const FANTASY_ELITE_RECENT_ATTENDANCE_THRESHOLD = 0.4;
export const FANTASY_TOP_TIER_STANDINGS_CUTOFF = 8;
export const FANTASY_TOP_TIER_RECENT_FORM_RANK_CUTOFF = 5;
export const FANTASY_TOP_TIER_SCORE_RANK_CUTOFF = 5;
export const FANTASY_RELIABILITY_RECENT_WEIGHT = 0.7;
export const FANTASY_RELIABILITY_SEASON_WEIGHT = 0.3;
export const FANTASY_ELITE_RECOVERY_TARGET = 3;
export const FANTASY_MIN_VALID_RECENT_RACES_FOR_CAPS = 2;

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
  recentRaceContext = null,
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
  const last5ScheduleWindowSize = last5Races.length;
  const validLast5RaceNumbers =
    recentRaceContext?.validLast5RaceNumbers ??
    new Set(
      last5Races
        .map((race) => Number(race.officialPointsRaceNumber))
        .filter(Number.isFinite)
    );
  const validLast5WindowSize =
    recentRaceContext?.validRecentRaceCount ??
    (validLast5RaceNumbers instanceof Set
      ? validLast5RaceNumbers.size
      : validLast5RaceNumbers.length);
  const validLast5Starts = (driverRaceRows || []).filter((row) =>
    validLast5RaceNumbers.has(Number(row.pointsRaceNumber))
  ).length;
  const validLast5Misses =
    validLast5WindowSize > 0 ? Math.max(0, validLast5WindowSize - validLast5Starts) : 0;
  const recentAttendanceRate =
    validLast5WindowSize > 0
      ? Number((validLast5Starts / validLast5WindowSize).toFixed(3))
      : null;

  const validLast3RaceNumbers =
    recentRaceContext?.validLast3RaceNumbers ??
    new Set(
      (alignedRaces || [])
        .filter((race) => raceHasValidFieldFinishData(race))
        .map((race) => Number(race.pointsRaceNumber))
        .filter(Number.isFinite)
    );
  const validLast3WindowSize =
    recentRaceContext?.validLast3Entries?.length ??
    (validLast3RaceNumbers instanceof Set
      ? validLast3RaceNumbers.size
      : validLast3RaceNumbers.length);
  const validLast3Starts = (driverRaceRows || []).filter((row) =>
    validLast3RaceNumbers.has(Number(row.pointsRaceNumber))
  ).length;
  const validLast3Misses =
    validLast3WindowSize > 0 ? Math.max(0, validLast3WindowSize - validLast3Starts) : 0;

  const validLast3Aligned = (alignedRaces || []).filter((race) =>
    raceHasValidFieldFinishData(race)
  );
  const latestValidRace = validLast3Aligned[validLast3Aligned.length - 1] || null;
  const missedLatestValidRace =
    latestValidRace != null &&
    !Number.isFinite(Number(latestValidRace.finishes?.[String(driverId)]));

  const recentDataSparse = recentRaceContext?.recentDataSparse ?? false;
  const attendanceCapsEnabled = recentRaceContext?.attendanceCapsEnabled ?? false;

  const seasonPart =
    seasonAttendanceRate != null ? seasonAttendanceRate * 100 : FANTASY_NEUTRAL_COMPONENT_SCORE;
  const recentPart =
    validLast5WindowSize > 0 && recentAttendanceRate != null
      ? recentAttendanceRate * 100
      : FANTASY_NEUTRAL_COMPONENT_SCORE;
  const reliabilityScore = Number(
    clampScore(
      recentPart * FANTASY_RELIABILITY_RECENT_WEIGHT +
        seasonPart * FANTASY_RELIABILITY_SEASON_WEIGHT,
      0,
      100
    ).toFixed(2)
  );

  return {
    completedRacesBeforeSlate,
    seasonStarts,
    seasonAttendanceRate,
    last5ScheduleWindowSize,
    last5WindowSize: validLast5WindowSize,
    last5Starts: validLast5Starts,
    last5Misses: validLast5Misses,
    validLast5WindowSize,
    validLast5Starts,
    validLast5Misses,
    recentAttendanceRate,
    last5AttendanceRate: recentAttendanceRate,
    last3ScheduleWindowSize: Array.isArray(alignedRaces) ? alignedRaces.length : 0,
    last3WindowSize: validLast3WindowSize,
    last3Starts: validLast3Starts,
    last3Misses: validLast3Misses,
    validLast3WindowSize,
    validLast3Starts,
    validLast3Misses,
    last3DnpCount: validLast3Misses,
    missedLatestRace: missedLatestValidRace,
    missedLatestValidRace,
    reliabilityScore,
    recentDataSparse,
    attendanceCapsEnabled,
    validRecentRaceCount: recentRaceContext?.validRecentRaceCount ?? validLast5WindowSize,
    validRecentRaces: recentRaceContext?.validLast5Entries ?? [],
    excludedRecentRaces: (() => {
      const seen = new Set();
      const excluded = [];
      for (const entry of [
        ...(recentRaceContext?.excludedLast5Entries ?? []),
        ...(recentRaceContext?.excludedLast3Entries ?? []),
      ]) {
        if (!seen.has(entry.pointsRaceNumber)) {
          seen.add(entry.pointsRaceNumber);
          excluded.push(entry);
        }
      }
      return excluded;
    })(),
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

  if (!attendance.attendanceCapsEnabled) {
    return { maxTierKey, reasons };
  }

  const last3Starts = Number(attendance.validLast3Starts ?? attendance.last3Starts) || 0;
  const last3WindowSize =
    Number(attendance.validLast3WindowSize ?? attendance.last3WindowSize) || 0;
  const last5Starts = Number(attendance.validLast5Starts ?? attendance.last5Starts) || 0;
  const last5WindowSize =
    Number(attendance.validLast5WindowSize ?? attendance.last5WindowSize) || 0;
  const last5Misses =
    attendance.validLast5Misses != null
      ? Number(attendance.validLast5Misses)
      : attendance.last5Misses != null
        ? Number(attendance.last5Misses)
        : last5WindowSize > 0
          ? Math.max(0, last5WindowSize - last5Starts)
          : 0;

  if (last5WindowSize > 0 && last5Starts === 0) {
    applyCap('value', 'Missed all valid last 5 races → max tier Value');
  }

  if (last3WindowSize > 0 && last3Starts === 0) {
    applyCap('midrange', 'Missed all valid last 3 races → max tier Midrange');
  }

  if (last5WindowSize > 0 && last5Misses >= 4) {
    applyCap('midrange', 'Missed 4 of valid last 5 races → max tier Midrange');
  }

  if (last5WindowSize > 0 && last5Misses >= 3) {
    applyCap('strong', 'Missed 3 of valid last 5 races → max tier Strong');
  }

  return { maxTierKey, reasons };
}

export function raceHasValidFieldFinishData(race) {
  if (!race) return false;
  const finishes = race.finishes || {};
  return Object.values(finishes).some(
    (finish) => Number.isFinite(Number(finish)) && Number(finish) >= 1
  );
}

export function buildAlignedRaceLookup(allAlignedRaces = []) {
  const byRaceNumber = new Map();
  for (const race of allAlignedRaces || []) {
    if (race.pointsRaceNumber != null) {
      byRaceNumber.set(Number(race.pointsRaceNumber), race);
    }
  }
  return byRaceNumber;
}

function describeRecentRaceEntry(scheduleRace, aligned) {
  return {
    pointsRaceNumber: Number(scheduleRace?.officialPointsRaceNumber ?? aligned?.pointsRaceNumber),
    track: scheduleRace?.track || aligned?.track || null,
    hasValidFieldFinishData: raceHasValidFieldFinishData(aligned),
    fieldFinishCount: aligned ? Object.keys(aligned.finishes || {}).length : 0,
  };
}

export function buildSlateRecentRaceContext({
  scheduleRaces,
  slateRaceNumber,
  alignedRaces = [],
  allAlignedRaces = [],
  settings = null,
  now = new Date(),
}) {
  const completed = getCompletedPointsRaces(scheduleRaces, { now, settings }).filter(
    (race) =>
      race.officialPointsRaceNumber != null &&
      Number(race.officialPointsRaceNumber) < Number(slateRaceNumber)
  );
  const last5ScheduleRaces = completed.slice(-5);
  const alignedByRaceNumber = buildAlignedRaceLookup(allAlignedRaces);

  const last5Entries = last5ScheduleRaces.map((scheduleRace) => {
    const aligned = alignedByRaceNumber.get(Number(scheduleRace.officialPointsRaceNumber));
    return describeRecentRaceEntry(scheduleRace, aligned);
  });
  const validLast5Entries = last5Entries.filter((entry) => entry.hasValidFieldFinishData);
  const excludedLast5Entries = last5Entries.filter((entry) => !entry.hasValidFieldFinishData);

  const last3Entries = (alignedRaces || []).map((race) => ({
    pointsRaceNumber: Number(race.pointsRaceNumber),
    track: race.track || null,
    hasValidFieldFinishData: raceHasValidFieldFinishData(race),
    fieldFinishCount: Object.keys(race.finishes || {}).length,
  }));
  const validLast3Entries = last3Entries.filter((entry) => entry.hasValidFieldFinishData);
  const excludedLast3Entries = last3Entries.filter((entry) => !entry.hasValidFieldFinishData);

  const validRecentRaceCount = validLast5Entries.length;
  const recentDataSparse =
    validRecentRaceCount < FANTASY_MIN_VALID_RECENT_RACES_FOR_CAPS;
  const attendanceCapsEnabled =
    !recentDataSparse &&
    validRecentRaceCount >= FANTASY_MIN_VALID_RECENT_RACES_FOR_CAPS;

  return {
    recentDataSparse,
    validRecentRaceCount,
    attendanceCapsEnabled,
    validLast5RaceNumbers: new Set(
      validLast5Entries.map((entry) => entry.pointsRaceNumber)
    ),
    validLast3RaceNumbers: new Set(
      validLast3Entries.map((entry) => entry.pointsRaceNumber)
    ),
    validLast5Entries,
    excludedLast5Entries,
    validLast3Entries,
    excludedLast3Entries,
    last5ScheduleWindowSize: last5Entries.length,
    last3AlignedWindowSize: last3Entries.length,
  };
}

export function getEffectiveFantasyTierWeights(recentDataSparse = false) {
  if (!recentDataSparse) {
    return { ...FANTASY_TIER_WEIGHTS };
  }

  const recentReduction =
    FANTASY_TIER_WEIGHTS.recentForm * FANTASY_SPARSE_RECENT_WEIGHT_REDUCTION;

  return {
    seasonPerformance: Number(
      (FANTASY_TIER_WEIGHTS.seasonPerformance + recentReduction).toFixed(4)
    ),
    recentForm: Number((FANTASY_TIER_WEIGHTS.recentForm - recentReduction).toFixed(4)),
    careerTrackHistory: FANTASY_TIER_WEIGHTS.careerTrackHistory,
    raceImpact: FANTASY_TIER_WEIGHTS.raceImpact,
    momentum: FANTASY_TIER_WEIGHTS.momentum,
    reliability: FANTASY_TIER_WEIGHTS.reliability,
  };
}

export function computeRecentFormRanks(drivers = []) {
  const sorted = [...drivers]
    .map((driver) => ({
      driverId: driver.driverId,
      rawScore: Number(driver.scoreBreakdown?.recentForm?.rawScore),
    }))
    .sort((a, b) => {
      const aScore = Number.isFinite(a.rawScore) ? a.rawScore : -Infinity;
      const bScore = Number.isFinite(b.rawScore) ? b.rawScore : -Infinity;
      return bScore - aScore;
    });

  const rankByDriver = new Map();
  sorted.forEach((entry, index) => {
    rankByDriver.set(entry.driverId, index + 1);
  });
  return rankByDriver;
}

export function computeFantasyScoreRanks(drivers = []) {
  const sorted = [...drivers]
    .map((driver) => ({
      driverId: driver.driverId,
      score: Number(driver.fantasyTierScore),
    }))
    .sort((a, b) => {
      const aScore = Number.isFinite(a.score) ? a.score : -Infinity;
      const bScore = Number.isFinite(b.score) ? b.score : -Infinity;
      return bScore - aScore;
    });

  const rankByDriver = new Map();
  sorted.forEach((entry, index) => {
    rankByDriver.set(entry.driverId, index + 1);
  });
  return rankByDriver;
}

export function getCareerTrackHistoryNormalized(driver) {
  const details = driver?.scoreBreakdown?.careerTrackHistory?.details || {};
  const normalized = Number(
    details.careerTrackHistoryNormalized ??
      details.regressedScore ??
      driver?.scoreBreakdown?.careerTrackHistory?.rawScore
  );
  return Number.isFinite(normalized) ? normalized : null;
}

const TRACK_HISTORY_SCOPE_PRIORITY = {
  career_track: 0,
  career_track_type: 1,
  blended_neutral: 2,
};

export function getTrackHistoryScope(driver) {
  const details = driver?.scoreBreakdown?.careerTrackHistory?.details || {};
  return (
    details.historyScope ??
    driver?.trackHistorySummary?.historyScope ??
    'blended_neutral'
  );
}

export function getTrackHistoryExactStarts(driver) {
  const details = driver?.scoreBreakdown?.careerTrackHistory?.details || {};
  const value = Number(
    details.careerExactTrackStarts ??
      details.exactTrackStarts ??
      details.exactStarts ??
      driver?.trackHistorySummary?.careerExactTrackStarts ??
      0
  );
  return Number.isFinite(value) ? value : 0;
}

export function getTrackHistoryTypeStarts(driver) {
  const details = driver?.scoreBreakdown?.careerTrackHistory?.details || {};
  const value = Number(
    details.careerTrackTypeStarts ??
      details.similarTrackStarts ??
      details.similarStarts ??
      driver?.trackHistorySummary?.careerTrackTypeStarts ??
      0
  );
  return Number.isFinite(value) ? value : 0;
}

export function getTrackHistorySampleQuality(historyScope) {
  switch (historyScope) {
    case 'career_track':
      return 'Proven exact track history';
    case 'career_track_type':
      return 'Proven track-type history';
    case 'blended_neutral':
      return 'Limited sample / blended neutral';
    default:
      return 'Limited sample / blended neutral';
  }
}

export function isLimitedTrackHistorySample(historyScope) {
  return historyScope === 'blended_neutral';
}

export function getTrackHistoryProvenSortMetrics(driver) {
  const historyScope = getTrackHistoryScope(driver);
  return {
    driverId: driver.driverId,
    historyScope,
    scopePriority: TRACK_HISTORY_SCOPE_PRIORITY[historyScope] ?? 99,
    norm: getCareerTrackHistoryNormalized(driver) ?? -Infinity,
    exactStarts: getTrackHistoryExactStarts(driver),
    typeStarts: getTrackHistoryTypeStarts(driver),
  };
}

export function compareProvenTrackHistoryMetrics(a, b) {
  if (a.scopePriority !== b.scopePriority) return a.scopePriority - b.scopePriority;
  if (a.norm !== b.norm) return b.norm - a.norm;
  if (a.exactStarts !== b.exactStarts) return b.exactStarts - a.exactStarts;
  return b.typeStarts - a.typeStarts;
}

export function computeTrackHistoryRanks(drivers = []) {
  const sorted = [...drivers]
    .map((driver) => ({
      driverId: driver.driverId,
      score: getCareerTrackHistoryNormalized(driver),
    }))
    .sort((a, b) => {
      const aScore = Number.isFinite(a.score) ? a.score : -Infinity;
      const bScore = Number.isFinite(b.score) ? b.score : -Infinity;
      return bScore - aScore;
    });

  const rankByDriver = new Map();
  sorted.forEach((entry, index) => {
    rankByDriver.set(entry.driverId, index + 1);
  });
  return rankByDriver;
}

export function computeProvenTrackHistoryRanks(drivers = []) {
  const sorted = [...drivers]
    .map((driver) => getTrackHistoryProvenSortMetrics(driver))
    .sort(compareProvenTrackHistoryMetrics);

  const rankByDriver = new Map();
  sorted.forEach((entry, index) => {
    rankByDriver.set(entry.driverId, index + 1);
  });
  return rankByDriver;
}

export function assignTrackHistoryRanks(drivers = []) {
  const fieldSize = drivers.length;
  const rankByDriver = computeTrackHistoryRanks(drivers);
  const provenRankByDriver = computeProvenTrackHistoryRanks(drivers);

  for (const driver of drivers) {
    const rank = rankByDriver.get(driver.driverId) ?? null;
    const provenRank = provenRankByDriver.get(driver.driverId) ?? null;
    const historyScope = getTrackHistoryScope(driver);
    const sampleQuality = getTrackHistorySampleQuality(historyScope);
    const limitedSample = isLimitedTrackHistorySample(historyScope);

    driver.trackHistoryRank = rank;
    driver.provenTrackHistoryRank = provenRank;
    driver.trackHistorySampleQuality = sampleQuality;
    driver.trackHistoryLimitedSample = limitedSample;

    if (driver.scoreBreakdown?.careerTrackHistory) {
      driver.scoreBreakdown.careerTrackHistory.details = {
        ...(driver.scoreBreakdown.careerTrackHistory.details || {}),
        trackHistoryRank: rank,
        provenTrackHistoryRank: provenRank,
        trackHistoryRankFieldSize: fieldSize,
        provenTrackHistoryRankFieldSize: fieldSize,
        trackHistorySampleQuality: sampleQuality,
        trackHistoryLimitedSample: limitedSample,
      };
    }

    if (driver.trackHistorySummary && typeof driver.trackHistorySummary === 'object') {
      driver.trackHistorySummary.trackHistoryRank = rank;
      driver.trackHistorySummary.provenTrackHistoryRank = provenRank;
      driver.trackHistorySummary.trackHistoryRankFieldSize = fieldSize;
      driver.trackHistorySummary.provenTrackHistoryRankFieldSize = fieldSize;
      driver.trackHistorySummary.trackHistorySampleQuality = sampleQuality;
      driver.trackHistorySummary.trackHistoryLimitedSample = limitedSample;
    }
  }

  return drivers;
}

export function summarizeTopTrackHistoryDrivers(drivers = [], limit = 5) {
  return summarizeTopProvenTrackHistoryDrivers(drivers, limit);
}

export function summarizeTopProvenTrackHistoryDrivers(drivers = [], limit = 5) {
  return [...drivers]
    .filter((driver) => driver.provenTrackHistoryRank != null)
    .sort((a, b) => Number(a.provenTrackHistoryRank) - Number(b.provenTrackHistoryRank))
    .slice(0, limit)
    .map((driver) => {
      const historyScope = getTrackHistoryScope(driver);
      return {
        rank: driver.provenTrackHistoryRank,
        provenTrackHistoryRank: driver.provenTrackHistoryRank,
        rawTrackHistoryRank: driver.trackHistoryRank ?? null,
        driverId: driver.driverId,
        driverName: driver.driverName,
        trackHistoryScore: getCareerTrackHistoryNormalized(driver),
        historyScope,
        sampleQuality: driver.trackHistorySampleQuality ?? getTrackHistorySampleQuality(historyScope),
        limitedSample: driver.trackHistoryLimitedSample ?? isLimitedTrackHistorySample(historyScope),
        exactStarts: getTrackHistoryExactStarts(driver),
        trackTypeStarts: getTrackHistoryTypeStarts(driver),
      };
    });
}

export function buildTrackHistoryRankingAuditRows(drivers = []) {
  assignTrackHistoryRanks(drivers);

  return [...drivers]
    .sort((a, b) => Number(a.trackHistoryRank) - Number(b.trackHistoryRank))
    .map((driver) => {
      const details = driver.scoreBreakdown?.careerTrackHistory?.details || {};
      const summary = details.summary || driver.trackHistorySummary || {};
      const historyScope = getTrackHistoryScope(driver);

      return {
        rawRank: driver.trackHistoryRank,
        provenRank: driver.provenTrackHistoryRank,
        rank: driver.trackHistoryRank,
        provenTrackHistoryRank: driver.provenTrackHistoryRank,
        driver: driver.driverName,
        trackHistoryRaw:
          details.careerTrackHistoryRaw ??
          details.actualTrackScore ??
          driver.scoreBreakdown?.careerTrackHistory?.rawScore ??
          null,
        trackHistoryNorm: getCareerTrackHistoryNormalized(driver),
        historyScope,
        sampleQuality:
          driver.trackHistorySampleQuality ?? getTrackHistorySampleQuality(historyScope),
        limitedSample:
          driver.trackHistoryLimitedSample ?? isLimitedTrackHistorySample(historyScope),
        exactStarts: getTrackHistoryExactStarts(driver),
        trackTypeStarts: getTrackHistoryTypeStarts(driver),
        averageFinish: summary.averageFinish ?? null,
        wins: summary.wins ?? null,
        top5: summary.top5s ?? null,
        top10: summary.top10s ?? null,
      };
    });
}

export function buildProvenTrackHistoryRankingAuditRows(drivers = []) {
  assignTrackHistoryRanks(drivers);

  return [...drivers]
    .sort((a, b) => Number(a.provenTrackHistoryRank) - Number(b.provenTrackHistoryRank))
    .map((driver) => {
      const details = driver.scoreBreakdown?.careerTrackHistory?.details || {};
      const summary = details.summary || driver.trackHistorySummary || {};
      const historyScope = getTrackHistoryScope(driver);

      return {
        rawRank: driver.trackHistoryRank,
        provenRank: driver.provenTrackHistoryRank,
        driver: driver.driverName,
        trackHistoryRaw:
          details.careerTrackHistoryRaw ??
          details.actualTrackScore ??
          driver.scoreBreakdown?.careerTrackHistory?.rawScore ??
          null,
        trackHistoryNorm: getCareerTrackHistoryNormalized(driver),
        historyScope,
        sampleQuality:
          driver.trackHistorySampleQuality ?? getTrackHistorySampleQuality(historyScope),
        limitedSample:
          driver.trackHistoryLimitedSample ?? isLimitedTrackHistorySample(historyScope),
        exactStarts: getTrackHistoryExactStarts(driver),
        trackTypeStarts: getTrackHistoryTypeStarts(driver),
        averageFinish: summary.averageFinish ?? null,
        wins: summary.wins ?? null,
        top5: summary.top5s ?? null,
        top10: summary.top10s ?? null,
      };
    });
}

export function computeDriverTierEligibility(drivers = []) {
  const recentFormRanks = computeRecentFormRanks(drivers);
  const fantasyScoreRanks = computeFantasyScoreRanks(drivers);

  for (const driver of drivers) {
    const attendance = driver.attendanceContext || {};
    const { maxTierKey } = computeMaxAllowedTierKey(attendance);
    const maxRank = FANTASY_TIER_RANK[maxTierKey] ?? 0;
    const recentRate =
      attendance.recentAttendanceRate ?? attendance.last5AttendanceRate ?? null;
    const pointsPosition = Number(driver.pointsPosition);
    const recentFormRank = recentFormRanks.get(driver.driverId) ?? drivers.length;
    const fantasyScoreRank = fantasyScoreRanks.get(driver.driverId) ?? drivers.length;

    const topTierReasons = [];
    let topTierEligible = true;

    if (
      !attendance.recentDataSparse &&
      (recentRate == null ||
        recentRate < FANTASY_TOP_TIER_RECENT_ATTENDANCE_THRESHOLD)
    ) {
      topTierEligible = false;
      topTierReasons.push(
        `Recent attendance below ${Math.round(FANTASY_TOP_TIER_RECENT_ATTENDANCE_THRESHOLD * 100)}% (${formatAttendanceRate(recentRate)})`
      );
    }

    if (maxRank < FANTASY_TIER_RANK.top_tier) {
      topTierEligible = false;
      topTierReasons.push(
        `Hard cap removed Top Tier eligibility (max ${maxTierKey.replace(/_/g, ' ')})`
      );
    }

    const standingsOk =
      Number.isFinite(pointsPosition) &&
      pointsPosition <= FANTASY_TOP_TIER_STANDINGS_CUTOFF;
    const recentOk = recentFormRank <= FANTASY_TOP_TIER_RECENT_FORM_RANK_CUTOFF;
    const scoreOk = fantasyScoreRank <= FANTASY_TOP_TIER_SCORE_RANK_CUTOFF;

    if (!standingsOk && !recentOk && !scoreOk) {
      topTierEligible = false;
      topTierReasons.push(
        `Not P${FANTASY_TOP_TIER_STANDINGS_CUTOFF} or better, not top ${FANTASY_TOP_TIER_RECENT_FORM_RANK_CUTOFF} recent form (rank ${recentFormRank}), and not top ${FANTASY_TOP_TIER_SCORE_RANK_CUTOFF} fantasy score (rank ${fantasyScoreRank})`
      );
    }

    driver.recentFormRank = recentFormRank;
    driver.fantasyScoreRank = fantasyScoreRank;
    driver.topTierEligible = topTierEligible;
    driver.topTierEligibleReasons = topTierEligible ? [] : topTierReasons;

    const eliteReasons = [];
    let eliteEligible = true;

    if (
      !attendance.recentDataSparse &&
      (recentRate == null ||
        recentRate < FANTASY_ELITE_RECENT_ATTENDANCE_THRESHOLD)
    ) {
      eliteEligible = false;
      eliteReasons.push(
        `Recent attendance below ${Math.round(FANTASY_ELITE_RECENT_ATTENDANCE_THRESHOLD * 100)}% (${formatAttendanceRate(recentRate)})`
      );
    }

    if (maxRank < FANTASY_TIER_RANK.strong) {
      eliteEligible = false;
      eliteReasons.push(
        `Hard-capped to Midrange or Value (max ${maxTierKey.replace(/_/g, ' ')})`
      );
    }

    driver.eliteEligible = eliteEligible;
    driver.eliteEligibleReasons = eliteEligible ? [] : eliteReasons;
  }

  return drivers;
}

function formatAttendanceRate(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return 'n/a';
  return `${Math.round(Number(rate) * 100)}%`;
}

export function isTopTierRecoveryCandidate(driver) {
  if (driver.topTierEligible !== true) return false;

  const attendance = driver.attendanceContext || {};
  const { maxTierKey } = computeMaxAllowedTierKey(attendance);
  return (FANTASY_TIER_RANK[maxTierKey] ?? 0) >= FANTASY_TIER_RANK.top_tier;
}

export function isEliteRecoveryCandidate(driver) {
  if (driver.eliteEligible !== true) return false;

  const attendance = driver.attendanceContext || {};
  const { maxTierKey } = computeMaxAllowedTierKey(attendance);
  return (FANTASY_TIER_RANK[maxTierKey] ?? 0) >= FANTASY_TIER_RANK.elite;
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

  let topTierSlotsUnfilled = 0;
  let topTierRecoverySkippedNoEligible = false;

  if ((counts.top_tier || 0) < topTierTarget) {
    const needed = topTierTarget - (counts.top_tier || 0);
    const candidates = sorted.filter(
      (driver) =>
        driver.computedTierKey !== 'top_tier' && isTopTierRecoveryCandidate(driver)
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

    topTierSlotsUnfilled = Math.max(0, needed - candidates.length);
    topTierRecoverySkippedNoEligible = candidates.length === 0 && needed > 0;
  }

  counts = countByTierKey();

  const eliteTarget = Math.max(FANTASY_ELITE_RECOVERY_TARGET, slotTargets.elite || 0);

  if ((counts.elite || 0) < eliteTarget) {
    const needed = eliteTarget - (counts.elite || 0);
    const candidates = sorted.filter(
      (driver) =>
        driver.computedTierKey !== 'top_tier' &&
        driver.computedTierKey !== 'elite' &&
        isEliteRecoveryCandidate(driver)
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
    topTierSlotsUnfilled,
    topTierRecoverySkippedNoEligible,
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
            last5Starts: attendanceContext.validLast5Starts ?? attendanceContext.last5Starts,
            last5WindowSize:
              attendanceContext.validLast5WindowSize ?? attendanceContext.last5WindowSize,
            last5Misses: attendanceContext.validLast5Misses ?? attendanceContext.last5Misses,
            recentAttendanceRate: attendanceContext.recentAttendanceRate,
            last5AttendanceRate: attendanceContext.last5AttendanceRate,
            validRecentRaceCount: attendanceContext.validRecentRaceCount,
            validRecentRaces: attendanceContext.validRecentRaces,
            excludedRecentRaces: attendanceContext.excludedRecentRaces,
            recentDataSparse: attendanceContext.recentDataSparse,
            attendanceCapsEnabled: attendanceContext.attendanceCapsEnabled,
            missedLatestRace: attendanceContext.missedLatestRace,
            reliabilityBlend: '70% recent / 30% season',
          }
        : {},
    },
  };

  const fantasyTierScoreRaw = Number(
    computeWeightedFantasyTierScore(components, { useRawScores: true }).toFixed(2)
  );

  return {
    fantasyTierScoreRaw,
    fantasyTierScore: null,
    components,
  };
}

export function computeWeightedFantasyTierScore(
  components,
  { useRawScores = false } = {}
) {
  return FANTASY_COMPONENT_KEYS.reduce((sum, key) => {
    const component = components[key];
    if (!component) return sum;
    const weight = component.weight ?? FANTASY_TIER_WEIGHTS[key] ?? 0;
    const value = useRawScores
      ? Number(component.rawScore)
      : Number(component.normalizedScore);
    if (!Number.isFinite(value)) return sum;
    return sum + value * weight;
  }, 0);
}

export function applyEffectiveComponentWeights(drivers = [], effectiveWeights = FANTASY_TIER_WEIGHTS) {
  for (const driver of drivers) {
    for (const key of FANTASY_COMPONENT_KEYS) {
      const component = driver.scoreBreakdown?.[key];
      if (component) {
        component.weight = effectiveWeights[key] ?? component.weight;
      }
    }
  }
  return drivers;
}

export function normalizeFantasySlateComponents(
  drivers = [],
  { effectiveWeights = FANTASY_TIER_WEIGHTS, recentDataSparse = false } = {}
) {
  applyEffectiveComponentWeights(drivers, effectiveWeights);

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
    driver.recentDataSparse = recentDataSparse;
    driver.effectiveWeights = { ...effectiveWeights };
    driver.fantasyTierScoreRaw = Number(
      computeWeightedFantasyTierScore(driver.scoreBreakdown, {
        useRawScores: true,
      }).toFixed(2)
    );
    driver.fantasyTierScore = clampScore(
      computeWeightedFantasyTierScore(driver.scoreBreakdown),
      0,
      100
    );
    if (driver.scoreBreakdown) {
      driver.scoreBreakdown._recentDataSparse = recentDataSparse;
      driver.scoreBreakdown._effectiveWeights = { ...effectiveWeights };
    }
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
  computeDriverTierEligibility(drivers);
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
    careerTrackHistoryScore:
      trackHistory?.careerTrackHistoryNormalized ??
      trackHistory?.score ??
      FANTASY_NEUTRAL_COMPONENT_SCORE,
    priorTierScore,
    attendanceContext,
  });

  components.careerTrackHistory.details = {
    scope: trackHistory?.scoringScope ?? trackHistory?.scope ?? null,
    historyScope: trackHistory?.historyScope ?? 'career_track_type',
    scoringScope: trackHistory?.scoringScope ?? trackHistory?.scope ?? null,
    fallbackUsed: trackHistory?.fallbackUsed ?? false,
    dataSource: trackHistory?.dataSource ?? 'career history',
    summary: trackHistory?.summary ?? null,
    scoreDetails: trackHistory?.scoreDetails ?? null,
    actualTrackScore: trackHistory?.actualTrackScore ?? null,
    careerTrackHistoryRaw: trackHistory?.careerTrackHistoryRaw ?? trackHistory?.actualTrackScore ?? null,
    careerTrackHistoryNormalized:
      trackHistory?.careerTrackHistoryNormalized ?? trackHistory?.score ?? null,
    sampleSize: trackHistory?.summary?.starts ?? trackHistory?.scoreDetails?.sampleSize ?? null,
    regressionApplied: trackHistory?.scoreDetails?.regressionApplied ?? false,
    regressedScore: trackHistory?.score ?? null,
    upcomingTrackMatch: trackHistory?.upcomingTrackMatch ?? null,
    trackTypeUsed: trackHistory?.trackTypeUsed ?? null,
    exactTrackStarts: trackHistory?.exactTrackStarts ?? trackHistory?.careerExactTrackStarts ?? null,
    similarTrackStarts:
      trackHistory?.similarTrackStarts ?? trackHistory?.careerTrackTypeStarts ?? null,
    exactStarts: trackHistory?.exactStarts ?? trackHistory?.careerExactTrackStarts ?? null,
    similarStarts: trackHistory?.similarStarts ?? trackHistory?.careerTrackTypeStarts ?? null,
    careerExactTrackStarts: trackHistory?.careerExactTrackStarts ?? null,
    careerTrackTypeStarts: trackHistory?.careerTrackTypeStarts ?? null,
    careerTrackWins: trackHistory?.careerTrackWins ?? null,
    careerTrackTop5s: trackHistory?.careerTrackTop5s ?? null,
    careerTrackTop10s: trackHistory?.careerTrackTop10s ?? null,
    careerTrackAverageFinish: trackHistory?.careerTrackAverageFinish ?? null,
    careerTrackTypeWins: trackHistory?.careerTrackTypeWins ?? null,
    careerTrackTypeTop5s: trackHistory?.careerTrackTypeTop5s ?? null,
    careerTrackTypeTop10s: trackHistory?.careerTrackTypeTop10s ?? null,
    careerTrackTypeAverageFinish: trackHistory?.careerTrackTypeAverageFinish ?? null,
    diagnostics: trackHistory?.diagnostics ?? null,
  };

  return {
    driverId: String(driverId),
    driverName: driverName || standingsRow?.driverName || '',
    carNumber: carNumber || standingsRow?.carNumber || '',
    pointsPosition: Number.isFinite(Number(standingsRow?.position))
      ? Number(standingsRow.position)
      : null,
    fantasyTierScoreRaw,
    fantasyTierScore: null,
    computedTier: null,
    computedTierKey: null,
    salaryBand: null,
    baseSalaryInBand: null,
    scoreBreakdown: components,
    trackHistorySummary: trackHistory?.summary
      ? {
          historyScope: trackHistory.historyScope ?? 'career_track_type',
          dataSource: trackHistory.dataSource ?? 'career history',
          scope: trackHistory.scoringScope ?? trackHistory.scope,
          fallbackUsed: trackHistory.fallbackUsed,
          similarTrackType: trackHistory.similarTrackType,
          upcomingTrack: trackHistory.upcomingTrack,
          careerExactTrackStarts: trackHistory.careerExactTrackStarts,
          careerTrackTypeStarts: trackHistory.careerTrackTypeStarts,
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

export function summarizeTierEligibility(drivers = []) {
  return {
    topTierEligible: drivers.filter((driver) => driver.topTierEligible).length,
    eliteEligible: drivers.filter((driver) => driver.eliteEligible).length,
  };
}
