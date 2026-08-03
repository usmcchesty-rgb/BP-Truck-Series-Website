import { rankFactImportance } from './_news-writer-ledger.js';

export function cloneLedger(ledger) {
  return JSON.parse(JSON.stringify(ledger));
}

export function applySectionDraftToLedger(ledger, sectionDraft) {
  const usedFactIds = sectionDraft.usedFactIds || [];
  const usedCanonicalIds = sectionDraft.usedCanonicalIds || [];
  const beforePlanned = countPlannedFacts(ledger);

  for (const factId of usedFactIds) {
    const entry = ledger.facts[factId];
    if (!entry) continue;
    entry.status = 'used';
    entry.citationCount = (entry.citationCount || 0) + 1;
    if (!entry.assignedSectionIds.includes(sectionDraft.sectionId)) {
      entry.assignedSectionIds.push(sectionDraft.sectionId);
    }
    entry.firstUsedAtStage = entry.firstUsedAtStage || 'section_writer';
  }

  for (const cid of usedCanonicalIds) {
    const row = ledger.canonical[cid];
    if (!row) continue;
    row.status = 'used';
    if (!row.assignedSectionIds.includes(sectionDraft.sectionId)) {
      row.assignedSectionIds.push(sectionDraft.sectionId);
    }
  }

  const afterPlanned = countPlannedFacts(ledger);
  return {
    ledger,
    coverageDelta: {
      plannedOrUsedDelta: afterPlanned - beforePlanned,
      usedFactIds,
      usedCanonicalIds,
    },
  };
}

function countPlannedFacts(ledger) {
  return Object.values(ledger.facts || {}).filter((e) =>
    ['planned', 'writing', 'used'].includes(e.status)
  ).length;
}

export function ledgerCoverageSnapshot(ledger) {
  const entries = Object.values(ledger.facts || {});
  const used = entries.filter((e) => e.status === 'used').length;
  const critical = entries.filter((e) => e.priorityTier === 'critical');
  const criticalUsed = critical.filter((e) => e.status === 'used').length;
  return {
    factsUsed: used,
    totalFacts: entries.length,
    criticalUsed,
    criticalTotal: critical.length,
    criticalCoveragePercent:
      critical.length === 0 ? 100 : Math.round((criticalUsed / critical.length) * 1000) / 10,
  };
}

export function filterUsedFactIdsToEvidence(sectionDraft, evidenceFactIds) {
  const allowed = new Set(evidenceFactIds || []);
  const usedFactIds = (sectionDraft.usedFactIds || []).filter((id) => allowed.has(id));
  const usedCanonicalIds = [...new Set(sectionDraft.usedCanonicalIds || [])];
  return { usedFactIds, usedCanonicalIds };
}

export function scoreFactIdsForRepair(factIds, ledger) {
  return (factIds || [])
    .map((id) => ledger.facts[id])
    .filter(Boolean)
    .sort((a, b) => rankFactImportance(b) - rankFactImportance(a))
    .map((e) => e.factId);
}
