import { deriveDriverActivityStatus } from './_driver-activity.js';

export const SALARY_ENGINE_VERSION = 'fantasy-salary-v2.6';

const SALARY_ROUND_TO = 100;

const TIER_BANDS = {
  top_tier: { salaryMin: 13500, salaryMax: 15000 },
  elite: { salaryMin: 11000, salaryMax: 13500 },
  strong: { salaryMin: 9000, salaryMax: 11000 },
  midrange: { salaryMin: 7000, salaryMax: 9000 },
  value: { salaryMin: 4500, salaryMax: 7000 },
};

function clampSalaryToBand(value, band) {
  const n = Number(value);
  const min = Number(band?.min);
  const max = Number(band?.max);
  if (!Number.isFinite(n)) return Number.isFinite(min) ? min : 4500;
  const lo = Number.isFinite(min) ? min : 4500;
  const hi = Number.isFinite(max) ? max : 15000;
  return Math.min(hi, Math.max(lo, n));
}

function roundSalary(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 4500;
  const rounded = Math.round(n / SALARY_ROUND_TO) * SALARY_ROUND_TO;
  return Math.min(15000, Math.max(4500, rounded));
}

function roundSalaryInBand(value, band) {
  const clamped = clampSalaryToBand(value, band);
  const rounded = Math.round(clamped / SALARY_ROUND_TO) * SALARY_ROUND_TO;
  return clampSalaryToBand(rounded, band);
}

function mapScoreToSalaryInTierBand(tier, tierScores, driverScore) {
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

const ACTIVITY_MULTIPLIER_BY_STARTS = {
  5: 1,
  4: 0.95,
  3: 0.9,
  2: 0.8,
  1: 0.65,
  0: 0.45,
};

const CONSECUTIVE_DNP_PENALTY = {
  0: 0,
  1: 5,
  2: 12,
  3: 20,
};

const MAX_WEEKLY_INCREASE_BY_TIER = {
  top_tier: 800,
  elite: 800,
  strong: 700,
  midrange: 600,
  value: 500,
};

const NEW_DRIVER_MOVEMENT_CAP_BY_STARTS = {
  1: 300,
  2: 500,
};

export function extractSeasonStarts(driver = {}) {
  const attendance = driver.attendanceContext || {};
  const seasonStarts = Number(attendance.seasonStarts ?? attendance.season_starts ?? 0);
  return Number.isFinite(seasonStarts) ? Math.max(0, seasonStarts) : 0;
}

export function getNewDriverMovementCap(seasonStarts) {
  const starts = Math.max(0, Number(seasonStarts) || 0);
  if (starts >= 3) return null;
  return NEW_DRIVER_MOVEMENT_CAP_BY_STARTS[starts] ?? null;
}

export function applyNewDriverProtection(salary, priorSalary, seasonStarts) {
  const prior = Number(priorSalary);
  const current = Number(salary);
  const cap = getNewDriverMovementCap(seasonStarts);

  if (cap == null || !Number.isFinite(prior) || prior <= 0 || !Number.isFinite(current)) {
    return {
      salary: current,
      applied: false,
      seasonStarts: Math.max(0, Number(seasonStarts) || 0),
      newDriverMovementCap: null,
      movementCapReason: null,
    };
  }

  const floor = prior - cap;
  const ceiling = prior + cap;
  const adjusted = Math.min(ceiling, Math.max(floor, current));
  const applied = adjusted !== current;
  const starts = Math.max(0, Number(seasonStarts) || 0);
  const movementCapReason = applied
    ? `${starts} season start${starts === 1 ? '' : 's'} — salary movement capped at ±$${cap.toLocaleString('en-US')}`
    : null;

  return {
    salary: adjusted,
    applied,
    seasonStarts: starts,
    newDriverMovementCap: cap,
    movementCapReason,
  };
}

export function getActivityMultiplier(recentStarts) {
  const starts = Math.min(5, Math.max(0, Number(recentStarts) || 0));
  return ACTIVITY_MULTIPLIER_BY_STARTS[starts] ?? ACTIVITY_MULTIPLIER_BY_STARTS[0];
}

export function getConsecutiveDnpPenalty(consecutiveDnpCount) {
  const count = Math.max(0, Number(consecutiveDnpCount) || 0);
  if (count >= 4) return 30;
  return CONSECUTIVE_DNP_PENALTY[count] ?? 0;
}

export function countConsecutiveDnps(alignedRaces = [], driverId) {
  const id = String(driverId);
  const races = [...alignedRaces].reverse();
  let count = 0;

  for (const race of races) {
    const finish = Number(race?.finishes?.[id]);
    if (Number.isFinite(finish) && finish >= 1) break;
    count += 1;
  }

  return count;
}

export function isDriverDnpInRace(race, driverId) {
  // Attendance/DNP streaks derive from official aligned race finishes, not fantasy score metadata.
  if (!race) return true;
  const id = String(driverId);
  if (race.provisionalDriverIds?.includes?.(id) || race.driverResults?.[id]?.isProvisional) {
    return true;
  }
  const finish = Number(race.finishes?.[id]);
  return !Number.isFinite(finish) || finish < 1;
}

export function extractRecentStarts(driver = {}) {
  const attendance = driver.attendanceContext || {};
  const recentStarts = Number(
    attendance.validLast5Starts ?? attendance.last5Starts ?? 0,
  );
  const recentWindow = Number(
    attendance.validLast5WindowSize ?? attendance.last5WindowSize ?? 5,
  );
  const recentAttendanceRate =
    attendance.recentAttendanceRate ?? attendance.last5AttendanceRate ?? null;

  return {
    recentStarts: Number.isFinite(recentStarts) ? recentStarts : 0,
    recentWindow: Number.isFinite(recentWindow) ? recentWindow : 5,
    recentAttendanceRate,
  };
}

export function buildSalaryGuardrailContext(driver = {}, alignedRaces = []) {
  const { recentStarts, recentWindow, recentAttendanceRate } = extractRecentStarts(driver);
  const seasonStarts = extractSeasonStarts(driver);
  const consecutiveDnpCount = countConsecutiveDnps(alignedRaces, driver.driverId);
  const activityMultiplier = getActivityMultiplier(recentStarts);
  const consecutiveDnpPenalty = getConsecutiveDnpPenalty(consecutiveDnpCount);
  const activity = deriveDriverActivityStatus(driver);

  const aligned = Array.isArray(alignedRaces) ? alignedRaces : [];
  const lastRace = aligned[aligned.length - 1] || null;
  const last2Races = aligned.slice(-2);
  const last3Races = aligned.slice(-3);

  return {
    activityMultiplier,
    recentStarts,
    recentWindow,
    recentAttendanceRate,
    seasonStarts,
    consecutiveDnpCount,
    consecutiveDnpPenalty,
    inactive: activity.status === 'Inactive',
    lastRaceDnp: isDriverDnpInRace(lastRace, driver.driverId),
    last2AllDnp:
      last2Races.length >= 2 &&
      last2Races.every((race) => isDriverDnpInRace(race, driver.driverId)),
    last3AllDnp:
      last3Races.length >= 3 &&
      last3Races.every((race) => isDriverDnpInRace(race, driver.driverId)),
  };
}

export function applyV26TierScoreAdjustments(drivers = [], alignedRacesByDriver = new Map()) {
  for (const driver of drivers) {
    const alignedRaces =
      alignedRacesByDriver.get(String(driver.driverId)) || driver._alignedRaces || [];
    const context = buildSalaryGuardrailContext(driver, alignedRaces);
    const baseScore = Number(driver.fantasyTierScore);
    const adjusted = Math.max(
      0,
      baseScore * context.activityMultiplier - context.consecutiveDnpPenalty,
    );

    driver.fantasyTierScoreBeforeActivity = baseScore;
    driver.fantasyTierScore = Number(adjusted.toFixed(4));
    driver.activityMultiplier = context.activityMultiplier;
    driver.recentStarts = context.recentStarts;
    driver.recentAttendanceRate = context.recentAttendanceRate;
    driver.consecutiveDnpCount = context.consecutiveDnpCount;
    driver.consecutiveDnpPenalty = context.consecutiveDnpPenalty;
    driver.salaryGuardrailContext = context;

    if (driver.scoreBreakdown) {
      driver.scoreBreakdown._v26Activity = {
        fantasyTierScoreBeforeActivity: baseScore,
        fantasyTierScoreAfterActivity: driver.fantasyTierScore,
        activityMultiplier: context.activityMultiplier,
        recentStarts: context.recentStarts,
        recentAttendanceRate: context.recentAttendanceRate,
        consecutiveDnpCount: context.consecutiveDnpCount,
        consecutiveDnpPenalty: context.consecutiveDnpPenalty,
      };
    }
  }

  return drivers;
}

export function mapScoreToSalaryInBandWithTierCap(tier, tierScores, driverScore, recentStarts) {
  const uncappedSalary = mapScoreToSalaryInTierBand(tier, tierScores, driverScore);
  const starts = Number(recentStarts) || 0;

  if (starts !== 0) {
    return {
      salary: uncappedSalary,
      tierProgressCapApplied: false,
      tierProgressCapMax: null,
      uncappedBandSalary: uncappedSalary,
    };
  }

  const capSalary = Math.round(tier.salaryMin + (tier.salaryMax - tier.salaryMin) * 0.5);
  const cappedSalary = Math.min(uncappedSalary, capSalary);

  return {
    salary: cappedSalary,
    tierProgressCapApplied: cappedSalary < uncappedSalary,
    tierProgressCapMax: capSalary,
    uncappedBandSalary: uncappedSalary,
  };
}

function applyMovementGuardrails(salary, priorSalary, context = {}) {
  const prior = Number(priorSalary);
  const current = Number(salary);
  const notes = [];
  let adjusted = current;
  let guardrailApplied = false;
  let movementLimited = false;

  if (!Number.isFinite(prior) || prior <= 0) {
    return {
      salary: adjusted,
      salaryGuardrailApplied: false,
      salaryMovementLimited: false,
      guardrailNotes: notes,
    };
  }

  if (context.recentStarts === 0 && adjusted > prior) {
    adjusted = prior;
    guardrailApplied = true;
    movementLimited = true;
    notes.push('0 starts in last five scheduled races: salary cannot increase.');
  }

  if (context.lastRaceDnp && adjusted > prior) {
    adjusted = prior;
    guardrailApplied = true;
    movementLimited = true;
    notes.push('Last race DNP/DNS: salary cannot increase.');
  }

  if (context.last2AllDnp && adjusted > prior) {
    adjusted = prior;
    guardrailApplied = true;
    movementLimited = true;
    notes.push('Last 2 races DNP/DNS: maximum increase $0.');
  }

  if (context.last3AllDnp) {
    const minimumDecreaseTarget = prior - 300;
    if (adjusted > minimumDecreaseTarget) {
      adjusted = minimumDecreaseTarget;
      guardrailApplied = true;
      movementLimited = true;
      notes.push('Last 3 races DNP/DNS: salary must decrease by at least $300.');
    }
  }

  if (context.recentStarts === 0 && context.inactive && adjusted > prior) {
    adjusted = prior;
    guardrailApplied = true;
    movementLimited = true;
    notes.push('Inactive with 0 recent starts: no positive salary movement allowed.');
  }

  return {
    salary: adjusted,
    salaryGuardrailApplied: guardrailApplied,
    salaryMovementLimited: movementLimited,
    guardrailNotes: notes,
  };
}

function applyMaxWeeklyIncrease(salary, priorSalary, tierKey) {
  const prior = Number(priorSalary);
  const current = Number(salary);
  if (!Number.isFinite(prior) || prior <= 0 || !Number.isFinite(current)) {
    return { salary: current, limited: false, maxIncrease: null };
  }

  const maxIncrease = MAX_WEEKLY_INCREASE_BY_TIER[tierKey] ?? 500;
  const ceiling = prior + maxIncrease;
  if (current <= ceiling) {
    return { salary: current, limited: false, maxIncrease };
  }

  return {
    salary: ceiling,
    limited: true,
    maxIncrease,
  };
}

export function applyV26SalaryGuardrails(driver = {}, alignedRaces = []) {
  const context = driver.salaryGuardrailContext || buildSalaryGuardrailContext(driver, alignedRaces);
  const priorSalary = Number(driver.priorSalary ?? driver.previousSalary);
  const band = driver.salaryBand || { min: 4500, max: 15000 };
  const salaryBeforeGuardrails = Number(driver.generatedSalary);

  let salary = salaryBeforeGuardrails;
  const movement = applyMovementGuardrails(salary, priorSalary, context);
  salary = movement.salary;

  const maxIncrease = applyMaxWeeklyIncrease(
    salary,
    priorSalary,
    driver.computedTierKey || 'value',
  );
  salary = maxIncrease.salary;

  const seasonStarts =
    context.seasonStarts ??
    extractSeasonStarts(driver);
  const newDriver = applyNewDriverProtection(salary, priorSalary, seasonStarts);
  salary = newDriver.salary;

  const rounded = roundSalaryInBand(roundSalary(salary), band);
  const salaryAfterGuardrails = rounded;

  const diagnostics = {
    salaryEngineVersion: SALARY_ENGINE_VERSION,
    activityMultiplier: context.activityMultiplier,
    recentStarts: context.recentStarts,
    recentAttendanceRate: context.recentAttendanceRate,
    seasonStarts: newDriver.seasonStarts,
    consecutiveDnpCount: context.consecutiveDnpCount,
    consecutiveDnpPenalty: context.consecutiveDnpPenalty,
    newDriverProtectionApplied: newDriver.applied,
    newDriverMovementCap: newDriver.newDriverMovementCap,
    movementCapReason: newDriver.movementCapReason,
    salaryGuardrailApplied:
      movement.salaryGuardrailApplied ||
      maxIncrease.limited ||
      newDriver.applied ||
      Boolean(driver.tierProgressCapApplied),
    salaryMovementLimited:
      movement.salaryMovementLimited || maxIncrease.limited || newDriver.applied,
    tierProgressCapApplied: Boolean(driver.tierProgressCapApplied),
    tierProgressCapMax: driver.tierProgressCapMax ?? null,
    uncappedBandSalary: driver.uncappedBandSalary ?? null,
    salaryBeforeGuardrails,
    salaryAfterGuardrails,
    guardrailNotes: [
      ...(movement.guardrailNotes || []),
      ...(maxIncrease.limited
        ? [`Absolute weekly increase capped at $${maxIncrease.maxIncrease}.`]
        : []),
      ...(newDriver.applied && newDriver.movementCapReason
        ? [`New Driver Protection: ${newDriver.movementCapReason}.`]
        : []),
      ...(driver.tierProgressCapApplied
        ? [`Tier progress cap: inactive drivers limited to 50% of salary band (max $${driver.tierProgressCapMax}).`]
        : []),
    ],
  };

  Object.assign(driver, diagnostics);
  driver.salaryGuardrails = diagnostics;

  if (driver.scoreBreakdown) {
    driver.scoreBreakdown._v26Guardrails = diagnostics;
  }

  return salaryAfterGuardrails;
}

export function buildGuardrailExplanationLines(driver = {}) {
  const g = driver.salaryGuardrails || {};
  const lines = [];

  lines.push(`Recent Starts: ${g.recentStarts ?? driver.recentStarts ?? 0}/5`);
  lines.push(`Activity Multiplier: ${g.activityMultiplier ?? driver.activityMultiplier ?? 1}`);
  lines.push(`Consecutive DNP: ${g.consecutiveDnpCount ?? driver.consecutiveDnpCount ?? 0}`);

  if ((g.consecutiveDnpPenalty ?? driver.consecutiveDnpPenalty) > 0) {
    lines.push(
      `Consecutive DNP penalty: -${g.consecutiveDnpPenalty ?? driver.consecutiveDnpPenalty} tier score points`,
    );
  }

  if (g.guardrailNotes?.length) {
    lines.push('Guardrail:');
    for (const note of g.guardrailNotes) lines.push(`  ${note}`);
  } else if (g.salaryGuardrailApplied) {
    lines.push('Guardrail: Salary movement limits applied.');
  } else {
    lines.push('Guardrail: None applied.');
  }

  if (g.tierProgressCapApplied) {
    lines.push(`Tier Progress Cap: 50% (max $${(g.tierProgressCapMax ?? driver.tierProgressCapMax ?? '—').toLocaleString('en-US')})`);
  }

  if (g.newDriverProtectionApplied) {
    lines.push(
      `New Driver Protection: ${g.seasonStarts ?? driver.seasonStarts ?? 0} season start${(g.seasonStarts ?? driver.seasonStarts) === 1 ? '' : 's'} — salary movement capped at ±$${(g.newDriverMovementCap ?? driver.newDriverMovementCap ?? '—').toLocaleString('en-US')}`,
    );
  } else if ((g.seasonStarts ?? driver.seasonStarts) != null && (g.seasonStarts ?? driver.seasonStarts) >= 3) {
    lines.push(`New Driver Protection: not applied (${g.seasonStarts ?? driver.seasonStarts} season starts)`);
  }

  if (g.uncappedBandSalary != null && g.salaryBeforeGuardrails != null) {
    lines.push(
      `Pre-guardrail candidate: $${Number(g.uncappedBandSalary).toLocaleString('en-US')} band → $${Number(g.salaryBeforeGuardrails).toLocaleString('en-US')} after smoothing`,
    );
  }

  if (g.salaryBeforeGuardrails != null && g.salaryAfterGuardrails != null &&
      g.salaryBeforeGuardrails !== g.salaryAfterGuardrails) {
    lines.push(
      `Final salary adjusted from $${Number(g.salaryBeforeGuardrails).toLocaleString('en-US')} to $${Number(g.salaryAfterGuardrails).toLocaleString('en-US')}.`,
    );
  }

  return lines;
}
