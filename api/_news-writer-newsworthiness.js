/**
 * Phase 3d — deterministic newsroom intelligence (no OpenAI, no planner changes).
 */
import { isOfficialConfidence, stripTrailingDriverIdArtifact } from './_news-writer-fact-quality.js';

export const NEWSWORTHINESS_VERSION = '1.0.0';

export const NARRATIVE_CLASSIFICATIONS = [
  'historic_win',
  'first_career_win',
  'multiple_win_milestone',
  'comeback_drive',
  'winner_from_deep_field',
  'championship_shakeup',
  'championship_implications',
  'late_caution_changed_outcome',
  'fuel_mileage_race',
  'dominant_performance',
  'photo_finish',
  'upset',
  'underdog',
  'breakout_performance',
  'strategy_race',
  'clean_race',
  'chaotic_race',
  'rain_affected',
  'mechanical_attrition',
  'playoff_elimination',
  'record_setting',
  'track_milestone',
  'team_milestone',
  'routine_race',
];

const LOW_EMPHASIS_CATEGORIES = new Set([
  'routine_pit',
  'green_flag_lap',
  'mid_pack_battle',
  'normal_restart',
  'minor_position_change',
]);

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function winnerFact(facts) {
  return facts.find(
    (f) =>
      f.category === 'winner' ||
      (f.factType === 'result' && f.structuredData?.finishPosition === 1)
  );
}

function runnerUpFact(facts) {
  return facts.find((f) => f.structuredData?.finishPosition === 2);
}

function cautionCount(facts) {
  const official = facts.find((f) => f.structuredData?.cautionCount != null && isOfficialConfidence(f.confidence));
  if (official?.structuredData?.cautionCount != null) return Number(official.structuredData.cautionCount);
  return facts.filter((f) => f.factType === 'caution' || f.category === 'caution').length;
}

function classify({
  id,
  confidence,
  reason,
  supportingFactIds,
  score = 0,
}) {
  return {
    classificationId: id,
    confidence: clamp(confidence),
    reason,
    supportingFactIds: [...new Set(supportingFactIds || [])],
    score,
  };
}

function detectClassifications({ facts, storyPlan, racePackage }) {
  const detected = [];
  const win = winnerFact(facts);
  const p2 = runnerUpFact(facts);
  const temp = storyPlan?.raceTemperature || {};
  const cautions = cautionCount(facts);

  if (win?.structuredData?.startPosition >= 20 || win?.structuredData?.positionsGained >= 15) {
    detected.push(
      classify({
        id: 'winner_from_deep_field',
        confidence: 94,
        reason: `Winner started P${win.structuredData?.startPosition ?? '?'} with ${win.structuredData?.positionsGained ?? 'major'} positions gained.`,
        supportingFactIds: [win.id],
        score: 95,
      })
    );
  }

  const gained = win?.structuredData?.positionsGained;
  if (gained >= 8 && gained < 15 && (win?.structuredData?.startPosition || 99) < 20) {
    detected.push(
      classify({
        id: 'comeback_drive',
        confidence: 82,
        reason: `Winner gained ${gained} positions.`,
        supportingFactIds: win ? [win.id] : [],
        score: 78,
      })
    );
  }

  const milestone = facts.find(
    (f) =>
      f.factType === 'historical' &&
      /first win|career win/i.test(f.summary || '') &&
      isOfficialConfidence(f.confidence)
  );
  if (milestone) {
    detected.push(
      classify({
        id: 'first_career_win',
        confidence: 96,
        reason: milestone.summary,
        supportingFactIds: [milestone.id],
        score: 98,
      })
    );
  }

  const multiWin = facts.find(
    (f) => f.factType === 'historical' && /(second|third|fourth|\d+(st|nd|rd|th))\s+win/i.test(f.summary || '')
  );
  if (multiWin) {
    detected.push(
      classify({
        id: 'multiple_win_milestone',
        confidence: 88,
        reason: multiWin.summary,
        supportingFactIds: [multiWin.id],
        score: 84,
      })
    );
  }

  const champFacts = facts.filter((f) => f.factType === 'championship');
  if (champFacts.length >= 2 || champFacts.some((f) => Math.abs(f.structuredData?.movement || 0) >= 5)) {
    detected.push(
      classify({
        id: 'championship_implications',
        confidence: 86,
        reason: 'Multiple verified championship movement signals.',
        supportingFactIds: champFacts.map((f) => f.id),
        score: 80,
      })
    );
  }
  if (temp.primary === 'championship_defining' || temp.secondary === 'championship_defining') {
    detected.push(
      classify({
        id: 'championship_shakeup',
        confidence: temp.confidence || 85,
        reason: 'Race temperature marks championship-defining impact.',
        supportingFactIds: champFacts.map((f) => f.id),
        score: 88,
      })
    );
  }

  const strategyFacts = facts.filter((f) => f.factType === 'strategy');
  if (strategyFacts.length >= 1) {
    detected.push(
      classify({
        id: 'strategy_race',
        confidence: 75,
        reason: 'Verified strategy calls shaped the outcome.',
        supportingFactIds: strategyFacts.map((f) => f.id),
        score: 72,
      })
    );
  }
  if (temp.primary === 'fuel_mileage' || temp.secondary === 'fuel_mileage') {
    detected.push(
      classify({
        id: 'fuel_mileage_race',
        confidence: 80,
        reason: 'Fuel mileage theme in race temperature.',
        supportingFactIds: strategyFacts.map((f) => f.id),
        score: 76,
      })
    );
  }

  if (p2?.structuredData?.margin != null && p2.structuredData.margin <= 1) {
    detected.push(
      classify({
        id: 'photo_finish',
        confidence: 90,
        reason: `Runner-up margin ${p2.structuredData.margin}s.`,
        supportingFactIds: [p2.id],
        score: 85,
      })
    );
  }
  if (p2?.summary && /0\.\d+\s+seconds? behind/i.test(p2.summary)) {
    detected.push(
      classify({
        id: 'photo_finish',
        confidence: 88,
        reason: p2.summary,
        supportingFactIds: [p2.id],
        score: 83,
      })
    );
  }

  if (cautions >= 6 || temp.primary === 'chaotic' || temp.secondary === 'chaotic') {
    detected.push(
      classify({
        id: 'chaotic_race',
        confidence: cautions >= 6 ? 90 : 78,
        reason: `${cautions} cautions reported.`,
        supportingFactIds: facts.filter((f) => f.factType === 'caution' || f.structuredData?.cautionCount).map((f) => f.id),
        score: 70,
      })
    );
  } else if (cautions <= 2 && temp.primary === 'routine') {
    detected.push(
      classify({
        id: 'clean_race',
        confidence: 72,
        reason: 'Low caution count and routine race temperature.',
        supportingFactIds: [],
        score: 45,
      })
    );
  }

  if (temp.primary === 'rain_affected' || temp.secondary === 'rain_affected') {
    detected.push(
      classify({
        id: 'rain_affected',
        confidence: 85,
        reason: 'Rain-affected race temperature.',
        supportingFactIds: [],
        score: 80,
      })
    );
  }

  if (temp.primary === 'historic' || temp.secondary === 'historic') {
    detected.push(
      classify({
        id: 'historic_win',
        confidence: temp.confidence || 88,
        reason: 'Historic race temperature signal.',
        supportingFactIds: win ? [win.id] : [],
        score: 92,
      })
    );
  }

  const incidents = facts.filter((f) => f.factType === 'incident' && (f.importanceScore || 0) >= 60);
  if (incidents.length >= 3) {
    detected.push(
      classify({
        id: 'mechanical_attrition',
        confidence: 70,
        reason: 'Multiple significant incidents.',
        supportingFactIds: incidents.map((f) => f.id),
        score: 65,
      })
    );
  }

  const recordFact = facts.find((f) => /record|most ever|first time/i.test(f.summary || ''));
  if (recordFact) {
    detected.push(
      classify({
        id: 'record_setting',
        confidence: 85,
        reason: recordFact.summary,
        supportingFactIds: [recordFact.id],
        score: 90,
      })
    );
  }

  if (!detected.length) {
    detected.push(
      classify({
        id: 'routine_race',
        confidence: 60,
        reason: 'No dominant narrative signal beyond standard race recap.',
        supportingFactIds: win ? [win.id] : [],
        score: 40,
      })
    );
  }

  return detected.sort((a, b) => b.score - a.score);
}

function scoreDimensions(classifications, storyPlan, facts) {
  const top = classifications[0]?.score || 50;
  const champ = classifications.some((c) => c.classificationId.includes('championship')) ? 85 : 45;
  const historic = classifications.some((c) =>
    ['historic_win', 'record_setting', 'first_career_win'].includes(c.classificationId)
  )
    ? 90
    : 55;
  const uniqueness = clamp(top + (classifications.length > 3 ? 5 : 0));
  const fanInterest = clamp((storyPlan?.raceTemperature?.confidence || 70) + top * 0.15);
  const seasonImpact = clamp(champ * 0.6 + historic * 0.4);
  const importance = clamp(top * 0.45 + seasonImpact * 0.25 + fanInterest * 0.2 + uniqueness * 0.1);
  const confidence = clamp(
    classifications.slice(0, 3).reduce((s, c) => s + c.confidence, 0) / Math.max(1, Math.min(3, classifications.length))
  );
  return {
    importance: Math.round(importance),
    uniqueness: Math.round(uniqueness),
    seasonImpact: Math.round(seasonImpact),
    fanInterest: Math.round(fanInterest),
    historicalSignificance: Math.round(historic),
    championshipImpact: Math.round(champ),
    confidence: Math.round(confidence),
  };
}

function seasonImportanceLabel(overall) {
  if (overall >= 85) return 'high';
  if (overall >= 65) return 'medium';
  return 'standard';
}

function raceRatingLabel(overall, classifications) {
  if (classifications.some((c) => c.classificationId === 'routine_race') && overall < 55) return 'standard';
  if (overall >= 88) return 'excellent';
  if (overall >= 72) return 'strong';
  if (overall >= 55) return 'solid';
  return 'standard';
}

function buildDriverStoryImportance({ facts, classifications, storyPlan }) {
  const scores = new Map();
  function bump(driverName, amount, reason, factIds = []) {
    const name = stripTrailingDriverIdArtifact(driverName);
    if (!name) return;
    const prev = scores.get(name) || { driverName: name, importance: 0, reasons: [], factIds: [] };
    prev.importance = clamp(prev.importance + amount);
    if (reason && !prev.reasons.includes(reason)) prev.reasons.push(reason);
    prev.factIds.push(...factIds);
    scores.set(name, prev);
  }

  const win = winnerFact(facts);
  if (win) {
    const deep = classifications.find((c) => c.classificationId === 'winner_from_deep_field');
    bump(win.driverNames?.[0], deep ? 100 : 92, deep ? 'Winner from deep in the field' : 'Race winner', [win.id]);
  }
  const p2 = runnerUpFact(facts);
  if (p2) bump(p2.driverNames?.[0], 71, 'Runner-up finish', [p2.id]);

  for (const f of facts.filter((x) => x.factType === 'championship')) {
    for (const n of f.driverNames || []) {
      bump(n, 18, 'Championship implications', [f.id]);
    }
  }

  for (const rd of storyPlan?.rankedDrivers || []) {
    bump(rd.displayName, Math.round((rd.storyScore || rd.importanceScore || 0) * 0.35), 'Story plan ranking', []);
  }

  return [...scores.values()]
    .map((row) => ({
      driverName: row.driverName,
      importance: clamp(row.importance),
      reason: row.reasons[0] || 'Race presence',
      reasons: row.reasons,
      supportingFactIds: [...new Set(row.factIds)],
    }))
    .sort((a, b) => b.importance - a.importance);
}

function buildHistoricalComparison(facts) {
  const items = [];
  for (const f of facts) {
    const s = String(f.summary || '');
    if (!isOfficialConfidence(f.confidence) && f.factType !== 'historical') continue;
    if (/third win|3rd win/i.test(s)) {
      items.push({ type: 'season_milestone', label: 'Third win of season', factId: f.id, verified: true });
    } else if (/first win|first career/i.test(s)) {
      items.push({ type: 'first_career_win', label: s, factId: f.id, verified: true });
    } else if (/first top.?five|first top 5/i.test(s)) {
      items.push({ type: 'first_top_five', label: s, factId: f.id, verified: true });
    } else if (/win streak/i.test(s)) {
      items.push({ type: 'win_streak', label: s, factId: f.id, verified: true });
    } else if (/largest comeback|positions gained/i.test(s) && f.structuredData?.positionsGained >= 15) {
      items.push({ type: 'largest_comeback', label: s, factId: f.id, verified: true });
    }
  }
  return items;
}

function buildLowEmphasisTargets(facts) {
  const targets = [];
  for (const f of facts) {
    const score = f.importanceScore || 0;
    const s = String(f.summary || '').toLowerCase();
    if (score < 52 && (f.factType === 'race_event' || f.category === 'race_event')) {
      targets.push({ factId: f.id, category: 'green_flag_lap', reason: 'Routine running order note' });
    }
    if (/green flag lap|leaders battle mid/i.test(s) && score < 70) {
      targets.push({ factId: f.id, category: 'mid_pack_battle', reason: 'Mid-pack battle without outcome change' });
    }
    if (f.factType === 'caution' && score < 60 && !f.canonicalFactId) {
      targets.push({ factId: f.id, category: 'routine_pit', reason: 'Minor caution — do not overemphasize' });
    }
    if (f.factType === 'strategy' && score < 58) {
      targets.push({ factId: f.id, category: 'normal_restart', reason: 'Routine pit strategy note' });
    }
  }
  return targets;
}

function buildEditorialGuidance({ classifications, driverImportance, facts, storyPlan }) {
  const primary = classifications[0];
  const secondary = classifications.filter(
    (c) => c.classificationId !== primary?.classificationId && c.score >= 65
  ).slice(0, 3);
  const win = winnerFact(facts);
  const lowEmphasis = buildLowEmphasisTargets(facts);

  const leadLine = win
    ? primary?.classificationId === 'winner_from_deep_field'
      ? `Lead: ${win.driverNames?.[0] || 'Winner'} from P${win.structuredData?.startPosition ?? 'deep in the field'}. Do not bury.`
      : `Lead: ${win.summary || 'Verified winner'}. Do not bury.`
    : 'Lead: Verified winner and race outcome.';

  const quoteFacts = facts.filter((f) => f.factType === 'quote' && (f.importanceScore || 0) >= 70);
  const quoteDrivers = [...new Set(quoteFacts.flatMap((f) => f.driverNames || []))].slice(0, 3);

  return {
    lead: leadLine,
    primaryRememberedFor: primary?.reason || 'Standard race recap themes.',
    secondaryThemes: secondary.map((s) => s.reason),
    minorThemes: [`${cautionCount(facts)} cautions (context only unless decisive).`],
    sectionEmphasis: {
      introduction: 'primary_narrative_first',
      race_summary: 'primary_narrative_first',
      battle_for_win: primary?.classificationId === 'photo_finish' ? 'high' : 'medium',
      strategy: secondary.some((s) => s.classificationId.includes('strategy')) ? 'high' : 'medium',
      championship_picture: secondary.some((s) => s.classificationId.includes('championship')) ? 'high' : 'medium',
      key_incidents: classifications.some((c) => c.classificationId === 'chaotic_race') ? 'medium' : 'low',
    },
    quoteRecommendations: quoteDrivers.length
      ? quoteDrivers
      : driverImportance.slice(0, 2).map((d) => d.driverName),
    deEmphasize: lowEmphasis.map((t) => t.reason),
    deEmphasizeFactIds: lowEmphasis.map((t) => t.factId),
    orderingHints: [
      secondary.some((s) => s.classificationId.includes('strategy')) && primary?.classificationId.includes('championship')
        ? 'Discuss strategy before championship if both apply.'
        : null,
      classifications.some((c) => c.classificationId === 'multiple_win_milestone')
        ? 'Mention season win milestone in the first third.'
        : null,
    ].filter(Boolean),
    tone: storyPlan?.raceTemperature?.primary || 'competitive',
  };
}

export function buildNewsworthinessReport({
  racePackage,
  preparedFacts,
  storyPlan,
  requiredRecap = null,
  factVerification = null,
}) {
  const facts = preparedFacts || racePackage?.facts || [];
  const classifications = detectClassifications({ facts, storyPlan, racePackage });
  const dimensions = scoreDimensions(classifications, storyPlan, facts);
  const overallNewsworthiness = dimensions.importance;
  const primaryNarrative = classifications[0]?.classificationId || 'routine_race';
  const secondaryNarratives = classifications
    .slice(1, 4)
    .map((c) => c.classificationId)
    .filter((id) => id !== primaryNarrative);

  const driverStoryImportance = buildDriverStoryImportance({ facts, classifications, storyPlan });
  const historicalComparison = buildHistoricalComparison(facts);
  const editorialGuidance = buildEditorialGuidance({
    classifications,
    driverImportance: driverStoryImportance,
    facts,
    storyPlan,
  });

  const storyImportanceRanking = classifications.map((c, idx) => ({
    rank: idx + 1,
    narrative: c.classificationId,
    score: c.score,
    confidence: c.confidence,
  }));

  return {
    version: NEWSWORTHINESS_VERSION,
    overallImportance: overallNewsworthiness,
    overallNewsworthiness,
    primaryNarrative,
    secondaryNarratives,
    seasonImportance: seasonImportanceLabel(overallNewsworthiness),
    raceRating: raceRatingLabel(overallNewsworthiness, classifications),
    confidence: dimensions.confidence,
    dimensions,
    classifications,
    storyImportanceRanking,
    driverStoryImportance,
    historicalComparison,
    editorialGuidance,
    lowEmphasisTargets: buildLowEmphasisTargets(facts),
    requiredRecapRoles: (requiredRecap?.items || []).map((i) => i.role),
    factVerificationAware: Boolean(factVerification),
    summary: {
      primaryNarrative,
      topDriver: driverStoryImportance[0]?.driverName || null,
      classificationCount: classifications.length,
    },
  };
}

/** Prompt-safe editorial package for existing OpenAI writer stages (no new stages). */
export function compactNewsroomGuidanceForPrompt(newsworthinessReport) {
  if (!newsworthinessReport) return null;
  const g = newsworthinessReport.editorialGuidance || {};
  return {
    primaryNarrative: newsworthinessReport.primaryNarrative,
    secondaryNarratives: newsworthinessReport.secondaryNarratives,
    overallImportance: newsworthinessReport.overallImportance,
    raceRating: newsworthinessReport.raceRating,
    editorialGuidance: g,
    driverSpotlightOrder: (newsworthinessReport.driverStoryImportance || []).slice(0, 6).map((d) => ({
      name: d.driverName,
      importance: d.importance,
      reason: d.reason,
    })),
    storyImportanceRanking: newsworthinessReport.storyImportanceRanking,
    historicalComparison: newsworthinessReport.historicalComparison,
  };
}

export function buildNewsworthinessValidation(newsworthinessReport, { body = '', headline = '', summary = '' } = {}) {
  if (!newsworthinessReport) return { checks: [], scorePenalty: 0 };
  const checks = [];
  const text = `${body} ${summary} ${headline}`.toLowerCase();
  const primary = newsworthinessReport.primaryNarrative;
  const guidance = newsworthinessReport.editorialGuidance || {};

  const primaryTokens = {
    winner_from_deep_field: ['p25', '25th', 'deep', 'from the back'],
    championship_implications: ['championship', 'title', 'points', 'standings'],
    strategy_race: ['strategy', 'pit', 'tire', 'caution'],
    photo_finish: ['photo', 'close', 'margin', 'seconds behind'],
    chaotic_race: ['caution', 'restart'],
  };
  const tokens = primaryTokens[primary] || ['win', 'race'];
  const leadOk = tokens.some((t) => text.includes(t));
  checks.push({
    id: 'lead_matches_primary_narrative',
    ok: leadOk,
    label: leadOk ? 'Lead matches primary narrative' : 'Lead may not reflect primary narrative',
  });

  const headOk = headline.length > 5 && (leadOk || tokens.some((t) => headline.toLowerCase().includes(t)));
  checks.push({
    id: 'headline_news_value',
    ok: headOk,
    label: headOk ? 'Headline reflects highest news value' : 'Headline may miss primary news value',
  });

  const topDrivers = (newsworthinessReport.driverStoryImportance || []).slice(0, 3);
  let driverOrderOk = true;
  for (let i = 0; i < topDrivers.length - 1; i += 1) {
    const a = topDrivers[i].driverName?.split(' ').pop()?.toLowerCase();
    const b = topDrivers[i + 1].driverName?.split(' ').pop()?.toLowerCase();
    if (!a || !b) continue;
    const posA = text.indexOf(a);
    const posB = text.indexOf(b);
    if (posA >= 0 && posB >= 0 && posB < posA) driverOrderOk = false;
  }
  checks.push({
    id: 'driver_emphasis_ranking',
    ok: driverOrderOk,
    label: driverOrderOk ? 'Driver emphasis follows importance ranking' : 'Higher-ranked driver should appear before lower-ranked',
  });

  for (const hist of newsworthinessReport.historicalComparison || []) {
    if (!hist.verified) continue;
    const token = hist.label.split(' ').slice(0, 3).join(' ').toLowerCase();
    if (token.length < 6) continue;
    const mentioned = text.includes(token.slice(0, 8));
    checks.push({
      id: `historical_${hist.type}`,
      ok: mentioned || !/third win|first win/i.test(hist.label),
      label: mentioned ? `Historical claim present: ${hist.type}` : `Unsupported milestone mention risk: ${hist.type}`,
    });
  }

  let scorePenalty = 0;
  for (const c of checks) {
    if (!c.ok) scorePenalty += c.id.includes('headline') || c.id.includes('lead') ? 12 : 8;
  }
  return { checks, scorePenalty };
}
