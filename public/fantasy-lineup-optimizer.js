(function () {
  const DEFAULT_SALARY_CAP = 50000;
  const DEFAULT_LINEUP_SIZE = 5;
  const TOP_TIER_PATTERN = /top tier|elite/i;
  const VALUE_MID_PATTERN = /value|mid/i;

  const STRATEGY_NOTES = {
    'best-overall': 'Maximizes total fantasy tier score under the salary cap.',
    'best-value': 'Prioritizes the highest combined value scores across five drivers.',
    balanced:
      'Blends tier score and value while preferring lineups that spend $47,000–$50,000 of cap.',
    contrarian: 'Favors strong drivers with lower projected ownership for differentiation.',
    'stars-sleepers':
      'Requires at least one Top Tier/Elite driver and one Midrange/Value driver when possible.',
  };

  function num(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function driverSalary(driver) {
    return num(driver.salary ?? driver.finalSalary ?? driver.generatedSalary);
  }

  function driverTier(driver) {
    return String(driver.tier ?? driver.computedTier ?? '');
  }

  function isTopTier(driver) {
    return TOP_TIER_PATTERN.test(driverTier(driver));
  }

  function isValueOrMid(driver) {
    return VALUE_MID_PATTERN.test(driverTier(driver));
  }

  function lineupKey(drivers) {
    return drivers
      .map((d) => String(d.driverId))
      .sort()
      .join('|');
  }

  function averageOwnership(drivers) {
    const values = drivers.map((d) => num(d.projectedOwnershipPct)).filter((v) => v > 0);
    if (!values.length) return null;
    return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
  }

  function scoreLineup(drivers, strategy) {
    const totalSalary = drivers.reduce((sum, d) => sum + driverSalary(d), 0);

    switch (strategy) {
      case 'best-value':
        return drivers.reduce((sum, d) => sum + num(d.valueScore), 0);
      case 'balanced': {
        const base = drivers.reduce(
          (sum, d) => sum + num(d.fantasyTierScore) * 0.65 + num(d.valueScore) * 8,
          0
        );
        let bonus = 0;
        if (totalSalary >= 47000 && totalSalary <= 50000) bonus = 18;
        else if (totalSalary >= 45000) bonus = 8;
        return base + bonus;
      }
      case 'contrarian':
        return drivers.reduce((sum, d) => {
          const own = num(d.projectedOwnershipPct, 18);
          return sum + num(d.fantasyTierScore) * (1.25 - own / 100) + num(d.valueScore) * 4;
        }, 0);
      case 'stars-sleepers':
      case 'best-overall':
      default:
        return drivers.reduce((sum, d) => sum + num(d.fantasyTierScore), 0);
    }
  }

  function passesStrategyRules(drivers, strategy, eligible = drivers) {
    if (strategy === 'stars-sleepers') {
      const poolHasStar = eligible.some(isTopTier);
      const poolHasMid = eligible.some(isValueOrMid);
      if (poolHasStar && !drivers.some(isTopTier)) return false;
      if (poolHasMid && !drivers.some(isValueOrMid)) return false;
    }
    return true;
  }

  function summarizeLineup(drivers, salaryCap, strategy) {
    const totalSalary = drivers.reduce((sum, d) => sum + driverSalary(d), 0);
    const projectedScore = scoreLineup(drivers, strategy);
    const valueScores = drivers.map((d) => num(d.valueScore)).filter((v) => v > 0);
    const averageValueScore = valueScores.length
      ? Number((valueScores.reduce((a, b) => a + b, 0) / valueScores.length).toFixed(2))
      : null;

    return {
      drivers: drivers.map((d) => ({
        driverId: d.driverId,
        driverName: d.driverName,
        carNumber: d.carNumber || null,
        tier: driverTier(d),
        salary: driverSalary(d),
        fantasyTierScore: num(d.fantasyTierScore),
        valueScore: d.valueScore ?? null,
        valueGrade: d.valueGrade ?? null,
        projectedOwnershipPct: d.projectedOwnershipPct ?? null,
      })),
      totalSalary,
      projectedScore: Number(projectedScore.toFixed(1)),
      remainingSalary: salaryCap - totalSalary,
      averageOwnership: averageOwnership(drivers),
      averageValueScore,
      strategyNote: STRATEGY_NOTES[strategy] || STRATEGY_NOTES['best-overall'],
    };
  }

  function considerLineup(topLineups, candidate, maxAlternatives) {
    const key = lineupKey(candidate.drivers);
    const filtered = topLineups.filter((entry) => lineupKey(entry.drivers) !== key);
    filtered.push(candidate);
    filtered.sort((a, b) => {
      if (b.projectedScore !== a.projectedScore) return b.projectedScore - a.projectedScore;
      return a.totalSalary - b.totalSalary;
    });
    return filtered.slice(0, maxAlternatives);
  }

  function optimizePublicLineup(drivers = [], options = {}) {
    const salaryCap = num(options.salaryCap, DEFAULT_SALARY_CAP);
    const lineupSize = num(options.lineupSize, DEFAULT_LINEUP_SIZE);
    const strategy = options.strategy || 'best-overall';
    const maxAlternatives = num(options.maxAlternatives, 4);

    const eligible = drivers.filter((driver) => {
      const salary = driverSalary(driver);
      const tierScore = num(driver.fantasyTierScore);
      const valueScore = num(driver.valueScore);
      const hasScore =
        strategy === 'best-value' ? valueScore > 0 : tierScore > 0 || valueScore > 0;
      return salary > 0 && hasScore;
    });

    if (eligible.length < lineupSize) {
      return {
        ok: false,
        error: `Need at least ${lineupSize} eligible drivers with salaries and scores.`,
        salaryCap,
        lineupSize,
        strategy,
        eligibleCount: eligible.length,
      };
    }

    let topLineups = [];
    const combo = [];

    function search(startIndex) {
      if (combo.length === lineupSize) {
        const totalSalary = combo.reduce((sum, d) => sum + driverSalary(d), 0);
        if (totalSalary > salaryCap) return;
        if (!passesStrategyRules(combo, strategy, eligible)) return;

        const summary = summarizeLineup(combo, salaryCap, strategy);
        topLineups = considerLineup(topLineups, summary, maxAlternatives + 1);
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
        error:
          strategy === 'stars-sleepers'
            ? 'No valid lineup found with both a star and a value/mid-tier driver under cap.'
            : 'No valid lineup found under salary cap.',
        salaryCap,
        lineupSize,
        strategy,
        eligibleCount: eligible.length,
      };
    }

    return {
      ok: true,
      salaryCap,
      lineupSize,
      strategy,
      eligibleCount: eligible.length,
      optimalLineup: topLineups[0],
      alternativeLineups: topLineups.slice(1, maxAlternatives + 1),
    };
  }

  window.BPFantasyLineupOptimizer = {
    optimizePublicLineup,
    STRATEGY_NOTES,
    DEFAULT_SALARY_CAP,
    DEFAULT_LINEUP_SIZE,
  };
})();
