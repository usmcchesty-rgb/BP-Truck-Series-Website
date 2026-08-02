import {
  ARTICLE_DEPTH_EVIDENCE_GUIDELINES,
  ARTICLE_DEPTH_INPUT_TOKEN_BUDGET,
  normalizeArticleDepth,
} from '../server/config/race-research-config.js';
import { IN_DEPTH_CATEGORIES } from './_race-research-readiness.js';
import { buildRaceDriverStoryPackages } from './_race-research-driver-stories.js';

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function rankFact(fact) {
  let score = Number(fact.importanceScore) || 0;
  const confidenceBoost = {
    official: 30,
    officially_confirmed: 28,
    manual: 22,
    derived: 18,
    historical: 12,
    broadcast_reported: 10,
    unverified: 0,
    conflicting: 5,
  };
  score += confidenceBoost[fact.confidence] ?? 0;
  return score;
}

function requiredCoreFacts(facts, articleType) {
  const required = [];
  const winner = facts.find(
    (f) => f.category === 'winner' || (f.factType === 'result' && f.structuredData?.finishPosition === 1)
  );
  if (winner) required.push(winner.id);

  if (articleType === 'race-recap' || articleType === 'championship-watch') {
    const schedule = facts.find((f) => f.category === 'schedule_metadata');
    if (schedule) required.push(schedule.id);
  }
  return required;
}

function confidenceDistribution(facts) {
  const dist = {};
  for (const f of facts) dist[f.confidence] = (dist[f.confidence] || 0) + 1;
  return dist;
}

function categoryDistribution(facts) {
  const dist = {};
  for (const f of facts) {
    const key = `${f.factType}:${f.category || ''}`;
    dist[key] = (dist[key] || 0) + 1;
  }
  return dist;
}

export function selectEvidenceForArticle({ racePackage, articleType, articleDepth }) {
  const depth = normalizeArticleDepth(articleDepth);
  const guidelines = ARTICLE_DEPTH_EVIDENCE_GUIDELINES[depth];
  const budget = ARTICLE_DEPTH_INPUT_TOKEN_BUDGET[depth];

  const facts = [...(racePackage.facts || [])].sort((a, b) => rankFact(b) - rankFact(a));
  const requiredIds = new Set(requiredCoreFacts(facts, articleType));

  const selectedFacts = [];
  const selectedIds = new Set();
  let tokens = 0;

  const tryAdd = (fact) => {
    if (!fact || selectedIds.has(fact.id)) return false;
    const addTokens = estimateTokens(JSON.stringify(fact));
    if (tokens + addTokens > budget.max && !requiredIds.has(fact.id)) return false;
    selectedFacts.push(fact);
    selectedIds.add(fact.id);
    tokens += addTokens;
    return true;
  };

  for (const fact of facts) {
    if (requiredIds.has(fact.id)) tryAdd(fact);
  }

  const categoryQuota = depth === 'in-depth' ? IN_DEPTH_CATEGORIES : IN_DEPTH_CATEGORIES.slice(0, 8);
  for (const cat of categoryQuota) {
    const match = facts.find((f) => !selectedIds.has(f.id) && cat.test(f));
    if (match) tryAdd(match);
  }

  const categoriesSeen = new Set();
  for (const fact of facts) {
    if (selectedFacts.length >= guidelines.factMax) break;
    const cat = `${fact.factType}:${fact.category || ''}`;
    if (categoriesSeen.has(cat) && !requiredIds.has(fact.id)) continue;
    if (tryAdd(fact)) categoriesSeen.add(cat);
  }

  while (selectedFacts.length < guidelines.factMin && selectedFacts.length < facts.length) {
    const next = facts.find((f) => !selectedIds.has(f.id));
    if (!next || !tryAdd(next)) break;
  }

  const selectedTimelineEvents = (racePackage.timeline || []).filter((e) => selectedIds.has(e.id));
  const selectedQuotes = (racePackage.verifiedQuotes || [])
    .filter((q) => selectedIds.has(q.id))
    .slice(0, guidelines.quotesMax);

  const driverPackages = buildRaceDriverStoryPackages({ racePackage });
  const driverSet = new Set();
  for (const fact of selectedFacts) {
    for (const id of fact.driverIds || []) driverSet.add(String(id));
  }

  const omittedHighPriorityFacts = facts
    .filter((f) => !selectedIds.has(f.id) && rankFact(f) >= 60)
    .slice(0, 25)
    .map((f) => f.id);

  const availableCategories = IN_DEPTH_CATEGORIES.filter((c) => facts.some(c.test)).map((c) => c.key);
  const selectedCategories = IN_DEPTH_CATEGORIES.filter((c) => selectedFacts.some(c.test)).map((c) => c.key);

  return {
    selectedFacts,
    selectedTimelineEvents,
    selectedDriverSummaries: driverPackages.slice(0, guidelines.driversMax),
    selectedQuotes,
    selectedHistory: (racePackage.historicalContext || []).filter((f) => selectedIds.has(f.id)),
    selectedChampionshipFacts: selectedFacts.filter((f) => f.factType === 'championship'),
    omittedHighPriorityFacts,
    estimatedTokens: tokens,
    articleDepth: depth,
    featuredDriverCount: Math.min(guidelines.driversMax, Math.max(driverSet.size, driverPackages.length)),
    categoryCoverage: {
      requiredCategories: IN_DEPTH_CATEGORIES.map((c) => c.key),
      availableCategories,
      selectedCategories,
      missingCategories: IN_DEPTH_CATEGORIES.map((c) => c.key).filter((k) => !availableCategories.includes(k)),
    },
    confidenceDistribution: confidenceDistribution(selectedFacts),
    categoryDistribution: categoryDistribution(selectedFacts),
    samePackageFactCount: facts.length,
  };
}
