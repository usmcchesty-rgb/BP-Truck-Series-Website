import { NEWS_WRITER_PLANNER_VERSION } from './_news-writer-config.js';

const CONFIDENCE_RANK = {
  official: 7,
  officially_confirmed: 6,
  manual: 5,
  derived: 4,
  historical: 3,
  broadcast_reported: 2,
  unverified: 1,
  conflicting: 0,
};

export function rankFactImportance(fact) {
  let score = Number(fact.importanceScore) || 0;
  score += (CONFIDENCE_RANK[fact.confidence] ?? 0) * 4;
  if (fact.category === 'winner' || fact.structuredData?.finishPosition === 1) score += 25;
  if (fact.factType === 'caution') score += 8;
  if (fact.confidence === 'conflicting') score += 15;
  return score;
}

export function combinedConfidence(facts) {
  let best = 'unverified';
  for (const f of facts) {
    const c = f.confidence || 'unverified';
    if ((CONFIDENCE_RANK[c] ?? 0) > (CONFIDENCE_RANK[best] ?? 0)) best = c;
  }
  return best;
}

export function priorityTierFromScore(score) {
  if (score >= 85) return 'critical';
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

export function initFactUsageLedger(racePackage, { operationId, packageFingerprint }) {
  const facts = racePackage?.facts || [];
  const ledgerFacts = {};
  for (const fact of facts) {
    const importanceScore = rankFactImportance(fact);
    ledgerFacts[fact.id] = {
      factId: fact.id,
      factType: fact.factType,
      category: fact.category || '',
      summaryShort: String(fact.summary || '').slice(0, 120),
      importanceScore,
      priorityTier: priorityTierFromScore(importanceScore),
      status: 'unused',
      assignedStoryIds: [],
      assignedSectionIds: [],
      usedInSectionIds: [],
      citationCount: 0,
      canonicalFactId: fact.canonicalFactId || null,
    };
  }

  return {
    operationId,
    packageFingerprint,
    ledgerVersion: NEWS_WRITER_PLANNER_VERSION,
    facts: ledgerFacts,
    canonical: {},
  };
}

export function assignFactsToStories(ledger, storyPlan) {
  for (const story of storyPlan.stories || []) {
    if (story.empty) continue;
    for (const factId of story.factIds || []) {
      const entry = ledger.facts[factId];
      if (!entry) continue;
      if (!entry.assignedStoryIds.includes(story.storyId)) {
        entry.assignedStoryIds.push(story.storyId);
      }
      if (entry.status === 'unused') entry.status = 'planned';
      entry.firstUsedAtStage = entry.firstUsedAtStage || 'planner';
    }
    for (const cid of story.canonicalFactIds || []) {
      if (!ledger.canonical[cid]) {
        ledger.canonical[cid] = {
          canonicalFactId: cid,
          status: 'planned',
          assignedStoryIds: [story.storyId],
          assignedSectionIds: [],
        };
      }
    }
  }
  return ledger;
}

export function assignFactsToOutlineSections(ledger, outline) {
  for (const section of outline.sections || []) {
    const factIds = section.evidence?.factIds || [];
    for (const factId of factIds) {
      const entry = ledger.facts[factId];
      if (!entry) continue;
      if (!entry.assignedSectionIds.includes(section.sectionId)) {
        entry.assignedSectionIds.push(section.sectionId);
      }
      if (entry.status === 'unused' || entry.status === 'planned') {
        entry.status = 'planned';
      }
      entry.firstUsedAtStage = entry.firstUsedAtStage || 'outline';
    }
  }
  return ledger;
}

export function getLedgerCoverageSummary(ledger) {
  const entries = Object.values(ledger.facts || {});
  const usedOrPlanned = entries.filter((e) =>
    ['planned', 'writing', 'used'].includes(e.status)
  );
  const highPlus = entries.filter((e) => e.priorityTier === 'critical' || e.priorityTier === 'high');
  const highUsed = highPlus.filter((e) => ['planned', 'writing', 'used'].includes(e.status));
  return {
    totalFacts: entries.length,
    plannedOrUsed: usedOrPlanned.length,
    coveragePercent:
      entries.length === 0 ? 0 : Math.round((usedOrPlanned.length / entries.length) * 1000) / 10,
    highPriorityTotal: highPlus.length,
    highPriorityPlanned: highUsed.length,
    highPriorityCoveragePercent:
      highPlus.length === 0 ? 100 : Math.round((highUsed.length / highPlus.length) * 1000) / 10,
  };
}

export function getUnusedCriticalFacts(ledger, limit = 20) {
  return Object.values(ledger.facts || {})
    .filter((e) => e.priorityTier === 'critical' && e.status === 'unused')
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, limit)
    .map((e) => ({
      factId: e.factId,
      summaryShort: e.summaryShort,
      importanceScore: e.importanceScore,
    }));
}
