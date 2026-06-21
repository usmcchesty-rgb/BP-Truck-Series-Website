function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0';
  return `$${n.toLocaleString('en-US')}`;
}

function formatComponentScore(score) {
  const n = Number(score);
  return Number.isFinite(n) ? `${Math.round(n)}/100` : 'n/a';
}

export function buildFantasySalaryReasons(scored = {}) {
  const reasons = [];
  const tierScore = Number(scored.fantasyTierScore);
  const tier = scored.computedTier || 'Value';
  const band = scored.salaryBand || {};

  reasons.push(
    `Fantasy Tier Score ${Number.isFinite(tierScore) ? tierScore.toFixed(1) : 'n/a'} → ${tier} (${formatMoney(band.min)}–${formatMoney(band.max)})`
  );

  const breakdown = scored.scoreBreakdown || {};
  if (breakdown.seasonPerformance) {
    const position = breakdown.seasonPerformance.details?.pointsPosition;
    const wins = breakdown.seasonPerformance.details?.wins;
    reasons.push(
      `Season Performance ${formatComponentScore(breakdown.seasonPerformance.score)}${position != null ? ` (P${position}${wins != null ? `, ${wins} win${wins === 1 ? '' : 's'}` : ''})` : ''}`
    );
  }

  if (breakdown.recentForm) {
    const avg = breakdown.recentForm.details?.last3RaceAverageFinish;
    reasons.push(
      `Recent Form ${formatComponentScore(breakdown.recentForm.score)}${avg != null ? ` (avg finish ${avg} last 3)` : ''}`
    );
  }

  if (breakdown.careerTrackHistory) {
    const summary = breakdown.careerTrackHistory.details?.summary;
    const scope = breakdown.careerTrackHistory.details?.scope || 'track';
    const scopeLabel = scope === 'exact_track'
      ? 'exact track'
      : scope === 'similar_track_type'
        ? 'similar track type'
        : 'blended track profile';
    reasons.push(
      `Career Track History ${formatComponentScore(breakdown.careerTrackHistory.score)} (${scopeLabel}${summary?.starts != null ? `, ${summary.starts} starts` : ''})`
    );
  }

  if (breakdown.raceImpact) {
    const finish = breakdown.raceImpact.details?.finish;
    reasons.push(
      `Race Impact ${formatComponentScore(breakdown.raceImpact.score)}${finish != null ? ` (latest finish P${finish})` : ''}`
    );
  }

  if (breakdown.momentum) {
    const prior = breakdown.momentum.details?.priorTierScore;
    reasons.push(
      `Momentum ${formatComponentScore(breakdown.momentum.score)}${prior != null ? ` (prior tier score ${prior})` : ''}`
    );
  }

  const trackAdjustment = scored.trackAdjustment || {};
  if (Number(trackAdjustment.amount)) {
    reasons.push(
      `Track adjustment ${trackAdjustment.amount > 0 ? '+' : ''}${formatMoney(trackAdjustment.amount)} (${trackAdjustment.reason || trackAdjustment.tier})`
    );
  }

  if (scored.smoothing?.applied) {
    reasons.push(
      `Smoothed from prior salary ${formatMoney(scored.smoothing.priorSalary)} (${Math.round((scored.smoothing.weight || 0) * 100)}% prior weight)`
    );
  }

  reasons.push(`Generated salary ${formatMoney(scored.generatedSalary)} (rounded to nearest $100)`);
  return reasons;
}
