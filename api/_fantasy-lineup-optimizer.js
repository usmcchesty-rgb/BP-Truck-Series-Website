const DEFAULT_SALARY_CAP = 50000;
const DEFAULT_LINEUP_SIZE = 5;
const VALUE_MID_TIER_PATTERN = /value|mid/i;

function driverSalary(driver) {
  return Number(driver.finalSalary ?? driver.generatedSalary);
}

function driverScore(driver, scoreField = 'fantasyTierScore') {
  return Number(driver[scoreField] ?? driver.fantasyTierScore);
}

function isValueOrMidTier(driver) {
  return VALUE_MID_TIER_PATTERN.test(String(driver.computedTier || ''));
}

function lineupKey(drivers = []) {
  return drivers
    .map((driver) => String(driver.driverId))
    .sort()
    .join('|');
}

function summarizeLineup(drivers = [], salaryCap = DEFAULT_SALARY_CAP, scoreField = 'fantasyTierScore') {
  const totalSalary = drivers.reduce((sum, driver) => sum + driverSalary(driver), 0);
  const projectedScore = drivers.reduce((sum, driver) => sum + driverScore(driver, scoreField), 0);
  const valueScores = drivers
    .map((driver) => Number(driver.valueScore))
    .filter((value) => Number.isFinite(value));
  const averageValueScore = valueScores.length
    ? Number((valueScores.reduce((sum, value) => sum + value, 0) / valueScores.length).toFixed(2))
    : null;

  return {
    drivers: drivers.map((driver) => ({
      driverId: driver.driverId,
      driverName: driver.driverName,
      carNumber: driver.carNumber || null,
      computedTier: driver.computedTier || null,
      finalSalary: driverSalary(driver),
      fantasyTierScore: driverScore(driver, scoreField),
      valueScore: driver.valueScore ?? null,
      valueGrade: driver.valueGrade ?? null,
    })),
    totalSalary,
    projectedScore: Number(projectedScore.toFixed(1)),
    remainingSalary: salaryCap - totalSalary,
    averageSalary: drivers.length ? Math.round(totalSalary / drivers.length) : 0,
    averageValueScore,
    valueGrades: drivers.map((driver) => driver.valueGrade).filter(Boolean),
  };
}

function considerLineup(topLineups, candidate, salaryCap, scoreField, maxAlternatives = 5) {
  const key = lineupKey(candidate.drivers);
  const filtered = topLineups.filter((entry) => lineupKey(entry.drivers) !== key);
  filtered.push(candidate);
  filtered.sort((a, b) => {
    if (b.projectedScore !== a.projectedScore) return b.projectedScore - a.projectedScore;
    return a.totalSalary - b.totalSalary;
  });
  return filtered.slice(0, maxAlternatives);
}

export function optimizeFantasyLineup(drivers = [], options = {}) {
  const salaryCap = Number(options.salaryCap ?? DEFAULT_SALARY_CAP);
  const lineupSize = Number(options.lineupSize ?? DEFAULT_LINEUP_SIZE);
  const requireValueOrMid = Boolean(options.requireValueOrMid);
  const scoreField = options.scoreField || 'fantasyTierScore';
  const maxAlternatives = Number(options.maxAlternatives ?? 5);

  const eligible = drivers.filter((driver) => {
    const salary = driverSalary(driver);
    const score = driverScore(driver, scoreField);
    return Number.isFinite(salary) && salary > 0 && Number.isFinite(score);
  });

  if (eligible.length < lineupSize) {
    return {
      ok: false,
      error: `Need at least ${lineupSize} eligible drivers with salaries and scores.`,
      salaryCap,
      lineupSize,
      eligibleCount: eligible.length,
    };
  }

  let topLineups = [];
  const combo = [];

  function search(startIndex) {
    if (combo.length === lineupSize) {
      const totalSalary = combo.reduce((sum, driver) => sum + driverSalary(driver), 0);
      if (totalSalary > salaryCap) return;
      if (requireValueOrMid && !combo.some(isValueOrMidTier)) return;

      const summary = summarizeLineup(combo, salaryCap, scoreField);
      topLineups = considerLineup(topLineups, summary, salaryCap, scoreField, maxAlternatives);
      return;
    }

    for (let i = startIndex; i <= eligible.length - (lineupSize - combo.length); i += 1) {
      combo.push(eligible[i]);
      search(i + 1);
      combo.pop();
    }
  }

  search(0);

  if (!topLineups.length) {
    return {
      ok: false,
      error: requireValueOrMid
        ? 'No valid lineup found under cap with a Value/Mid-Tier driver.'
        : 'No valid lineup found under salary cap.',
      salaryCap,
      lineupSize,
      eligibleCount: eligible.length,
      requireValueOrMid,
    };
  }

  return {
    ok: true,
    salaryCap,
    lineupSize,
    requireValueOrMid,
    eligibleCount: eligible.length,
    combinationsEvaluated: null,
    optimalLineup: topLineups[0],
    alternativeLineups: topLineups.slice(1),
  };
}

export function finishPositionProxyPoints(finish) {
  const position = Number(finish);
  if (!Number.isFinite(position) || position <= 0) return 0;
  if (position === 1) return 40;
  if (position === 2) return 35;
  if (position <= 10) return Math.max(25, 36 - position);
  if (position <= 20) return Math.max(10, 26 - (position - 10));
  return Math.max(1, 16 - (position - 20));
}

export const LINEUP_BACKTEST_NOTICE =
  'Approximate lineup backtest — finish-based proxy, not final scoring.';
