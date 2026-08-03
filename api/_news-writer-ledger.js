import { NEWS_WRITER_PLANNER_VERSION } from './_news-writer-config.js';
import { buildCanonicalPreferenceIndex } from './_news-writer-fact-quality.js';

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

export function initFactUsageLedger(preparedFacts, { operationId, packageFingerprint }) {
  const facts = preparedFacts || [];
  const { byCanonical } = buildCanonicalPreferenceIndex(facts);
  const ledgerFacts = {};

  for (const fact of facts) {
    const importanceScore = fact.importanceScore ?? rankFactImportance(fact);
    const priorityTier = fact.planningPriorityTier || priorityTierFromScore(importanceScore);
    ledgerFacts[fact.id] = {
      factId: fact.id,
      factType: fact.factType,
      category: fact.category || '',
      summaryShort: String(fact.summary || '').slice(0, 120),
      importanceScore,
      priorityTier,
      status: 'unused',
      assignedStoryIds: [],
      assignedSectionIds: [],
      usedInSectionIds: [],
      citationCount: 0,
      canonicalFactId: fact.canonicalFactId || null,
      isCanonicalPrimary: fact.isCanonicalPrimary !== false,
      factQuality: fact.factQuality || null,
      planningEligible: fact.planningEligible !== false,
      unusedReason: null,
      reuseCount: 0,
    };
  }

  const canonicalLedger = {};
  for (const [cid, members] of byCanonical) {
    const primary = members.find((m) => m.isCanonicalPrimary) || members[0];
    canonicalLedger[cid] = {
      canonicalFactId: cid,
      memberFactIds: members.map((m) => m.id),
      primaryFactId: primary?.id || null,
      status: 'unused',
      priorityTier:
        primary?.planningPriorityTier === 'supporting'
          ? 'high'
          : primary?.planningPriorityTier || 'medium',
      assignedStoryIds: [],
      assignedSectionIds: [],
    };
  }

  return {
    operationId,
    packageFingerprint,
    ledgerVersion: NEWS_WRITER_PLANNER_VERSION,
    facts: ledgerFacts,
    canonical: canonicalLedger,
  };
}

function syncCanonicalFromFact(ledger, factId, storyId, sectionId) {
  const entry = ledger.facts[factId];
  if (!entry?.canonicalFactId) return;
  const c = ledger.canonical[entry.canonicalFactId];
  if (!c) return;
  if (storyId && !c.assignedStoryIds.includes(storyId)) c.assignedStoryIds.push(storyId);
  if (sectionId && !c.assignedSectionIds.includes(sectionId)) c.assignedSectionIds.push(sectionId);
  if (c.status === 'unused') c.status = 'planned';
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
      syncCanonicalFromFact(ledger, factId, story.storyId, null);
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
        if (entry.assignedSectionIds.length > 1) entry.reuseCount = entry.assignedSectionIds.length - 1;
      }
      if (entry.status === 'unused' || entry.status === 'planned') {
        entry.status = 'planned';
      }
      entry.firstUsedAtStage = entry.firstUsedAtStage || 'outline';
      syncCanonicalFromFact(ledger, factId, null, section.sectionId);
    }
  }
  return ledger;
}

function isPlanned(entry) {
  return ['planned', 'writing', 'used'].includes(entry.status);
}

export function getLedgerCoverageSummary(ledger) {
  const entries = Object.values(ledger.facts || {});
  const usedOrPlanned = entries.filter((e) => isPlanned(e));
  const highPlus = entries.filter(
    (e) => e.priorityTier === 'critical' || e.priorityTier === 'high'
  );
  const highUsed = highPlus.filter((e) => isPlanned(e));
  const canonicalEntries = Object.values(ledger.canonical || {});
  const canonicalPlanned = canonicalEntries.filter((c) => c.status === 'planned');
  const criticalCanonical = canonicalEntries.filter((c) => c.priorityTier === 'critical');
  const highCanonical = canonicalEntries.filter((c) => c.priorityTier === 'critical' || c.priorityTier === 'high');
  const criticalCanonicalPlanned = criticalCanonical.filter((c) => c.status === 'planned');
  const highCanonicalPlanned = highCanonical.filter((c) => c.status === 'planned');

  const supporting = entries.filter((e) => e.priorityTier === 'supporting');
  const lowQualityExcluded = entries.filter(
    (e) => e.factQuality && (e.factQuality.qualityScore < 32 || e.factQuality.hasOfficialEquivalent)
  );

  return {
    totalFacts: entries.length,
    plannedOrUsed: usedOrPlanned.length,
    coveragePercent:
      entries.length === 0 ? 0 : Math.round((usedOrPlanned.length / entries.length) * 1000) / 10,
    highPriorityTotal: highPlus.length,
    highPriorityPlanned: highUsed.length,
    highPriorityCoveragePercent:
      highPlus.length === 0 ? 100 : Math.round((highUsed.length / highPlus.length) * 1000) / 10,
    canonical: {
      totalEvents: canonicalEntries.length,
      plannedEvents: canonicalPlanned.length,
      coveragePercent:
        canonicalEntries.length === 0
          ? 100
          : Math.round((canonicalPlanned.length / canonicalEntries.length) * 1000) / 10,
      criticalTotal: criticalCanonical.length,
      criticalPlanned: criticalCanonicalPlanned.length,
      criticalCoveragePercent:
        criticalCanonical.length === 0
          ? 100
          : Math.round((criticalCanonicalPlanned.length / criticalCanonical.length) * 1000) / 10,
      highPriorityTotal: highCanonical.length,
      highPriorityPlanned: highCanonicalPlanned.length,
      highPriorityCoveragePercent:
        highCanonical.length === 0
          ? 100
          : Math.round((highCanonicalPlanned.length / highCanonical.length) * 1000) / 10,
    },
    supportingFactCount: supporting.length,
    lowQualityOrDuplicateExcluded: lowQualityExcluded.length,
  };
}

function classifyUnusedReason(entry, ledger) {
  const q = entry.factQuality;
  if (q?.hasOfficialEquivalent) return 'duplicate_of_canonical';
  if (q?.qualityScore < 32 || q?.hasMalformedTimestampPrefix || q?.isSpeculation) {
    return 'low_quality_transcript';
  }
  if (entry.confidence === 'conflicting') return 'conflicting_unverified';
  if (!entry.planningEligible) return 'not_relevant_or_unresolved';
  if (entry.canonicalFactId) {
    const canon = ledger.canonical[entry.canonicalFactId];
    if (canon?.status === 'planned' && !entry.isCanonicalPrimary) return 'duplicate_of_canonical';
  }
  if (entry.priorityTier === 'critical' || entry.priorityTier === 'high') return 'genuine_omission';
  return 'article_depth_omission';
}

export function annotateUnusedReasons(ledger) {
  for (const entry of Object.values(ledger.facts || {})) {
    if (entry.status !== 'unused') continue;
    entry.unusedReason = classifyUnusedReason(entry, ledger);
  }
  return ledger;
}

export function getUnusedCriticalFacts(ledger, limit = 20) {
  annotateUnusedReasons(ledger);
  return Object.values(ledger.facts || {})
    .filter((e) => e.priorityTier === 'critical' && e.status === 'unused' && e.unusedReason === 'genuine_omission')
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, limit)
    .map((e) => ({
      factId: e.factId,
      summaryShort: e.summaryShort,
      importanceScore: e.importanceScore,
      unusedReason: e.unusedReason,
    }));
}

export function getUnusedFactDiagnostics(ledger) {
  annotateUnusedReasons(ledger);
  const groups = {
    genuine_omission: [],
    duplicate_of_canonical: [],
    low_quality_transcript: [],
    conflicting_unverified: [],
    not_relevant_or_unresolved: [],
    article_depth_omission: [],
  };
  for (const entry of Object.values(ledger.facts || {})) {
    if (entry.status !== 'unused') continue;
    const reason = entry.unusedReason || 'article_depth_omission';
    if (!groups[reason]) groups[reason] = [];
    groups[reason].push({
      factId: entry.factId,
      summaryShort: entry.summaryShort,
      priorityTier: entry.priorityTier,
    });
  }
  for (const key of Object.keys(groups)) {
    groups[key] = groups[key].slice(0, 30);
  }
  return groups;
}

export function getExcludedPlanningFacts(ledger, limit = 40) {
  return Object.values(ledger.facts || {})
    .filter(
      (e) =>
        e.unusedReason === 'low_quality_transcript' ||
        (e.factQuality && e.factQuality.qualityScore < 32) ||
        e.priorityTier === 'supporting'
    )
    .slice(0, limit)
    .map((e) => ({
      factId: e.factId,
      summaryShort: e.summaryShort,
      reason: e.unusedReason || 'low_quality_transcript',
      qualityScore: e.factQuality?.qualityScore,
    }));
}
