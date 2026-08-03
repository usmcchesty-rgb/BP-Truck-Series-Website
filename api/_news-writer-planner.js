import { normalizeArticleDepth } from '../server/config/race-research-config.js';
import { buildRaceDriverStoryPackages } from './_race-research-driver-stories.js';
import {
  NEWS_WRITER_PLANNER_VERSION,
  RACE_TEMPERATURE_TAGS,
  TAKEAWAY_MAX_BY_DEPTH,
} from './_news-writer-config.js';
import { rankFactImportance, combinedConfidence } from './_news-writer-ledger.js';
import { computePackageFingerprint, deterministicOperationId } from './_news-writer-fingerprint.js';
import { isOfficialConfidence, planningFactsOnly } from './_news-writer-fact-quality.js';
import {
  applyRequiredRecapToStories,
  buildRequiredRecapFacts,
  winnerRecoveryLeadBoost,
} from './_news-writer-required-recap.js';

function emptyStory(storyId, category) {
  return {
    storyId,
    category,
    priority: 99,
    importanceScore: 0,
    factIds: [],
    canonicalFactIds: [],
    driverIds: [],
    confidence: 'unverified',
    empty: true,
  };
}

function storyFromFacts(storyId, category, priority, facts, driverIds = []) {
  const uniqueFacts = [];
  const seen = new Set();
  for (const f of facts) {
    if (!f?.id || seen.has(f.id)) continue;
    seen.add(f.id);
    uniqueFacts.push(f);
  }
  const ids = uniqueFacts.map((f) => f.id);
  const canonicalFactIds = [...new Set(uniqueFacts.map((f) => f.canonicalFactId).filter(Boolean))];
  const score =
    uniqueFacts.length === 0
      ? 0
      : Math.round(uniqueFacts.reduce((s, f) => s + rankFactImportance(f), 0) / uniqueFacts.length);
  return {
    storyId,
    category,
    priority,
    importanceScore: score,
    factIds: ids,
    canonicalFactIds,
    driverIds: [...new Set(driverIds.filter(Boolean).map(String))],
    confidence: combinedConfidence(uniqueFacts),
    empty: ids.length === 0,
  };
}

function collectDriverIds(facts) {
  const ids = new Set();
  for (const f of facts) {
    for (const d of f.driverIds || []) ids.add(String(d));
  }
  return [...ids];
}

function winnerFact(facts) {
  return facts.find(
    (f) =>
      f.category === 'winner' ||
      (f.factType === 'result' && f.structuredData?.finishPosition === 1 && isOfficialConfidence(f.confidence))
  );
}

function championshipFacts(facts) {
  return facts.filter(
    (f) =>
      f.factType === 'championship' ||
      f.category === 'points_leader' ||
      f.category === 'standings_snapshot' ||
      (f.structuredData?.movement != null && f.structuredData.movement !== 0)
  );
}

function cautionFacts(facts) {
  return facts.filter((f) => f.factType === 'caution' || f.category === 'restart');
}

function incidentFacts(facts) {
  return facts.filter((f) => ['incident', 'penalty'].includes(f.factType));
}

function strategyFacts(facts) {
  return facts.filter((f) => f.factType === 'strategy');
}

function conflictFacts(facts) {
  return facts.filter((f) => f.confidence === 'conflicting');
}

function technicalEvidenceFacts(facts) {
  return facts.filter(
    (f) =>
      f.category === 'technical' ||
      (f.factType === 'strategy' &&
        /tire|fuel|setup|grip|balance|pit|two-tire|four-tire|mileage/i.test(String(f.summary || '')))
  );
}

function milestoneFacts(facts) {
  return facts.filter((f) => /third win|3rd win|three wins on the season|season win/i.test(String(f.summary || '')));
}

export function computeRaceTemperature(facts) {
  const signalRows = [];
  const tagScores = Object.fromEntries(RACE_TEMPERATURE_TAGS.map((t) => [t, 0]));

  const cautions = cautionFacts(facts);
  const incidents = incidentFacts(facts);
  const championship = championshipFacts(facts);
  const conflicts = conflictFacts(facts);
  const strategy = strategyFacts(facts);
  const technical = technicalEvidenceFacts(facts);

  const officialCautionCount = facts.find(
    (f) => f.structuredData?.cautionCount != null || /\b\d+\s+cautions?\b/i.test(f.summary || '')
  );
  const cautionCount = officialCautionCount?.structuredData?.cautionCount ?? cautions.length;

  if (cautionCount >= 5) {
    const weight = 38 + Math.min(12, cautionCount);
    tagScores.chaotic += weight;
    signalRows.push({
      signal: 'chaotic',
      tag: 'chaotic',
      weight,
      factIds: [officialCautionCount?.id, ...cautions.slice(0, 6).map((f) => f.id)].filter(Boolean),
      sourceConfidence: combinedConfidence([officialCautionCount, ...cautions].filter(Boolean)),
      reason: 'high_caution_count',
    });
  } else if (cautionCount >= 2) {
    const weight = 18 + cautionCount * 2;
    tagScores.competitive += weight;
    signalRows.push({
      signal: 'competitive',
      tag: 'competitive',
      weight,
      factIds: cautions.slice(0, 5).map((f) => f.id),
      sourceConfidence: combinedConfidence(cautions),
      reason: 'moderate_cautions',
    });
  } else if (facts.length > 0) {
    tagScores.routine += 22;
    signalRows.push({
      signal: 'routine',
      tag: 'routine',
      weight: 22,
      factIds: [],
      sourceConfidence: 'derived',
      reason: 'low_caution_count',
    });
  }

  const meaningfulChamp = championship.filter((f) => {
    const mv = Math.abs(Number(f.structuredData?.movement) || 0);
    return mv >= 3 && isOfficialConfidence(f.confidence);
  });
  if (meaningfulChamp.length >= 1) {
    const weight = 42 + meaningfulChamp.length * 6;
    tagScores.championship_defining += weight;
    signalRows.push({
      signal: 'championship_defining',
      tag: 'championship_defining',
      weight,
      factIds: meaningfulChamp.map((f) => f.id),
      sourceConfidence: combinedConfidence(meaningfulChamp),
      reason: 'meaningful_standings_change',
    });
  }

  if (conflicts.length) {
    const weight = 40 + conflicts.length * 8;
    tagScores.controversial += weight;
    signalRows.push({
      signal: 'controversial',
      tag: 'controversial',
      weight,
      factIds: conflicts.map((f) => f.id),
      sourceConfidence: 'conflicting',
      reason: 'conflicting_evidence',
    });
  }

  if (incidents.length >= 3) {
    const weight = 28 + incidents.length * 3;
    tagScores.emotional += weight;
    signalRows.push({
      signal: 'emotional',
      tag: 'emotional',
      weight,
      factIds: incidents.slice(0, 6).map((f) => f.id),
      sourceConfidence: combinedConfidence(incidents),
      reason: 'incident_volume',
    });
  }

  if (technical.length >= 1) {
    const weight = 30 + technical.length * 4;
    tagScores.technical += weight;
    signalRows.push({
      signal: 'technical',
      tag: 'technical',
      weight,
      factIds: technical.map((f) => f.id),
      sourceConfidence: combinedConfidence(technical),
      reason: 'equipment_or_pit_evidence',
    });
  } else if (strategy.length >= 2 && /fuel|mileage|tire|pit/i.test(strategy.map((s) => s.summary).join(' '))) {
    const weight = 22 + strategy.length * 2;
    tagScores.fuel_mileage += weight;
    signalRows.push({
      signal: 'fuel_mileage',
      tag: 'fuel_mileage',
      weight,
      factIds: strategy.slice(0, 4).map((f) => f.id),
      sourceConfidence: combinedConfidence(strategy),
      reason: 'fuel_strategy_evidence',
    });
  }

  const historic = facts.filter((f) => f.factType === 'historical' && rankFactImportance(f) >= 60);
  if (historic.length) {
    const weight = 28 + historic.length * 4;
    tagScores.historic += weight;
    signalRows.push({
      signal: 'historic',
      tag: 'historic',
      weight,
      factIds: historic.map((f) => f.id),
      sourceConfidence: combinedConfidence(historic),
      reason: 'historical_milestone',
    });
  }

  const ranked = [...RACE_TEMPERATURE_TAGS]
    .map((tag) => ({ tag, score: tagScores[tag] || 0 }))
    .sort((a, b) => b.score - a.score);
  const primary = ranked[0]?.score > 0 ? ranked[0].tag : 'routine';
  const secondary =
    ranked[1]?.score > 0 && ranked[1].score >= ranked[0].score * 0.55 ? ranked[1].tag : null;

  const strongSignals = signalRows.filter((s) => s.weight >= 22);
  let confidence = 38 + strongSignals.length * 11 + Math.min(18, Math.round((ranked[0].score || 0) / 4));
  if (strongSignals.length < 2) confidence = Math.min(confidence, 82);
  if (strongSignals.length < 3) confidence = Math.min(confidence, 94);
  if (strongSignals.length < 4) confidence = Math.min(confidence, 99);
  confidence = Math.min(100, Math.max(35, confidence));

  const supportingFactIds = [...new Set(signalRows.flatMap((s) => s.factIds).filter(Boolean))].slice(0, 24);
  const canonicalFactIds = [
    ...new Set(
      facts.filter((f) => supportingFactIds.includes(f.id) && f.canonicalFactId).map((f) => f.canonicalFactId)
    ),
  ];

  const normalizedScore = confidence;

  return {
    primary,
    secondary,
    confidence,
    normalizedScore,
    supportingFactIds,
    canonicalFactIds,
    signals: signalRows.sort((a, b) => b.weight - a.weight).slice(0, 12),
    diagnostics: signalRows.map((s) => ({
      signal: s.signal,
      weight: s.weight,
      supportingFactIds: s.factIds,
      sourceConfidence: s.sourceConfidence,
    })),
  };
}

function driverDisplayName(fact) {
  return fact?.driverNames?.[0] || 'Driver';
}

export function buildReaderTakeaways(storyPlan, facts, articleDepth, outlineFactIds = null) {
  const depth = normalizeArticleDepth(articleDepth);
  const max = TAKEAWAY_MAX_BY_DEPTH[depth] || 6;
  const allowedFacts = outlineFactIds ? new Set(outlineFactIds) : null;
  const takeaways = [];

  function factsAllowed(factIds) {
    if (!allowedFacts) return factIds.length > 0;
    return factIds.some((id) => allowedFacts.has(id));
  }

  function pushTakeaway(takeawayId, label, factIds, category, priority = 1, sourceStoryIds = []) {
    if (!factsAllowed(factIds)) return;
    if (takeaways.some((t) => t.takeawayId === takeawayId)) return;
    takeaways.push({
      takeawayId,
      label,
      priority,
      importanceScore: 80,
      factIds: [...new Set(factIds)],
      canonicalFactIds: [],
      sourceStoryIds,
      category,
    });
  }

  const win = winnerFact(facts);
  if (win) {
    const name = driverDisplayName(win);
    const start = win.structuredData?.startPosition;
    if (start != null && start >= 10) {
      pushTakeaway('winner_recovery', `${name} won after starting ${start}th`, [win.id], 'result', 1, ['lead_story']);
    } else {
      pushTakeaway('winner_result', `${name} won the race`, [win.id], 'result', 1, ['lead_story']);
    }
  }

  const cautionAgg = facts.find(
    (f) => f.structuredData?.cautionCount != null || (/\b\d+\s+cautions?\b/i.test(f.summary || '') && isOfficialConfidence(f.confidence))
  );
  if (cautionAgg) {
    const m = String(cautionAgg.summary || '').match(/(\d+)\s+cautions?/i);
    const n = cautionAgg.structuredData?.cautionCount ?? (m ? Number(m[1]) : null);
    if (n != null) {
      pushTakeaway('caution_count', `${n} cautions shaped the race`, [cautionAgg.id], 'incidents', 1, ['secondary_story']);
    }
  }

  const milestone = milestoneFacts(facts)[0];
  if (milestone) {
    const name = driverDisplayName(milestone);
    pushTakeaway(
      'season_milestone',
      `${name} earned a key season victory milestone`,
      [milestone.id],
      'milestone',
      2,
      ['feature_story']
    );
    if (/third win|3rd win|three wins/i.test(milestone.summary || '')) {
      takeaways[takeaways.length - 1].label = `${name} earned third victory of the season`;
    }
  }

  const champ = championshipFacts(facts).find((f) => isOfficialConfidence(f.confidence));
  if (champ) {
    const mv = champ.structuredData?.movement;
    let label = 'Championship margin shifted';
    if (mv != null && mv < 0) label = 'Championship margin tightened';
    if (mv != null && mv > 0) label = 'Championship lead extended';
    pushTakeaway('championship_margin', label, [champ.id], 'championship', 2, ['championship_story']);
  }

  const strat = strategyFacts(facts).find((f) => (f.factQuality?.qualityScore ?? 50) >= 45);
  if (strat) {
    pushTakeaway('strategy_influence', 'Pit strategy influenced the final outcome', [strat.id], 'strategy', 2, [
      'strategy_story',
    ]);
  }

  const momentumStory = (storyPlan.stories || []).find((s) => s.storyId === 'momentum_story' && !s.empty);
  if (momentumStory?.driverIds?.[0]) {
    const fact = facts.find((f) => momentumStory.factIds.includes(f.id));
    const name = fact ? driverDisplayName(fact) : 'Driver';
    pushTakeaway(
      'driver_momentum',
      `${name} gained points momentum`,
      momentumStory.factIds.slice(0, 3),
      'momentum',
      3,
      ['momentum_story']
    );
  }

  return takeaways
    .sort((a, b) => a.priority - b.priority || b.importanceScore - a.importanceScore)
    .slice(0, max);
}

function scoreLeadCandidate(type, facts, extra = 0) {
  const base = facts.reduce((s, f) => s + rankFactImportance(f), 0);
  const weights = {
    championship: 88,
    controversy: 86,
    recovery: 92,
    milestone: 84,
    decisive_incident: 80,
    strategy: 70,
    battle: 76,
    winner: 74,
    chaotic: 78,
  };
  const avg = base / Math.max(1, facts.length);
  return {
    typeWeight: weights[type] || 60,
    evidenceAverage: Math.round(avg),
    evidenceTotal: Math.round(base),
    bonus: extra,
    total: (weights[type] || 60) + avg + extra,
  };
}

export function buildStoryPlan({
  racePackage,
  preparedFacts,
  seasonId,
  raceNumber,
  articleType = 'race-recap',
  articleDepth = 'medium',
  operationId: opIn,
  driverLookup,
  requiredRecap: requiredRecapIn,
}) {
  const depth = normalizeArticleDepth(articleDepth);
  const allPrepared = preparedFacts || racePackage?.facts || [];
  const planningPool = planningFactsOnly(allPrepared);
  const facts = [...planningPool].sort((a, b) => rankFactImportance(b) - rankFactImportance(a));
  const fingerprint = computePackageFingerprint(racePackage, seasonId, raceNumber);
  const operationId = opIn || deterministicOperationId(fingerprint, depth);
  const driverPackages = buildRaceDriverStoryPackages({ racePackage: { facts: allPrepared }, driverLookup }).sort(
    (a, b) => b.storyImportanceScore - a.storyImportanceScore
  );

  const requiredRecap = requiredRecapIn || buildRequiredRecapFacts(allPrepared);

  const win = winnerFact(allPrepared);
  const champ = championshipFacts(facts);
  const cautions = cautionFacts(facts);
  const incidents = incidentFacts(facts);
  const strategy = strategyFacts(facts);
  const conflicts = conflictFacts(facts);
  const milestones = milestoneFacts(facts);

  const leadCandidates = [];

  if (win) {
    const recoveryBoost = winnerRecoveryLeadBoost(win, requiredRecap);
    const components = scoreLeadCandidate('winner', [win], recoveryBoost);
    leadCandidates.push({
      candidateType: recoveryBoost >= 25 ? 'recovery' : 'winner/result',
      type: recoveryBoost >= 25 ? 'recovery' : 'winner',
      facts: [win],
      score: components.total,
      scoreComponents: components,
      confidence: combinedConfidence([win]),
      selected: false,
      suppressedReason: null,
    });
    if (recoveryBoost >= 25) {
      leadCandidates.push({
        candidateType: 'recovery',
        type: 'recovery',
        facts: [win],
        score: components.total + 5,
        scoreComponents: { ...components, bonus: components.bonus + 5, total: components.total + 5 },
        confidence: combinedConfidence([win]),
        selected: false,
        suppressedReason: null,
      });
    }
  }

  if (milestones.length) {
    const components = scoreLeadCandidate('milestone', milestones.slice(0, 3), 12);
    leadCandidates.push({
      candidateType: 'milestone',
      type: 'milestone',
      facts: milestones.slice(0, 3),
      score: components.total,
      scoreComponents: components,
      confidence: combinedConfidence(milestones),
      selected: false,
      suppressedReason: null,
    });
  }

  if (champ.length) {
    const components = scoreLeadCandidate(
      'championship',
      champ.slice(0, 6),
      Math.abs(champ[0]?.structuredData?.movement || 0) * 2
    );
    leadCandidates.push({
      candidateType: 'championship swing',
      type: 'championship',
      facts: champ.slice(0, 6),
      score: components.total,
      scoreComponents: components,
      confidence: combinedConfidence(champ),
      selected: false,
      suppressedReason: null,
    });
  }

  if (conflicts.length) {
    const components = scoreLeadCandidate('controversy', conflicts.slice(0, 5));
    leadCandidates.push({
      candidateType: 'controversy',
      type: 'controversy',
      facts: conflicts.slice(0, 5),
      score: components.total,
      scoreComponents: components,
      confidence: 'conflicting',
      selected: false,
      suppressedReason: null,
    });
  }

  const decisive = incidents.concat(cautions.filter((c) => c.factQuality?.qualityScore >= 50)).slice(0, 5);
  if (decisive.length) {
    const components = scoreLeadCandidate('decisive_incident', decisive);
    leadCandidates.push({
      candidateType: 'decisive incident',
      type: 'decisive_incident',
      facts: decisive,
      score: components.total,
      scoreComponents: components,
      confidence: combinedConfidence(decisive),
      selected: false,
      suppressedReason: null,
    });
  }

  if (strategy.length >= 2) {
    const components = scoreLeadCandidate('strategy', strategy.slice(0, 4));
    leadCandidates.push({
      candidateType: 'strategy',
      type: 'strategy',
      facts: strategy.slice(0, 4),
      score: components.total,
      scoreComponents: components,
      confidence: combinedConfidence(strategy),
      selected: false,
      suppressedReason: null,
    });
  }

  if (cautions.length >= 4) {
    const components = scoreLeadCandidate('chaotic', cautions);
    leadCandidates.push({
      candidateType: 'chaotic race',
      type: 'chaotic',
      facts: [...cautions.slice(0, 4), ...incidents.slice(0, 3)],
      score: components.total,
      scoreComponents: components,
      confidence: combinedConfidence(cautions),
      selected: false,
      suppressedReason: null,
    });
  }

  const topFinish = facts.filter(
    (f) => f.factType === 'result' && [1, 2, 3].includes(Number(f.structuredData?.finishPosition))
  );
  if (topFinish.length >= 2) {
    const components = scoreLeadCandidate('battle', topFinish.slice(0, 5));
    leadCandidates.push({
      candidateType: 'winner/result',
      type: 'battle',
      facts: topFinish.slice(0, 5),
      score: components.total,
      scoreComponents: components,
      confidence: combinedConfidence(topFinish),
      selected: false,
      suppressedReason: null,
    });
  }

  leadCandidates.sort((a, b) => b.score - a.score);
  const leadPick = leadCandidates[0] || { facts: facts.slice(0, 3), score: 0, candidateType: 'fallback' };
  if (leadCandidates[0]) leadCandidates[0].selected = true;
  for (let i = 1; i < leadCandidates.length; i += 1) {
    leadCandidates[i].suppressedReason = `Lower score than ${leadCandidates[0].candidateType} (${Math.round(leadCandidates[0].score)} vs ${Math.round(leadCandidates[i].score)})`;
  }

  const usedFactIds = new Set(leadPick.facts.map((f) => f.id));

  let leadStory = storyFromFacts('lead_story', 'lead_story', 1, leadPick.facts, collectDriverIds(leadPick.facts));

  const remaining = facts.filter((f) => !usedFactIds.has(f.id));
  const secondaryFacts = remaining
    .filter((f) => ['result', 'lead_change', 'race_event'].includes(f.factType))
    .slice(0, 6);
  secondaryFacts.forEach((f) => usedFactIds.add(f.id));
  let secondaryStory = storyFromFacts(
    'secondary_story',
    'secondary_story',
    2,
    secondaryFacts.length ? secondaryFacts : remaining.slice(0, 3),
    collectDriverIds(secondaryFacts)
  );

  let champStory = storyFromFacts('championship_story', 'championship_story', 3, champ.slice(0, 8), collectDriverIds(champ));

  const humanPkg = driverPackages[0];
  const humanFactIds = humanPkg
    ? [...new Set([...(humanPkg.timelineFactIds || []), ...(humanPkg.incidentFactIds || [])])].slice(0, 8)
    : [];
  const humanFacts = facts.filter((f) => humanFactIds.includes(f.id));
  let humanStory =
    humanFacts.length > 0
      ? storyFromFacts('human_story', 'human_story', 4, humanFacts, humanPkg?.driverId ? [humanPkg.driverId] : [])
      : emptyStory('human_story', 'human_story');

  const techFacts = facts.filter((f) => f.factType === 'strategy' || f.category === 'technical');
  let technicalStory = storyFromFacts(
    'technical_story',
    'technical_story',
    5,
    techFacts.slice(0, 5),
    collectDriverIds(techFacts)
  );

  const hiddenFacts = remaining.filter((f) => f.category === 'biggest_gainer' || f.category === 'recovery').slice(0, 4);
  if (win && requiredRecap.items.find((i) => i.role === 'winner_positions_gained')?.positionsGained >= 10) {
    hiddenFacts.unshift(win);
  }
  let hiddenStory = storyFromFacts('hidden_story', 'hidden_story', 6, hiddenFacts, collectDriverIds(hiddenFacts));

  const momentumFacts = champ.filter((f) => f.structuredData?.movement != null && f.structuredData.movement !== 0);
  let momentumStory = storyFromFacts(
    'momentum_story',
    'momentum_story',
    7,
    momentumFacts.slice(0, 5),
    collectDriverIds(momentumFacts)
  );

  let strategyStory = storyFromFacts('strategy_story', 'strategy_story', 8, strategy.slice(0, 6), collectDriverIds(strategy));

  let controversyStory =
    conflicts.length > 0
      ? storyFromFacts('controversy_story', 'controversy_story', 9, conflicts.slice(0, 6), collectDriverIds(conflicts))
      : emptyStory('controversy_story', 'controversy_story');

  const featureFacts = facts
    .filter((f) => f.factType === 'historical' || f.category === 'driver_story' || milestones.includes(f))
    .slice(0, 5);
  let featureStory = storyFromFacts('feature_story', 'feature_story', 5, featureFacts, collectDriverIds(featureFacts));

  let stories = [
    leadStory,
    secondaryStory,
    champStory,
    humanStory,
    technicalStory,
    featureStory,
    hiddenStory,
    momentumStory,
    strategyStory,
    controversyStory,
  ];

  stories = applyRequiredRecapToStories(stories, requiredRecap, allPrepared);
  leadStory = stories.find((s) => s.storyId === 'lead_story');
  secondaryStory = stories.find((s) => s.storyId === 'secondary_story');

  const raceTemperature = computeRaceTemperature(planningPool);
  let readerTakeaways = buildReaderTakeaways({ stories, leadStoryId: 'lead_story' }, allPrepared, depth);

  const rankedDrivers = driverPackages.slice(0, depth === 'short' ? 4 : depth === 'medium' ? 8 : 12).map((d, i) => ({
    driverId: d.driverId,
    displayName: d.canonicalName,
    roles: [
      d.finishingPosition === 1 ? 'winner' : null,
      d.positionsChanged > 5 ? 'gainer' : null,
      d.positionsChanged < -5 ? 'loser' : null,
      d.storyImportanceScore >= 50 ? 'storyline' : null,
    ].filter(Boolean),
    priority: i + 1,
    factIds: [...new Set([...(d.timelineFactIds || []), ...(d.incidentFactIds || [])])].slice(0, 12),
    storyImportanceScore: d.storyImportanceScore,
  }));

  return {
    operationId,
    seasonId: String(seasonId),
    raceNumber: Number(raceNumber),
    articleType,
    articleDepth: depth,
    packageFingerprint: fingerprint,
    plannerVersion: NEWS_WRITER_PLANNER_VERSION,
    generatedAt: '1970-01-01T00:00:00.000Z',
    stories,
    raceTemperature,
    readerTakeaways,
    rankedDrivers,
    leadStoryId: 'lead_story',
    requiredRecap,
    plannerDiagnostics: {
      candidateCount: leadCandidates.length,
      suppressedStories: stories.filter((s) => s.empty).map((s) => ({ storyId: s.storyId, reason: 'no_evidence' })),
      tieBreakers: ['importance_score', 'official_confidence', 'lead_candidate_score'],
      leadCandidateScores: leadCandidates.map((c) => ({
        candidateType: c.candidateType,
        type: c.type,
        score: Math.round(c.score),
        scoreComponents: c.scoreComponents,
        supportingFactIds: c.facts.map((f) => f.id),
        confidence: c.confidence,
        selected: c.selected,
        suppressedReason: c.suppressedReason,
      })),
      leadWinner: leadPick.candidateType,
    },
  };
}

export function refreshTakeawaysForOutline(storyPlan, preparedFacts, articleDepth, outline) {
  const outlineFactIds = outline.sections.flatMap((s) => s.evidence?.factIds || []);
  storyPlan.readerTakeaways = buildReaderTakeaways(storyPlan, preparedFacts, articleDepth, outlineFactIds);
  return storyPlan;
}
