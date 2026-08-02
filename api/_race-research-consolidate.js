import { mergeFactConfidence, consolidateRaceFactsInMemory } from './_race-research-processors.js';
import {
  insertRaceFact,
  insertRaceFactSources,
  listRaceFactsForRace,
  listFactSourceJoinsForRace,
} from './_race-research-repository.js';

function normalizeSummary(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenOverlap(a, b) {
  const ta = new Set(normalizeSummary(a).split(' ').filter((w) => w.length > 3));
  const tb = new Set(normalizeSummary(b).split(' ').filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

function sameDrivers(a, b) {
  const da = new Set((a.driverIds || []).map(String));
  const db = new Set((b.driverIds || []).map(String));
  if (!da.size && !db.size) {
    const na = new Set((a.driverNames || []).map((n) => normalizeSummary(n)));
    const nb = new Set((b.driverNames || []).map((n) => normalizeSummary(n)));
    for (const n of na) if (nb.has(n)) return true;
    return false;
  }
  for (const id of da) if (db.has(id)) return true;
  return false;
}

function mergeScore(a, b, linkMeta = {}) {
  if (a.factType !== b.factType) return 0;
  if (a.category && b.category && a.category !== b.category) {
    if (!['broadcast', 'broadcast_quote'].includes(a.category)) return 0;
  }

  const summarySim = tokenOverlap(a.summary, b.summary);
  if (summarySim < 0.45) return 0;

  const lapA = a.lapNumber ?? null;
  const lapB = b.lapNumber ?? null;
  if (lapA != null && lapB != null && lapA !== lapB) return 0;

  if (!sameDrivers(a, b) && summarySim < 0.75) return 0;

  let score = summarySim;
  if (linkMeta.adjacentChunks) score += 0.15;
  if (lapA != null && lapB != null && lapA === lapB) score += 0.2;
  return score;
}

/**
 * Cross-chunk consolidation on loaded facts (diagnostics / post-process).
 * DB merge of duplicate facts is conservative — marks related groups in structured_data.
 */
export function consolidateRaceFactsAdvanced(facts = [], options = {}) {
  const working = facts.map((f) => ({ ...f, evidenceLinks: f.evidenceLinks || [] }));
  const mergedGroups = [];
  const used = new Set();
  let mergeCount = 0;

  for (let i = 0; i < working.length; i += 1) {
    if (used.has(i)) continue;
    const group = [working[i]];
    used.add(i);

    for (let j = i + 1; j < working.length; j += 1) {
      if (used.has(j)) continue;
      const score = mergeScore(working[i], working[j], options.linkMeta || {});
      if (score >= 0.62) {
        group.push(working[j]);
        used.add(j);
      }
    }

    if (group.length === 1) continue;

    group.sort((a, b) => rankConfidence(b.confidence) - rankConfidence(a.confidence));
    const canonical = { ...group[0] };
    for (let k = 1; k < group.length; k += 1) {
      const other = group[k];
      canonical.confidence = mergeFactConfidence(canonical.confidence, other.confidence);
      canonical.importanceScore = Math.max(canonical.importanceScore || 0, other.importanceScore || 0);
      canonical.structuredData = {
        ...(canonical.structuredData || {}),
        mergedFrom: [...(canonical.structuredData?.mergedFrom || []), other.id].filter(Boolean),
        mergeDiagnostics: [
          ...(canonical.structuredData?.mergeDiagnostics || []),
          { factId: other.id, summary: other.summary?.slice(0, 120) },
        ],
      };
      mergeCount += 1;
    }
    mergedGroups.push({ canonical, mergedIds: group.map((g) => g.id) });
  }

  const inMemory = consolidateRaceFactsInMemory(
    working.filter((_, idx) => !mergedGroups.some((g) => g.mergedIds.includes(working[idx]?.id)))
  );

  return {
    facts: inMemory.facts,
    conflictsDetected: inMemory.conflictsDetected,
    mergeGroups: mergedGroups.length,
    mergeCount,
  };
}

function rankConfidence(confidence) {
  const order = { official: 5, officially_confirmed: 4, manual: 4, derived: 3, broadcast_reported: 2, historical: 2, unverified: 1, conflicting: 0 };
  return order[confidence] ?? 0;
}

export async function consolidateRaceFacts({ seasonId, raceNumber }) {
  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const chunkPairs = new Set();
  for (const link of links) {
    if (link.chunk_id) chunkPairs.add(String(link.chunk_id));
  }

  const withLinks = facts.map((fact) => ({
    ...fact,
    evidenceLinks: links
      .filter((l) => l.fact_id === fact.id)
      .map((l) => ({
        sourceId: l.source_id,
        chunkId: l.chunk_id,
        supportType: l.support_type,
        sourceExcerpt: l.source_excerpt,
      })),
  }));

  return consolidateRaceFactsAdvanced(withLinks, {
    linkMeta: { adjacentChunks: chunkPairs.size > 1 },
  });
}

export function detectTimelineIssues(facts = [], sourceById = {}) {
  const events = facts.filter((f) =>
    ['race_event', 'lead_change', 'caution', 'incident', 'penalty', 'strategy'].includes(f.factType)
  );

  const duplicates = [];
  const boundaryDupes = [];
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      if (mergeScore(events[i], events[j]) >= 0.7) {
        duplicates.push([events[i].id, events[j].id]);
        if (events[i].structuredData?.extractionMethod && events[j].structuredData?.extractionMethod) {
          boundaryDupes.push([events[i].id, events[j].id]);
        }
      }
    }
  }

  const withoutSequence = events.filter((e) => e.sequenceOrder == null && e.lapNumber == null);
  const contradictions = facts.filter((f) => f.confidence === 'conflicting');

  const rcSupported = events.filter((e) =>
    (e.evidenceLinks || []).some((l) => sourceById[l.sourceId]?.sourceType === 'race_control')
  );
  const broadcastOnly = events.filter(
    (e) =>
      !(e.evidenceLinks || []).some((l) => sourceById[l.sourceId]?.sourceType === 'race_control') &&
      (e.structuredData?.broadcast || e.confidence === 'broadcast_reported')
  );

  return {
    withoutSequenceCount: withoutSequence.length,
    duplicatePairs: duplicates.slice(0, 50),
    chunkBoundaryDuplicates: boundaryDupes.length,
    contradictions: contradictions.map((c) => c.id),
    raceControlSupportedCount: rcSupported.length,
    broadcastOnlyCount: broadcastOnly.length,
  };
}
