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

function formatPercentRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  return `${Math.round(n * 100)}%`;
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
    const dnp = breakdown.recentForm.details?.dnpPathApplied ? ' [DNP path]' : '';
    const neutral = breakdown.recentForm.details?.neutralApplied ? ' [no window neutral]' : '';
    const sparse = breakdown._recentDataSparse ? ' [sparse recent window: weight halved]' : '';
    reasons.push(
      `Recent Form ${formatComponentPair(breakdown.recentForm)}${avg != null ? ` (avg finish ${avg} last 3)` : ''}${dnp}${neutral}${sparse}`
    );
  }

  if (breakdown.careerTrackHistory) {
    const th = breakdown.careerTrackHistory.details || {};
    const summary = th.summary;
    const scopeLabel =
      th.historyScope === 'career_track'
        ? 'exact track (career)'
        : th.historyScope === 'career_track_type'
          ? 'track type (career)'
          : th.historyScope === 'blended_neutral'
            ? 'blended neutral (career)'
            : th.scoringScope === 'exact_track'
              ? 'exact track (current season)'
              : th.scoringScope === 'similar_track_type'
                ? 'similar track type (current season)'
                : th.scoringScope === 'exact_track_blended'
                  ? 'blended exact + similar (current season)'
                  : 'career';
    const regression = th.regressionApplied
      ? `; sample ${th.sampleSize ?? summary?.starts ?? 0}, actual ${Math.round(th.actualTrackScore ?? th.careerTrackHistoryRaw ?? 0)} → regressed ${Math.round(th.regressedScore ?? th.careerTrackHistoryNormalized ?? 0)}`
      : '';
    const experienceNote =
      th.scoreDetails?.experienceContribution != null
        ? `; experience ${Math.round(th.scoreDetails.experienceScore ?? 0)} from ${th.scoreDetails.experienceStarts ?? 0} starts (+${Number(th.scoreDetails.experienceContribution).toFixed(1)})`
        : '';
    const trackMatch = th.upcomingTrackMatch;
    const matchNote = trackMatch?.matchMethod
      ? `; upcoming match ${trackMatch.matchedTrackName} (${trackMatch.matchedTrackType}, ${trackMatch.matchMethod})`
      : '';
    reasons.push(
      `Career Track History ${formatComponentPair(breakdown.careerTrackHistory)} (${scopeLabel}${summary?.starts != null ? `, ${summary.starts} starts` : ''}; exact ${th.careerExactTrackStarts ?? th.exactStarts ?? 0}, track type ${th.careerTrackTypeStarts ?? th.similarStarts ?? 0}${experienceNote}${matchNote}${regression})`
    );
  }

  if (breakdown.raceImpact) {
    const finish = breakdown.raceImpact.details?.finish;
    const missed = breakdown.raceImpact.details?.missedLatestRace ? ' [missed latest]' : '';
    reasons.push(
      `Race Impact ${formatComponentPair(breakdown.raceImpact)}${finish != null ? ` (latest finish P${finish})` : ''}${missed}`
    );
  }

  if (breakdown.momentum) {
    const prior = breakdown.momentum.details?.priorTierScore;
    const neutral = breakdown.momentum.details?.neutralApplied ? ' [first slate neutral]' : '';
    reasons.push(
      `Momentum ${formatComponentPair(breakdown.momentum)}${prior != null ? ` (prior tier score ${prior})` : ''}${neutral}`
    );
  }

  if (breakdown.reliability) {
    const rel = breakdown.reliability.details || {};
    reasons.push(
      `Reliability ${formatComponentPair(breakdown.reliability)} (recent 70% / season 30%; valid recent ${rel.validLast5Starts ?? rel.last5Starts ?? '?'}/${rel.validLast5WindowSize ?? rel.last5WindowSize ?? '?'} ${formatPercentRate(rel.recentAttendanceRate ?? rel.last5AttendanceRate)}; season ${rel.seasonStarts ?? '?'}/${rel.completedRacesBeforeSlate ?? '?'} ${formatPercentRate(rel.seasonAttendanceRate)})`
    );
  }

  const attendance = scored.attendanceContext || breakdown.reliability?.details || {};
  if (attendance.completedRacesBeforeSlate != null) {
    reasons.push(
      `Attendance: valid recent ${attendance.validLast5Starts ?? attendance.last5Starts}/${attendance.validLast5WindowSize ?? attendance.last5WindowSize} (${formatPercentRate(attendance.recentAttendanceRate ?? attendance.last5AttendanceRate)} recent); season ${attendance.seasonStarts}/${attendance.completedRacesBeforeSlate} (${formatPercentRate(attendance.seasonAttendanceRate)} season); last 3 valid ${attendance.validLast3Starts ?? attendance.last3Starts}/${attendance.validLast3WindowSize ?? attendance.last3WindowSize}`
    );
  }

  if (attendance.recentDataSparse) {
    reasons.push('Sparse recent data: attendance caps disabled; recent attendance gate waived for premium tiers');
  }

  if (scored.topTierEligible === true) {
    reasons.push('Top Tier eligible: yes');
  } else if (scored.topTierEligible === false) {
    reasons.push(
      `Top Tier eligible: no (${(scored.topTierEligibleReasons || []).join('; ') || 'requirements not met'})`
    );
  }

  if (scored.eliteEligible === true) {
    reasons.push('Elite eligible: yes');
  } else if (scored.eliteEligible === false) {
    reasons.push(
      `Elite eligible: no (${(scored.eliteEligibleReasons || []).join('; ') || 'requirements not met'})`
    );
  }

  if (breakdown._recentDataSparse) {
    const weights = breakdown._effectiveWeights || {};
    reasons.push(
      `Sparse recent data: Recent Form weight reduced (Season ${Math.round((weights.seasonPerformance ?? 0) * 100)}%, Recent ${Math.round((weights.recentForm ?? 0) * 100)}%)`
    );
  }

  const tierCap = scored.tierCap || breakdown._tierCap;
  if (tierCap?.applied) {
    reasons.push(
      `Tier cap: ${tierCap.previousTier} → ${tier} (${(tierCap.reasons || []).join('; ')})`
    );
  } else if (tierCap?.reasons?.length) {
    reasons.push(`Tier cap note: ${tierCap.reasons.join('; ')}`);
  }

  const tierRecovery = scored.tierRecovery || breakdown._tierRecovery;
  if (tierRecovery?.applied) {
    reasons.push(
      `Tier recovery: ${tierRecovery.previousTier} → ${tier} (${tierRecovery.reason || tierRecovery.type})`
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
