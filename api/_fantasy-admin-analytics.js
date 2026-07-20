const VALUE_GRADE_BUCKETS = [
  { grade: 'A+', share: 0.1 },
  { grade: 'A', share: 0.15 },
  { grade: 'B+', share: 0.2 },
  { grade: 'B', share: 0.2 },
  { grade: 'C+', share: 0.2 },
  { grade: 'C', share: 0.1 },
];

const MIN_BEST_VALUE_SALARY = 5000;
const VALUE_REASON_PREFIX = 'Value rating:';

export { MIN_BEST_VALUE_SALARY };

export function computeDriverValueScore(fantasyTierScore, finalSalary) {
  const score = Number(fantasyTierScore);
  const salary = Number(finalSalary);
  if (!Number.isFinite(score) || !Number.isFinite(salary) || salary <= 0) return null;
  return Number((score / (salary / 1000)).toFixed(2));
}

export function computeSalaryMovement(finalSalary, previousSalary) {
  const current = Number(finalSalary);
  const previous = previousSalary != null ? Number(previousSalary) : null;

  if (previous == null || !Number.isFinite(previous)) {
    return {
      previousSalary: null,
      salaryChange: null,
      salaryChangeDirection: 'new',
    };
  }

  if (!Number.isFinite(current)) {
    return {
      previousSalary: previous,
      salaryChange: null,
      salaryChangeDirection: 'new',
    };
  }

  const salaryChange = current - previous;
  let salaryChangeDirection = 'same';
  if (salaryChange > 0) salaryChangeDirection = 'up';
  else if (salaryChange < 0) salaryChangeDirection = 'down';

  return {
    previousSalary: previous,
    salaryChange,
    salaryChangeDirection,
  };
}

export function assignValueGrades(drivers = []) {
  const ranked = drivers
    .map((driver) => {
      const finalSalary = driver.finalSalary ?? driver.generatedSalary;
      const valueScore = computeDriverValueScore(driver.fantasyTierScore, finalSalary);
      return { driver, valueScore };
    })
    .filter((entry) => entry.valueScore != null && Number.isFinite(entry.valueScore))
    .sort((a, b) => b.valueScore - a.valueScore);

  const total = ranked.length;
  let cursor = 0;

  for (const bucket of VALUE_GRADE_BUCKETS) {
    const bucketCount = Math.ceil(total * bucket.share);
    for (let i = 0; i < bucketCount && cursor < total; i += 1, cursor += 1) {
      ranked[cursor].driver.valueScore = ranked[cursor].valueScore;
      ranked[cursor].driver.valueGrade = bucket.grade;
    }
  }

  while (cursor < total) {
    ranked[cursor].driver.valueScore = ranked[cursor].valueScore;
    ranked[cursor].driver.valueGrade = 'D';
    cursor += 1;
  }

  for (const driver of drivers) {
    if (driver.valueGrade == null) {
      driver.valueScore = null;
      driver.valueGrade = null;
    }
  }
}

export function formatValueRatingReason(driver = {}) {
  if (driver.valueScore == null || !driver.valueGrade) return null;
  return `${VALUE_REASON_PREFIX} ${driver.valueGrade} — ${Number(driver.valueScore).toFixed(2)} fantasy score per $1k salary`;
}

export function appendValueRatingReasons(drivers = []) {
  for (const driver of drivers) {
    const line = formatValueRatingReason(driver);
    if (!line) continue;

    const reasons = Array.isArray(driver.salaryReasons) ? [...driver.salaryReasons] : [];
    const existingIndex = reasons.findIndex((reason) => String(reason).startsWith(VALUE_REASON_PREFIX));
    if (existingIndex >= 0) reasons[existingIndex] = line;
    else reasons.push(line);
    driver.salaryReasons = reasons;
  }
}

function pickExtremeDriver(drivers, predicate, compareFn) {
  let best = null;
  for (const driver of drivers) {
    if (!predicate(driver)) continue;
    if (!best || compareFn(driver, best) > 0) best = driver;
  }
  return best;
}

export function summarizeFantasySlateAnalytics(drivers = []) {
  const riser = pickExtremeDriver(
    drivers,
    (driver) => Number(driver.salaryChange) > 0,
    (a, b) => Number(a.salaryChange) - Number(b.salaryChange)
  );

  const faller = pickExtremeDriver(
    drivers,
    (driver) => Number(driver.salaryChange) < 0,
    (a, b) => Number(b.salaryChange) - Number(a.salaryChange)
  );

  const highestSalary = pickExtremeDriver(
    drivers,
    (driver) => Number.isFinite(Number(driver.finalSalary ?? driver.generatedSalary)),
    (a, b) =>
      Number(a.finalSalary ?? a.generatedSalary) - Number(b.finalSalary ?? b.generatedSalary)
  );

  const bestValue = pickExtremeDriver(
    drivers,
    (driver) => {
      const salary = Number(driver.finalSalary ?? driver.generatedSalary);
      return (
        driver.valueScore != null &&
        Number.isFinite(driver.valueScore) &&
        Number.isFinite(salary) &&
        salary >= MIN_BEST_VALUE_SALARY
      );
    },
    (a, b) => Number(a.valueScore) - Number(b.valueScore)
  );

  const summaryDriver = (driver, extra = {}) => {
    if (!driver) return null;
    return {
      driverId: driver.driverId,
      driverName: driver.driverName,
      carNumber: driver.carNumber || null,
      finalSalary: driver.finalSalary ?? driver.generatedSalary ?? null,
      previousSalary: driver.previousSalary ?? null,
      salaryChange: driver.salaryChange ?? null,
      salaryChangeDirection: driver.salaryChangeDirection ?? null,
      valueScore: driver.valueScore ?? null,
      valueGrade: driver.valueGrade ?? null,
      ...extra,
    };
  };

  return {
    biggestSalaryRiser: summaryDriver(riser),
    biggestSalaryFaller: summaryDriver(faller),
    highestSalary: summaryDriver(highestSalary),
    bestValuePick: summaryDriver(bestValue),
    priorSlateRaceNumber: null,
  };
}

export function enrichFantasySlateDrivers(drivers = [], priorSalariesByDriver = new Map()) {
  const enriched = drivers.map((driver) => {
    const finalSalary = driver.finalSalary ?? driver.generatedSalary;
    const previousSalary =
      priorSalariesByDriver.get(String(driver.driverId)) ??
      (driver.previousSalary != null ? driver.previousSalary : driver.priorSalary ?? null);

    return {
      ...driver,
      ...computeSalaryMovement(finalSalary, previousSalary),
      modelSuggestedSalary: driver.modelSuggestedSalary ?? driver.salaryGuardrails?.modelSuggestedSalary ?? null,
      modelSuggestedChange: driver.modelSuggestedChange ?? driver.salaryGuardrails?.modelSuggestedChange ?? null,
      weeklyCapApplied: driver.weeklyCapApplied ?? driver.salaryGuardrails?.weeklyCapApplied ?? false,
    };
  });

  assignValueGrades(enriched);
  appendValueRatingReasons(enriched);

  return enriched;
}
