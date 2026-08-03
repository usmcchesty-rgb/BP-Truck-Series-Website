import { CANONICAL_COVERAGE_TARGETS } from './_news-writer-config.js';

const SECTION_FOR_FACT = {
  winner: ['battle_for_win', 'race_summary', 'introduction'],
  caution: ['key_incidents', 'race_summary'],
  milestone: ['battle_for_win', 'driver_stories', 'race_summary'],
  championship: ['championship_picture', 'race_summary'],
  strategy: ['strategy'],
  incident: ['key_incidents'],
  result: ['driver_stories', 'race_summary'],
  default: ['race_summary'],
};

function sectionPreference(fact) {
  if (fact.category === 'winner' || fact.structuredData?.finishPosition === 1) return SECTION_FOR_FACT.winner;
  if (fact.structuredData?.cautionCount != null || /\bcautions?\b/i.test(fact.summary || '')) {
    return SECTION_FOR_FACT.caution;
  }
  if (/third win|3rd win|season win/i.test(fact.summary || '')) return SECTION_FOR_FACT.milestone;
  if (fact.factType === 'championship') return SECTION_FOR_FACT.championship;
  if (fact.factType === 'strategy') return SECTION_FOR_FACT.strategy;
  if (['incident', 'penalty', 'caution'].includes(fact.factType)) return SECTION_FOR_FACT.incident;
  if (fact.factType === 'result') return SECTION_FOR_FACT.result;
  return SECTION_FOR_FACT.default;
}

function addFactToSection(outline, sectionId, factId, { allowReuse = false } = {}) {
  const section = outline.sections.find((s) => s.sectionId === sectionId);
  if (!section) return false;
  const ids = section.evidence.factIds || [];
  if (ids.includes(factId)) return true;
  if (!allowReuse && ids.length > 0 && sectionId !== 'introduction' && sectionId !== 'race_summary') {
    // primary section assignment — still allow if empty
  }
  section.evidence.factIds = [...ids, factId];
  return true;
}

export function injectRequiredFactsIntoOutline(outline, requiredRecap) {
  const winnerId = requiredRecap.winnerFact?.id;
  if (winnerId) {
    addFactToSection(outline, 'introduction', winnerId, { allowReuse: true });
    addFactToSection(outline, 'race_summary', winnerId, { allowReuse: true });
    addFactToSection(outline, 'battle_for_win', winnerId);
    addFactToSection(outline, 'driver_stories', winnerId, { allowReuse: true });
  }
  if (requiredRecap.cautionFact?.id) {
    addFactToSection(outline, 'key_incidents', requiredRecap.cautionFact.id);
    addFactToSection(outline, 'race_summary', requiredRecap.cautionFact.id, { allowReuse: true });
  }
  if (requiredRecap.milestoneFact?.id) {
    addFactToSection(outline, 'battle_for_win', requiredRecap.milestoneFact.id);
    addFactToSection(outline, 'driver_stories', requiredRecap.milestoneFact.id);
  }
  if (requiredRecap.championshipFact?.id) {
    addFactToSection(outline, 'championship_picture', requiredRecap.championshipFact.id);
  }
  return outline;
}

export function boostCanonicalCoverage(outline, ledger, preparedFacts, articleDepth) {
  const targets = CANONICAL_COVERAGE_TARGETS[articleDepth] || CANONICAL_COVERAGE_TARGETS.medium;
  const canonEntries = Object.values(ledger.canonical || {});

  const unplannedCritical = canonEntries.filter((c) => c.status !== 'planned' && c.priorityTier === 'critical');
  const unplannedHigh = canonEntries.filter(
    (c) => c.status !== 'planned' && (c.priorityTier === 'critical' || c.priorityTier === 'high')
  );

  function planCanonical(canonicalRow) {
    const primaryId = canonicalRow.primaryFactId;
    const fact = preparedFacts.find((f) => f.id === primaryId);
    if (!fact) return;
    const prefs = sectionPreference(fact);
    for (const sid of prefs) {
      if (addFactToSection(outline, sid, primaryId, { allowReuse: true })) break;
    }
  }

  for (const c of unplannedCritical) planCanonical(c);

  const summary = { criticalTarget: targets.critical, highTarget: targets.high, notes: [] };
  let criticalPct = summaryAfter(ledger).criticalCoveragePercent;
  if (criticalPct < targets.critical) {
    for (const c of unplannedHigh) planCanonical(c);
    summary.notes.push('Added high-priority canonical events to approach coverage targets.');
  }

  return { outline, coverageBoost: summary };
}

function summaryAfter(ledger) {
  const critical = Object.values(ledger.canonical || {}).filter((c) => c.priorityTier === 'critical');
  const planned = critical.filter((c) => c.status === 'planned');
  return {
    criticalCoveragePercent:
      critical.length === 0 ? 100 : Math.round((planned.length / critical.length) * 1000) / 10,
  };
}

export function assignOrphanFactsToOutline(outline, preparedFacts) {
  const used = new Set(outline.sections.flatMap((s) => s.evidence?.factIds || []));
  const orphans = preparedFacts
    .filter((f) => f.preferredForPlanning && !used.has(f.id))
    .sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));

  for (const fact of orphans.slice(0, 40)) {
    const prefs = sectionPreference(fact);
    for (const sid of prefs) {
      if (addFactToSection(outline, sid, fact.id)) break;
    }
  }
  return outline;
}

export function evaluateCoverageTargets(ledgerCoverage, articleDepth, requiredRecap) {
  const targets = CANONICAL_COVERAGE_TARGETS[articleDepth] || CANONICAL_COVERAGE_TARGETS.medium;
  const canon = ledgerCoverage.canonical || {};
  const requiredOk = (requiredRecap.missingRequired || []).length === 0;
  const criticalOk = (canon.criticalCoveragePercent ?? 0) >= targets.critical;
  const highOk = (canon.highPriorityCoveragePercent ?? 0) >= targets.high;
  const reasons = [];
  if (!requiredOk) reasons.push('Missing required recap facts.');
  if (!criticalOk) {
    reasons.push(
      `Critical canonical coverage ${canon.criticalCoveragePercent ?? 0}% below target ${targets.critical}%.`
    );
  }
  if (!highOk) {
    reasons.push(
      `High-priority canonical coverage ${canon.highPriorityCoveragePercent ?? 0}% below target ${targets.high}%.`
    );
  }
  return {
    requiredRecapPercent: requiredOk ? 100 : 0,
    targets,
    met: requiredOk && criticalOk && highOk,
    reasons,
  };
}
