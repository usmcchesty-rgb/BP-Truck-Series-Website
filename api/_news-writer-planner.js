import { normalizeArticleDepth } from '../server/config/race-research-config.js';
import { buildRaceDriverStoryPackages } from './_race-research-driver-stories.js';
import {
  NEWS_WRITER_PLANNER_VERSION,
  RACE_TEMPERATURE_TAGS,
  TAKEAWAY_MAX_BY_DEPTH,
} from './_news-writer-config.js';
import { rankFactImportance, combinedConfidence } from './_news-writer-ledger.js';
import { computePackageFingerprint, deterministicOperationId } from './_news-writer-fingerprint.js';

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
    (f) => f.category === 'winner' || (f.factType === 'result' && f.structuredData?.finishPosition === 1)
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

function textMentionsRain(facts) {
  return facts.some((f) => /rain|wet|weather/i.test(String(f.summary || '')));
}

function textMentionsFuel(facts) {
  return facts.some(
    (f) =>
      f.factType === 'strategy' ||
      /fuel|mileage|pit strategy|tire/i.test(String(f.summary || ''))
  );
}

export function computeRaceTemperature(facts) {
  const signals = [];
  const tagScores = Object.fromEntries(RACE_TEMPERATURE_TAGS.map((t) => [t, 0]));

  const cautions = cautionFacts(facts);
  const incidents = incidentFacts(facts);
  const championship = championshipFacts(facts);
  const conflicts = conflictFacts(facts);
  const strategy = strategyFacts(facts);

  if (cautions.length >= 5) {
    tagScores.chaotic += 40 + cautions.length * 2;
    signals.push({
      tag: 'chaotic',
      score: tagScores.chaotic,
      factIds: cautions.slice(0, 8).map((f) => f.id),
      reason: 'caution_count_high',
    });
  } else if (cautions.length >= 2) {
    tagScores.competitive += 20 + cautions.length * 3;
    signals.push({
      tag: 'competitive',
      score: tagScores.competitive,
      factIds: cautions.slice(0, 5).map((f) => f.id),
      reason: 'moderate_cautions',
    });
  } else if (facts.length > 0) {
    tagScores.routine += 25;
    signals.push({ tag: 'routine', score: 25, factIds: [], reason: 'low_caution_count' });
  }

  const bigMovement = championship.filter(
    (f) => Math.abs(Number(f.structuredData?.movement) || 0) >= 3
  );
  if (bigMovement.length) {
    tagScores.championship_defining += 50 + bigMovement.length * 5;
    signals.push({
      tag: 'championship_defining',
      score: tagScores.championship_defining,
      factIds: bigMovement.map((f) => f.id),
      reason: 'standings_movement',
    });
  }

  if (conflicts.length) {
    tagScores.controversial += 45 + conflicts.length * 8;
    signals.push({
      tag: 'controversial',
      score: tagScores.controversial,
      factIds: conflicts.map((f) => f.id),
      reason: 'conflicting_evidence',
    });
  }

  if (incidents.length >= 3) {
    tagScores.emotional += 30 + incidents.length * 4;
    signals.push({
      tag: 'emotional',
      score: tagScores.emotional,
      factIds: incidents.slice(0, 6).map((f) => f.id),
      reason: 'incident_volume',
    });
  }

  if (strategy.length >= 2) {
    tagScores.technical += 25 + strategy.length * 3;
    signals.push({
      tag: 'technical',
      score: tagScores.technical,
      factIds: strategy.map((f) => f.id),
      reason: 'strategy_facts',
    });
  }

  if (textMentionsFuel(facts)) {
    tagScores.fuel_mileage += 35;
    signals.push({
      tag: 'fuel_mileage',
      score: tagScores.fuel_mileage,
      factIds: strategy.slice(0, 4).map((f) => f.id),
      reason: 'fuel_strategy_keywords',
    });
  }

  if (textMentionsRain(facts)) {
    tagScores.rain_affected += 40;
    signals.push({
      tag: 'rain_affected',
      score: tagScores.rain_affected,
      factIds: facts.filter((f) => /rain|wet/i.test(f.summary || '')).map((f) => f.id),
      reason: 'weather_keywords',
    });
  }

  const historic = facts.filter((f) => f.factType === 'historical' && rankFactImportance(f) >= 60);
  if (historic.length) {
    tagScores.historic += 30 + historic.length * 5;
    signals.push({
      tag: 'historic',
      score: tagScores.historic,
      factIds: historic.map((f) => f.id),
      reason: 'historical_milestone',
    });
  }

  const ranked = [...RACE_TEMPERATURE_TAGS]
    .map((tag) => ({ tag, score: tagScores[tag] || 0 }))
    .sort((a, b) => b.score - a.score);
  const primary = ranked[0]?.score > 0 ? ranked[0].tag : 'routine';
  const secondary =
    ranked[1]?.score > 0 && ranked[1].score >= ranked[0].score * 0.55 ? ranked[1].tag : null;
  const confidence = Math.min(
    100,
    Math.max(40, Math.round(ranked[0].score - (ranked[1]?.score || 0) + 50))
  );

  const supportingFactIds = [...new Set(signals.flatMap((s) => s.factIds).filter(Boolean))].slice(0, 24);
  const canonicalFactIds = [
    ...new Set(
      facts.filter((f) => supportingFactIds.includes(f.id) && f.canonicalFactId).map((f) => f.canonicalFactId)
    ),
  ];

  return {
    primary,
    secondary,
    confidence,
    supportingFactIds,
    canonicalFactIds,
    signals: signals.sort((a, b) => b.score - a.score).slice(0, 12),
  };
}

const TAKEAWAY_TEMPLATES = {
  championship_story: { id: 'championship_tightened', label: 'Championship tightened', category: 'championship' },
  strategy_story: { id: 'strategy_decisive', label: 'Pit strategy mattered', category: 'strategy' },
  controversy_story: { id: 'controversy_flagged', label: 'Penalty shaped the race', category: 'penalty' },
  momentum_story: { id: 'momentum_shift', label: 'Momentum shifted', category: 'momentum' },
  human_story: { id: 'human_angle', label: 'Driver storyline stood out', category: 'human' },
  lead_story: { id: 'race_decided', label: 'Race outcome defined the day', category: 'result' },
};

export function buildReaderTakeaways(storyPlan, facts, articleDepth) {
  const depth = normalizeArticleDepth(articleDepth);
  const max = TAKEAWAY_MAX_BY_DEPTH[depth] || 6;
  const takeaways = [];
  const driverLookup = new Map();
  for (const f of facts) {
    for (let i = 0; i < (f.driverNames || []).length; i += 1) {
      const id = f.driverIds?.[i];
      if (id) driverLookup.set(String(id), f.driverNames[i]);
    }
  }

  const stories = [...(storyPlan.stories || [])]
    .filter((s) => !s.empty)
    .sort((a, b) => a.priority - b.priority);

  for (const story of stories) {
    const tpl = TAKEAWAY_TEMPLATES[story.category];
    if (!tpl) continue;
    let label = tpl.label;
    if (story.category === 'momentum_story' && story.driverIds?.[0]) {
      const name = driverLookup.get(story.driverIds[0]) || 'Driver';
      label = `${name} gained momentum`;
    }
    if (takeaways.some((t) => t.takeawayId === tpl.id)) continue;
    takeaways.push({
      takeawayId: tpl.id,
      label,
      priority: story.priority <= 2 ? 1 : story.priority <= 4 ? 2 : 3,
      importanceScore: story.importanceScore,
      factIds: [...story.factIds],
      canonicalFactIds: [...story.canonicalFactIds],
      sourceStoryIds: [story.storyId],
      category: tpl.category,
    });
    if (takeaways.length >= max) break;
  }

  return takeaways.sort((a, b) => a.priority - b.priority || b.importanceScore - a.importanceScore);
}

function scoreLeadCandidate(type, facts, extra = 0) {
  const base = facts.reduce((s, f) => s + rankFactImportance(f), 0);
  const weights = {
    championship: 95,
    controversy: 88,
    chaotic: 82,
    battle: 78,
    winner: 72,
    strategy: 68,
  };
  return (weights[type] || 60) + base / Math.max(1, facts.length) + extra;
}

export function buildStoryPlan({
  racePackage,
  seasonId,
  raceNumber,
  articleType = 'race-recap',
  articleDepth = 'medium',
  operationId: opIn,
}) {
  const depth = normalizeArticleDepth(articleDepth);
  const facts = [...(racePackage?.facts || [])].sort((a, b) => rankFactImportance(b) - rankFactImportance(a));
  const fingerprint = computePackageFingerprint(racePackage, seasonId, raceNumber);
  const operationId = opIn || deterministicOperationId(fingerprint, depth);
  const driverPackages = buildRaceDriverStoryPackages({ racePackage }).sort(
    (a, b) => b.storyImportanceScore - a.storyImportanceScore
  );

  const win = winnerFact(facts);
  const champ = championshipFacts(facts);
  const cautions = cautionFacts(facts);
  const incidents = incidentFacts(facts);
  const strategy = strategyFacts(facts);
  const conflicts = conflictFacts(facts);

  const leadCandidates = [];
  if (champ.length) {
    leadCandidates.push({
      type: 'championship',
      facts: champ.slice(0, 6),
      score: scoreLeadCandidate('championship', champ, Math.abs(champ[0]?.structuredData?.movement || 0) * 2),
    });
  }
  if (conflicts.length) {
    leadCandidates.push({
      type: 'controversy',
      facts: conflicts.slice(0, 5),
      score: scoreLeadCandidate('controversy', conflicts),
    });
  }
  if (cautions.length >= 4) {
    leadCandidates.push({
      type: 'chaotic',
      facts: [...cautions.slice(0, 4), ...incidents.slice(0, 3)],
      score: scoreLeadCandidate('chaotic', cautions),
    });
  }
  const topFinish = facts.filter(
    (f) => f.factType === 'result' && [1, 2, 3].includes(Number(f.structuredData?.finishPosition))
  );
  if (topFinish.length >= 2) {
    leadCandidates.push({
      type: 'battle',
      facts: topFinish.slice(0, 5),
      score: scoreLeadCandidate('battle', topFinish),
    });
  }
  if (win) {
    leadCandidates.push({
      type: 'winner',
      facts: [win, ...facts.filter((f) => f.factType === 'result').slice(0, 3)],
      score: scoreLeadCandidate('winner', [win]),
    });
  }

  leadCandidates.sort((a, b) => b.score - a.score);
  const leadPick = leadCandidates[0] || { facts: facts.slice(0, 3), score: 0 };
  const usedFactIds = new Set(leadPick.facts.map((f) => f.id));

  const leadStory = storyFromFacts(
    'lead_story',
    'lead_story',
    1,
    leadPick.facts,
    collectDriverIds(leadPick.facts)
  );

  const remaining = facts.filter((f) => !usedFactIds.has(f.id));
  const secondaryFacts = remaining
    .filter((f) => ['result', 'lead_change', 'race_event'].includes(f.factType))
    .slice(0, 6);
  secondaryFacts.forEach((f) => usedFactIds.add(f.id));
  const secondaryStory = storyFromFacts(
    'secondary_story',
    'secondary_story',
    2,
    secondaryFacts.length ? secondaryFacts : remaining.slice(0, 3),
    collectDriverIds(secondaryFacts)
  );

  const champStory = storyFromFacts(
    'championship_story',
    'championship_story',
    3,
    champ.slice(0, 8),
    collectDriverIds(champ)
  );

  const humanPkg = driverPackages[0];
  const humanFactIds = humanPkg
    ? [...new Set([...(humanPkg.timelineFactIds || []), ...(humanPkg.incidentFactIds || [])])].slice(0, 8)
    : [];
  const humanFacts = facts.filter((f) => humanFactIds.includes(f.id));
  const humanStory =
    humanFacts.length > 0
      ? storyFromFacts('human_story', 'human_story', 4, humanFacts, humanPkg?.driverId ? [humanPkg.driverId] : [])
      : emptyStory('human_story', 'human_story');

  const techFacts = facts.filter((f) => f.factType === 'strategy' || f.category === 'technical');
  const technicalStory = storyFromFacts(
    'technical_story',
    'technical_story',
    5,
    techFacts.slice(0, 5),
    collectDriverIds(techFacts)
  );

  const hiddenFacts = remaining.filter((f) => f.category === 'biggest_gainer' || f.category === 'recovery').slice(0, 4);
  const hiddenStory = storyFromFacts(
    'hidden_story',
    'hidden_story',
    6,
    hiddenFacts,
    collectDriverIds(hiddenFacts)
  );

  const momentumFacts = champ.filter((f) => f.structuredData?.movement != null && f.structuredData.movement !== 0);
  const momentumStory = storyFromFacts(
    'momentum_story',
    'momentum_story',
    7,
    momentumFacts.slice(0, 5),
    collectDriverIds(momentumFacts)
  );

  const strategyStory = storyFromFacts(
    'strategy_story',
    'strategy_story',
    8,
    strategy.slice(0, 6),
    collectDriverIds(strategy)
  );

  const controversyStory =
    conflicts.length > 0
      ? storyFromFacts('controversy_story', 'controversy_story', 9, conflicts.slice(0, 6), collectDriverIds(conflicts))
      : emptyStory('controversy_story', 'controversy_story');

  const featureFacts = facts.filter((f) => f.factType === 'historical' || f.category === 'driver_story').slice(0, 5);
  const featureStory = storyFromFacts(
    'feature_story',
    'feature_story',
    5,
    featureFacts,
    collectDriverIds(featureFacts)
  );

  const stories = [
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

  const raceTemperature = computeRaceTemperature(facts);
  const readerTakeaways = buildReaderTakeaways({ stories, leadStoryId: 'lead_story' }, facts, depth);

  const rankedDrivers = driverPackages.slice(0, depth === 'short' ? 4 : depth === 'medium' ? 8 : 12).map((d, i) => ({
    driverId: d.driverId,
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
    plannerDiagnostics: {
      candidateCount: leadCandidates.length,
      suppressedStories: stories.filter((s) => s.empty).map((s) => ({ storyId: s.storyId, reason: 'no_evidence' })),
      tieBreakers: ['importance_score', 'official_confidence', 'lead_candidate_score'],
      leadCandidateScores: leadCandidates.map((c) => ({ type: c.type, score: Math.round(c.score) })),
    },
  };
}
