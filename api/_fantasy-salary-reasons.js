function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0';
  return `$${n.toLocaleString('en-US')}`;
}

function formatComponentPair(component) {
  if (!component) return 'n/a';
  const raw = Number(component.rawScore ?? component.score);
  const normalized = Number(component.normalizedScore ?? component.score);
  if (!Number.isFinite(raw) && !Number.isFinite(normalized)) return 'n/a';
  if (!Number.isFinite(raw)) return `norm ${Math.round(normalized)}/100`;
  if (!Number.isFinite(normalized) || raw === normalized) {
    return `${Math.round(raw)}/100`;
  }
  return `raw ${Math.round(raw)} → norm ${Math.round(normalized)}/100`;
}

export function buildFantasySalaryReasons(scored = {}) {
  const reasons = [];
  const tierScore = Number(scored.fantasyTierScore);
  const rawTierScore = Number(scored.fantasyTierScoreRaw);
  const tier = scored.computedTier || 'Value';
  const band = scored.salaryBand || {};

  reasons.push(
    `Fantasy Tier Score ${Number.isFinite(tierScore) ? tierScore.toFixed(1) : 'n/a'} (field-normalized) → ${tier} (${formatMoney(band.min)}–${formatMoney(band.max)})`
  );

  if (Number.isFinite(rawTierScore) && rawTierScore !== tierScore) {
    reasons.push(`Pre-normalization composite score: ${rawTierScore.toFixed(1)}`);
  }

  const breakdown = scored.scoreBreakdown || {};
  if (breakdown.seasonPerformance) {
    const position = breakdown.seasonPerformance.details?.pointsPosition;
    const wins = breakdown.seasonPerformance.details?.wins;
    reasons.push(
      `Season Performance ${formatComponentPair(breakdown.seasonPerformance)}${position != null ? ` (P${position}${wins != null ? `, ${wins} win${wins === 1 ? '' : 's'}` : ''})` : ''}`
    );
  }

  if (breakdown.recentForm) {
    const avg = breakdown.recentForm.details?.last3RaceAverageFinish;
    const neutral = breakdown.recentForm.details?.neutralApplied ? ' [neutral raw]' : '';
    reasons.push(
      `Recent Form ${formatComponentPair(breakdown.recentForm)}${avg != null ? ` (avg finish ${avg} last 3)` : ''}${neutral}`
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
      `Career Track History ${formatComponentPair(breakdown.careerTrackHistory)} (${scopeLabel}${summary?.starts != null ? `, ${summary.starts} starts` : ''})`
    );
  }

  if (breakdown.raceImpact) {
    const finish = breakdown.raceImpact.details?.finish;
    reasons.push(
      `Race Impact ${formatComponentPair(breakdown.raceImpact)}${finish != null ? ` (latest finish P${finish})` : ''}`
    );
  }

  if (breakdown.momentum) {
    const prior = breakdown.momentum.details?.priorTierScore;
    const neutral = breakdown.momentum.details?.neutralApplied ? ' [first slate neutral]' : '';
    reasons.push(
      `Momentum ${formatComponentPair(breakdown.momentum)}${prior != null ? ` (prior tier score ${prior})` : ''}${neutral}`
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

  if (scored.bandEnforcement?.applied) {
    reasons.push(
      `Tier band enforcement: ${formatMoney(scored.bandEnforcement.unclampedSalary)} → ${formatMoney(scored.bandEnforcement.generatedSalary)} (${formatMoney(band.min)}–${formatMoney(band.max)})`
    );
  }

  reasons.push(`Generated salary ${formatMoney(scored.generatedSalary)} (rounded to nearest $100)`);
  return reasons;
}
