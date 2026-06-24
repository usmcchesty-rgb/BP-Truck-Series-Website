import { MIN_BEST_VALUE_SALARY } from './_fantasy-admin-analytics.js';

const VALUE_GRADE_WEIGHT = {
  'A+': 28,
  A: 24,
  'B+': 18,
  B: 14,
  'C+': 10,
  C: 6,
  D: 2,
};

const TIER_WEIGHT = {
  'Top Tier': 18,
  Elite: 16,
  'Mid-Tier': 8,
  'Mid Tier': 8,
  Value: 4,
};

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeField(values = []) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return values.map(() => 0);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return nums.map(() => 50);
  return nums.map((v) => ((v - min) / (max - min)) * 100);
}

export function formatSalaryChangeLabel(driver = {}) {
  const direction = driver.salaryChangeDirection || 'new';
  const change = num(driver.salaryChange);

  if (direction === 'new' || change == null) return 'New';
  if (change === 0) return '—';

  const formatted = Math.abs(change).toLocaleString('en-US');
  if (change > 0) return `+$${formatted} ▲`;
  return `-$${formatted} ▼`;
}

function recentFormScore(driver) {
  const rf = driver.scoreBreakdown?.recentForm;
  return num(rf?.normalizedScore ?? rf?.score, 50);
}

function raceImpactScore(driver) {
  const ri = driver.scoreBreakdown?.raceImpact;
  return num(ri?.normalizedScore ?? ri?.score, 50);
}

function trackHistoryComponent(driver) {
  const proven = num(driver.provenTrackHistoryRank);
  if (proven != null && proven > 0) {
    return clamp(100 - (proven - 1) * 8, 10, 100);
  }
  const th = driver.scoreBreakdown?.careerTrackHistory;
  return num(th?.normalizedScore ?? th?.score, 40);
}

function powerCompositeScore(driver, norms = {}) {
  return (
    (norms.tierScore ?? 0) * 0.35 +
    (norms.valueScore ?? 0) * 0.25 +
    (norms.trackHistory ?? 0) * 0.2 +
    (norms.recentForm ?? 0) * 0.15 +
    (norms.raceImpact ?? 0) * 0.05
  );
}

function shortPowerReason(driver) {
  const parts = [];
  if (driver.computedTier) parts.push(`${driver.computedTier} tier`);
  if (driver.valueGrade) parts.push(`${driver.valueGrade} value`);
  const proven = num(driver.provenTrackHistoryRank);
  if (proven != null) parts.push(`proven track #${proven}`);
  const avg = driver.scoreBreakdown?.recentForm?.details?.last3RaceAverageFinish;
  if (avg != null) parts.push(`avg finish ${avg} last 3`);
  return parts.slice(0, 3).join(' · ') || 'Strong composite slate profile';
}

export function buildOwnershipProjections(drivers = []) {
  const salaries = drivers.map((d) => num(d.finalSalary ?? d.generatedSalary, 0));
  const medianSalary =
    salaries.length ? salaries.sort((a, b) => a - b)[Math.floor(salaries.length / 2)] : 10000;

  const tierScores = normalizeField(drivers.map((d) => num(d.fantasyTierScore, 0)));

  const rawByDriver = new Map();
  drivers.forEach((driver, index) => {
    let raw = VALUE_GRADE_WEIGHT[driver.valueGrade] ?? 8;
    raw += TIER_WEIGHT[driver.computedTier] ?? 6;
    raw += (tierScores[index] / 100) * 22;

    const salary = num(driver.finalSalary ?? driver.generatedSalary, 0);
    const valueScore = num(driver.valueScore, 0);
    if (valueScore >= 5 && salary <= medianSalary) raw += 12;
    if (salary >= 14000 && (driver.computedTier === 'Top Tier' || driver.computedTier === 'Elite')) {
      raw += 8;
    }
    if (driver.trackHistoryLimitedSample) raw -= 8;
    if (num(driver.provenTrackHistoryRank, 99) > 15) raw -= 4;
    if (driver.salaryChangeDirection === 'down') raw -= 2;
    if (driver.salaryChangeDirection === 'up' && recentFormScore(driver) >= 60) raw += 3;

    rawByDriver.set(String(driver.driverId), raw);
  });

  const rawValues = [...rawByDriver.values()];
  const maxRaw = Math.max(...rawValues, 1);

  const projections = drivers.map((driver) => {
    const raw = rawByDriver.get(String(driver.driverId)) ?? 0;
    const pct = clamp(Math.round((raw / maxRaw) * 48 + 6), 5, 55);
    let ownershipLabel = 'Dark Horse';
    if (pct >= 40) ownershipLabel = 'Favorite';
    else if (pct >= 28) ownershipLabel = 'Popular';
    else if (pct >= 18) ownershipLabel = 'Moderate';
    else if (pct >= 10) ownershipLabel = 'Sleeper';

    return {
      driverId: driver.driverId,
      driverName: driver.driverName,
      projectedOwnershipPct: pct,
      ownershipLabel,
    };
  });

  const byDriverId = new Map(projections.map((row) => [String(row.driverId), row]));
  return { projections, byDriverId };
}

function rankDriversByPowerComposite(drivers = []) {
  const tierNorm = normalizeField(drivers.map((d) => num(d.fantasyTierScore, 0)));
  const valueNorm = normalizeField(drivers.map((d) => num(d.valueScore, 0)));
  const trackNorm = drivers.map((d) => trackHistoryComponent(d));
  const recentNorm = drivers.map((d) => recentFormScore(d));
  const impactNorm = drivers.map((d) => raceImpactScore(d));

  return drivers
    .map((driver, index) => ({
      driver,
      composite: powerCompositeScore(driver, {
        tierScore: tierNorm[index],
        valueScore: valueNorm[index],
        trackHistory: trackNorm[index],
        recentForm: recentNorm[index],
        raceImpact: impactNorm[index],
      }),
    }))
    .sort((a, b) => {
      const compositeDiff = b.composite - a.composite;
      if (compositeDiff !== 0) return compositeDiff;
      return num(b.driver.fantasyTierScore) - num(a.driver.fantasyTierScore);
    });
}

export function buildFantasyRankByDriver(drivers = []) {
  const ranked = rankDriversByPowerComposite(drivers);
  const rankByDriver = new Map();
  ranked.forEach((entry, index) => {
    rankByDriver.set(String(entry.driver.driverId), index + 1);
  });
  return rankByDriver;
}

export function deriveFantasyRankFromSlate(drivers = [], driverId) {
  const id = String(driverId ?? '').trim();
  if (!id || !drivers.length) return null;

  const rankByDriver = buildFantasyRankByDriver(drivers);
  const ranked = rankByDriver.get(id);
  if (ranked != null) return ranked;

  const sorted = [...drivers].sort(
    (a, b) => num(b.fantasyTierScore) - num(a.fantasyTierScore)
  );
  const index = sorted.findIndex((row) => String(row.driverId) === id);
  return index >= 0 ? index + 1 : null;
}

export function buildFantasyPowerRankings(drivers = [], ownershipByDriver = new Map()) {
  const ranked = rankDriversByPowerComposite(drivers).slice(0, 10);

  return ranked.map((entry, index) => {
    const driver = entry.driver;
    const ownership = ownershipByDriver.get(String(driver.driverId)) || {};
    return {
      rank: index + 1,
      driverId: driver.driverId,
      driverName: driver.driverName,
      carNumber: driver.carNumber || null,
      tier: driver.computedTier || '',
      salary: driver.finalSalary ?? driver.generatedSalary ?? null,
      fantasyTierScore: num(driver.fantasyTierScore),
      valueGrade: driver.valueGrade ?? null,
      valueScore: driver.valueScore ?? null,
      projectedOwnership: ownership.projectedOwnershipPct ?? null,
      ownershipLabel: ownership.ownershipLabel ?? null,
      shortReason: shortPowerReason(driver),
    };
  });
}

function spotlightDriver(driver, extra = {}) {
  if (!driver) return null;
  return {
    driverId: driver.driverId,
    driverName: driver.driverName,
    carNumber: driver.carNumber || null,
    salary: driver.finalSalary ?? driver.generatedSalary ?? null,
    tier: driver.computedTier || '',
    ...extra,
  };
}

export function buildSpotlightCards(drivers = []) {
  const eligibleValue = drivers.filter((d) => {
    const salary = num(d.finalSalary ?? d.generatedSalary, 0);
    return num(d.valueScore) != null && salary >= MIN_BEST_VALUE_SALARY;
  });
  const bestValue = [...eligibleValue].sort((a, b) => num(b.valueScore) - num(a.valueScore))[0];

  const hottest = [...drivers].sort((a, b) => {
    const scoreA = recentFormScore(a) + (a.salaryChangeDirection === 'up' ? 8 : 0);
    const scoreB = recentFormScore(b) + (b.salaryChangeDirection === 'up' ? 8 : 0);
    return scoreB - scoreA;
  })[0];

  const trackSpecialist = [...drivers]
    .filter((d) => num(d.provenTrackHistoryRank) != null && !d.trackHistoryLimitedSample)
    .sort((a, b) => num(a.provenTrackHistoryRank) - num(b.provenTrackHistoryRank))[0];

  const risky = [...drivers]
    .map((driver) => {
      const salary = num(driver.finalSalary ?? driver.generatedSalary, 0);
      let risk = 0;
      if (salary >= 13000) risk += 20;
      if (driver.computedTier === 'Top Tier' || driver.computedTier === 'Elite') risk += 12;
      if (num(driver.provenTrackHistoryRank, 99) > 12) risk += 15;
      if (driver.trackHistoryLimitedSample) risk += 18;
      if (num(driver.valueScore, 99) < 4) risk += 10;
      if (driver.salaryChangeDirection === 'down') risk += 6;
      return { driver, risk };
    })
    .sort((a, b) => b.risk - a.risk)[0]?.driver;

  const hottestAvg = hottest?.scoreBreakdown?.recentForm?.details?.last3RaceAverageFinish;

  return {
    bestValue: spotlightDriver(bestValue, {
      label: 'BEST VALUE',
      statLine: bestValue ? `${num(bestValue.valueScore)?.toFixed(2)} value · ${bestValue.valueGrade}` : '',
      explanation: bestValue
        ? `${bestValue.driverName} leads the slate in fantasy score per $1k salary.`
        : 'No value leader available.',
    }),
    hottestDriver: spotlightDriver(hottest, {
      label: 'HOTTEST DRIVER',
      statLine: hottestAvg != null ? `Avg finish ${hottestAvg} last 3` : `Recent form ${Math.round(recentFormScore(hottest))}`,
      explanation: hottest
        ? `${hottest.driverName} profiles with the strongest recent form signal on this slate.`
        : 'No recent-form leader available.',
    }),
    trackSpecialist: spotlightDriver(trackSpecialist, {
      label: 'TRACK SPECIALIST',
      statLine: trackSpecialist ? `Proven track #${trackSpecialist.provenTrackHistoryRank}` : '',
      explanation: trackSpecialist
        ? `${trackSpecialist.driverName} brings the strongest proven track history sample this week.`
        : 'No reliable track-history leader available.',
    }),
    riskyPick: spotlightDriver(risky, {
      label: 'RISKY PICK',
      statLine: risky
        ? `${formatSalaryChangeLabel(risky)} · ${risky.trackHistoryLimitedSample ? 'Limited sample' : `Track #${risky.provenTrackHistoryRank ?? '—'}`}`
        : '',
      explanation: risky
        ? `${risky.driverName} carries premium salary with a weaker value or track-history profile.`
        : 'No risky profile flagged.',
    }),
  };
}

export function buildWeeklyBreakdown(drivers = [], slate = {}, analysis = {}) {
  const power = analysis.fantasyPowerRankings || [];
  const spotlights = analysis.spotlightCards || {};
  const ownership = analysis.ownershipProjection || [];

  const top = power[0];
  const second = power[1];
  const bestValue = spotlights.bestValue;
  const risky = spotlights.riskyPick;
  const trackSpec = spotlights.trackSpecialist;
  const topOwned = [...ownership].sort((a, b) => b.projectedOwnershipPct - a.projectedOwnershipPct)[0];

  const corePicks = power
    .slice(0, 3)
    .map((d) => d.driverName)
    .filter(Boolean)
    .join(', ');

  const avoid = drivers
    .filter(
      (d) =>
        d.trackHistoryLimitedSample ||
        (num(d.valueScore, 99) < 3.5 && num(d.finalSalary ?? d.generatedSalary, 0) >= 12000)
    )
    .slice(0, 3)
    .map((d) => d.driverName)
    .join(', ');

  const paragraphs = [];

  if (top) {
    paragraphs.push(
      `${top.driverName} enters as the top fantasy option this week at ${top.salary != null ? `$${Number(top.salary).toLocaleString('en-US')}` : 'TBD'}, but the salary cap forces lineup tradeoffs at Race ${slate.raceNumber ?? ''} (${slate.track ?? 'TBD'}).`
    );
  }

  if (bestValue && topOwned) {
    paragraphs.push(
      `${bestValue.driverName} profiles as the slate's best value (${bestValue.statLine || 'strong value grade'}), while ${topOwned.driverName} projects at ${topOwned.projectedOwnershipPct}% ownership (${topOwned.ownershipLabel}).`
    );
  }

  if (second && risky) {
    paragraphs.push(
      `${second.driverName} remains a core consideration behind the top rank, but ${risky.driverName} stands out as a high-risk/high-reward option with a weaker efficiency profile.`
    );
  }

  if (trackSpec) {
    paragraphs.push(
      `Track history edge: ${trackSpec.driverName} (${trackSpec.statLine || 'proven track rank'}) is the clearest track specialist on the board.`
    );
  }

  if (topOwned) {
    paragraphs.push(
      `Predicted favorite in projected ownership: ${topOwned.driverName} at ${topOwned.projectedOwnershipPct}% (${topOwned.ownershipLabel}).`
    );
  }

  return {
    thisWeeksCorePicks: corePicks || 'Core picks will populate once the slate is generated.',
    bestValues: bestValue
      ? `${bestValue.driverName} — ${bestValue.explanation}`
      : 'Best values will populate from slate data.',
    highRiskHighReward: risky
      ? `${risky.driverName} — ${risky.explanation}`
      : 'No high-risk profiles flagged.',
    driversToAvoid: avoid || 'No clear avoid list this week.',
    trackHistoryEdge: trackSpec
      ? `${trackSpec.driverName} — ${trackSpec.explanation}`
      : 'Track history edge unavailable.',
    predictedFavorite: topOwned
      ? `${topOwned.driverName} (${topOwned.projectedOwnershipPct}% projected ownership)`
      : top?.driverName || 'TBD',
    narrative: paragraphs.join(' '),
    sections: {
      corePicks: corePicks,
      bestValues: bestValue?.driverName || null,
      highRisk: risky?.driverName || null,
      avoid: avoid || null,
      trackEdge: trackSpec?.driverName || null,
      predictedFavorite: topOwned?.driverName || top?.driverName || null,
    },
  };
}

export function buildSalaryHistoryInsights(slates = [], latestDrivers = []) {
  if (!slates || slates.length < 2) {
    return {
      hasEnoughHistory: false,
      notice: 'More salary trend data will appear after multiple fantasy slates are generated.',
    };
  }

  const recentSlates = [...slates].sort((a, b) => b.raceNumber - a.raceNumber).slice(0, 3);
  const driverTrends = new Map();

  for (const slate of recentSlates) {
    for (const driver of slate.drivers || []) {
      const id = String(driver.driverId);
      if (!driverTrends.has(id)) {
        driverTrends.set(id, { driverId: id, driverName: driver.driverName, salaries: [] });
      }
      driverTrends.get(id).salaries.push({
        raceNumber: slate.raceNumber,
        track: slate.track,
        salary: driver.salary,
      });
    }
  }

  const trends = [...driverTrends.values()].filter((row) => row.salaries.length >= 2);

  const withChange = trends.map((row) => {
    const ordered = [...row.salaries].sort((a, b) => b.raceNumber - a.raceNumber);
    const newest = ordered[0]?.salary ?? 0;
    const oldest = ordered[ordered.length - 1]?.salary ?? 0;
    const salaries = ordered.map((r) => r.salary);
    const avg = salaries.reduce((s, v) => s + v, 0) / salaries.length;
    const volatility = Math.max(...salaries) - Math.min(...salaries);
    return {
      ...row,
      salaryChange: newest - oldest,
      averageSalary: Math.round(avg),
      volatility,
      newestSalary: newest,
    };
  });

  const biggestRiser = [...withChange].sort((a, b) => b.salaryChange - a.salaryChange)[0];
  const biggestFaller = [...withChange].sort((a, b) => a.salaryChange - b.salaryChange)[0];
  const highestAverage = [...withChange].sort((a, b) => b.averageSalary - a.averageSalary)[0];
  const mostVolatile = [...withChange].sort((a, b) => b.volatility - a.volatility)[0];
  const currentBestValue = [...latestDrivers]
    .filter((d) => num(d.valueScore) != null)
    .sort((a, b) => num(b.valueScore) - num(a.valueScore))[0];

  return {
    hasEnoughHistory: true,
    biggestThreeRaceRiser: biggestRiser
      ? {
          driverName: biggestRiser.driverName,
          salaryChange: biggestRiser.salaryChange,
          races: biggestRiser.salaries.length,
        }
      : null,
    biggestThreeRaceFaller: biggestFaller
      ? {
          driverName: biggestFaller.driverName,
          salaryChange: biggestFaller.salaryChange,
          races: biggestFaller.salaries.length,
        }
      : null,
    highestAverageSalary: highestAverage
      ? { driverName: highestAverage.driverName, averageSalary: highestAverage.averageSalary }
      : null,
    mostVolatileSalary: mostVolatile
      ? { driverName: mostVolatile.driverName, volatility: mostVolatile.volatility }
      : null,
    currentBestValue: currentBestValue
      ? {
          driverName: currentBestValue.driverName,
          valueScore: currentBestValue.valueScore,
          valueGrade: currentBestValue.valueGrade,
        }
      : null,
  };
}

export function buildPublicAnalysis(drivers = [], slate = {}) {
  const { projections, byDriverId } = buildOwnershipProjections(drivers);
  const rankByDriver = buildFantasyRankByDriver(drivers);
  const fantasyPowerRankings = buildFantasyPowerRankings(drivers, byDriverId);
  const spotlightCards = buildSpotlightCards(drivers);

  const ownershipProjection = projections.sort(
    (a, b) => b.projectedOwnershipPct - a.projectedOwnershipPct
  );

  const analysisCore = {
    fantasyPowerRankings,
    spotlightCards,
    ownershipProjection,
  };

  const weeklyBreakdown = buildWeeklyBreakdown(drivers, slate, {
    ...analysisCore,
  });

  return {
    ...analysisCore,
    weeklyBreakdown,
    rankByDriver,
    ownershipByDriver: byDriverId,
  };
}

export function enrichPublicDriver(driver, analysis = {}) {
  const ownership = analysis.ownershipByDriver?.get(String(driver.driverId)) || {};
  const rank = analysis.rankByDriver?.get(String(driver.driverId)) ?? null;

  return {
    driverId: driver.driverId,
    driverName: driver.driverName,
    carNumber: driver.carNumber || null,
    tier: driver.computedTier || '',
    salary: driver.finalSalary ?? driver.generatedSalary ?? null,
    previousSalary: driver.previousSalary ?? null,
    salaryChange: driver.salaryChange ?? null,
    salaryChangeLabel: formatSalaryChangeLabel(driver),
    salaryChangeDirection: driver.salaryChangeDirection ?? null,
    valueGrade: driver.valueGrade ?? null,
    valueScore: driver.valueScore ?? null,
    trackRank: driver.provenTrackHistoryRank ?? driver.trackHistoryRank ?? null,
    provenTrackHistoryRank: driver.provenTrackHistoryRank ?? null,
    trackRankLabel:
      driver.provenTrackHistoryRank != null
        ? `#${driver.provenTrackHistoryRank}`
        : driver.trackHistoryRank != null
          ? `#${driver.trackHistoryRank}`
          : '—',
    status: driver.trackHistoryLimitedSample ? 'Limited sample' : 'Active',
    fantasyRank: rank,
    projectedOwnershipPct: ownership.projectedOwnershipPct ?? null,
    ownershipLabel: ownership.ownershipLabel ?? null,
  };
}

export function buildDriverDetailResponse(
  driver,
  slate = {},
  history = [],
  analysis = {},
  allDrivers = []
) {
  if (!driver) return null;

  const publicDriver = enrichPublicDriver(driver, analysis);
  let fantasyRank = publicDriver.fantasyRank;
  if (fantasyRank == null) {
    fantasyRank = deriveFantasyRankFromSlate(allDrivers.length ? allDrivers : [driver], driver.driverId);
  }

  const rf = driver.scoreBreakdown?.recentForm?.details || {};
  const recentFormFinishes = Array.isArray(rf.last3Finishes)
    ? rf.last3Finishes
        .map((finish) => Number(finish))
        .filter((finish) => Number.isFinite(finish) && finish >= 1)
        .slice(0, 5)
    : [];

  return {
    driver: {
      ...publicDriver,
      fantasyRank,
      fantasyTierScore: num(driver.fantasyTierScore),
      recentFormSummary:
        rf.last3RaceAverageFinish != null
          ? `Average finish ${rf.last3RaceAverageFinish} over the last 3 races`
          : recentFormScore(driver) >= 60
            ? 'Recent form score is above average for this slate'
            : 'Recent form is neutral on this slate',
      recentFormFinishes,
      recentFormScore: num(
        driver.scoreBreakdown?.recentForm?.normalizedScore ??
          driver.scoreBreakdown?.recentForm?.score
      ),
      trackHistoryLimitedSample: Boolean(driver.trackHistoryLimitedSample),
      breakdownSummary: (driver.salaryReasons || []).slice(0, 6),
    },
    slate: {
      raceNumber: slate.raceNumber ?? slate.race_number ?? null,
      track: slate.track || 'TBD',
    },
    fantasyRank,
    salaryHistory: history,
    readOnly: true,
  };
}
