import { mergeScore } from './_race-research-consolidate-scoring.js';
import {
  combinedConfidenceFromEvidence,
  evolveConfidence,
} from './_race-research-confidence.js';
import {
  assertResearchDb,
  listFactSourceJoinsForRace,
  listResearchSourcesForRace,
} from './_race-research-repository.js';

function canonicalCodeForRace(raceNumber, sequence) {
  return `FACT-R${Number(raceNumber)}-${String(sequence).padStart(5, '0')}`;
}

function clusterFacts(facts, linkMeta) {
  const used = new Set();
  const clusters = [];

  for (let i = 0; i < facts.length; i += 1) {
    if (used.has(i)) continue;
    const group = [facts[i]];
    used.add(i);
    for (let j = i + 1; j < facts.length; j += 1) {
      if (used.has(j)) continue;
      if (mergeScore(facts[i], facts[j], linkMeta) >= 0.62) {
        group.push(facts[j]);
        used.add(j);
      }
    }
    clusters.push(group);
  }
  return clusters;
}

function pickCanonicalSummary(group, sourceById, linksByFact) {
  const ranked = [...group].sort((a, b) => {
    const sa = (linksByFact[a.id] || []).map((l) => sourceById[l.source_id]?.sourceType);
    const sb = (linksByFact[b.id] || []).map((l) => sourceById[l.source_id]?.sourceType);
    const ca = combinedConfidenceFromEvidence(sa);
    const cb = combinedConfidenceFromEvidence(sb);
    const order = { official: 5, officially_confirmed: 4, manual: 3, broadcast_reported: 2, unverified: 1 };
    return (order[cb] ?? 0) - (order[ca] ?? 0);
  });
  return ranked[0];
}

function detectConflict(group) {
  if (group.length < 2) return false;
  const summaries = new Set(group.map((g) => String(g.summary || '').trim().toLowerCase()));
  return summaries.size > 1 && group.every((g) => g.confidence !== 'conflicting');
}

/**
 * Persist cross-source canonical facts for a race (deterministic, post-processing).
 */
export async function persistCanonicalConsolidation(seasonId, raceNumber) {
  const sb = assertResearchDb();
  const tables = await sb.from('race_canonical_facts').select('id', { head: true, count: 'exact' }).limit(1);
  if (tables.error && String(tables.error.message).includes('does not exist')) {
    return { skipped: true, reason: 'canonical_tables_missing' };
  }

  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const sourceTypeById = Object.fromEntries(sources.map((s) => [s.id, s.sourceType]));

  const linksByFact = {};
  for (const link of links) {
    if (!linksByFact[link.fact_id]) linksByFact[link.fact_id] = [];
    linksByFact[link.fact_id].push(link);
  }

  const withLinks = facts.map((f) => ({
    ...f,
    evidenceLinks: (linksByFact[f.id] || []).map((l) => ({
      sourceId: l.source_id,
      chunkId: l.chunk_id,
      supportType: l.support_type,
      sourceExcerpt: l.source_excerpt,
    })),
  }));

  const clusters = clusterFacts(withLinks, { adjacentChunks: links.length > 1 });
  const { data: existingCanonical } = await sb
    .from('race_canonical_facts')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber));

  const existingById = Object.fromEntries((existingCanonical || []).map((r) => [r.id, r]));
  let seq =
    (existingCanonical || []).reduce((max, row) => {
      const m = String(row.canonical_code || '').match(/FACT-R\d+-(\d+)/);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0) + 1;

  let mergedEvidence = 0;
  let conflicts = 0;
  let duplicateCandidates = 0;

  for (const group of clusters) {
    if (group.length > 1) duplicateCandidates += 1;
    const anchor = pickCanonicalSummary(group, sourceById, linksByFact);
    const conflicting = detectConflict(group);
    if (conflicting) conflicts += 1;

    const sourceTypes = [];
    for (const member of group) {
      for (const l of linksByFact[member.id] || []) {
        sourceTypes.push(sourceTypeById[l.source_id] || sourceById[l.source_id]?.sourceType);
      }
    }
    const targetConfidence = conflicting
      ? 'conflicting'
      : combinedConfidenceFromEvidence(sourceTypes.filter(Boolean));

    let canonicalRow = group.map((g) => g.canonicalFactId).find(Boolean);
    let existing = canonicalRow ? existingById[canonicalRow] : null;

    if (!existing) {
      const priorIds = group.map((g) => g.canonicalFactId).filter(Boolean);
      if (priorIds.length) {
        existing = existingById[priorIds[0]];
      }
    }

    const canonicalCode =
      existing?.canonical_code || canonicalCodeForRace(raceNumber, seq++);

    const history = existing?.confidence_history ? [...existing.confidence_history] : [];
    if (existing && existing.current_confidence !== targetConfidence) {
      const evo = evolveConfidence(existing.current_confidence, targetConfidence, {
        reason: 'consolidation',
        sourceType: sourceTypes.join(','),
      });
      if (evo.historyEntry) history.push(evo.historyEntry);
    }

    if (existing && (existing.summary !== anchor.summary || existing.current_confidence !== targetConfidence)) {
      const priorEvidenceCount = group.reduce(
        (n, m) => n + (linksByFact[m.id] || []).length,
        0
      );
      await sb.from('race_canonical_fact_history').insert({
        canonical_fact_id: existing.id,
        previous_summary: existing.summary,
        previous_confidence: existing.current_confidence,
        previous_evidence_count: priorEvidenceCount,
        change_reason: 'consolidation_update',
      });
    }

    const row = {
      season_id: String(seasonId),
      race_number: Number(raceNumber),
      canonical_code: canonicalCode,
      fact_type: anchor.factType,
      category: anchor.category || '',
      summary: anchor.summary,
      driver_ids: anchor.driverIds || [],
      driver_names: anchor.driverNames || [],
      lap_number: anchor.lapNumber ?? null,
      sequence_order: anchor.sequenceOrder ?? null,
      importance_score: Math.max(...group.map((g) => Number(g.importanceScore) || 0)),
      current_confidence: targetConfidence,
      confidence_history: history,
      structured_data: {
        ...(anchor.structuredData || {}),
        memberFactIds: group.map((g) => g.id),
      },
      is_conflicting: conflicting,
      conflict_payload: conflicting
        ? { summaries: group.map((g) => g.summary).slice(0, 6) }
        : null,
      updated_at: new Date().toISOString(),
    };

    const { data: upserted, error: upErr } = await sb
      .from('race_canonical_facts')
      .upsert(existing ? { ...row, id: existing.id } : row, {
        onConflict: 'season_id,race_number,canonical_code',
      })
      .select('*')
      .single();
    if (upErr) throw new Error(upErr.message);

    const canonicalId = upserted.id;

    for (const member of group) {
      await sb.from('race_facts').update({ canonical_fact_id: canonicalId }).eq('id', member.id);

      for (const link of linksByFact[member.id] || []) {
        const st = sourceTypeById[link.source_id] || sourceById[link.source_id]?.sourceType;
        const { error: evErr } = await sb.from('race_canonical_fact_evidence').upsert(
          {
            canonical_fact_id: canonicalId,
            source_id: link.source_id,
            extracted_fact_id: member.id,
            chunk_id: link.chunk_id,
            source_type: st,
            source_excerpt: link.source_excerpt,
            support_type: link.support_type || 'primary',
          },
          { onConflict: 'canonical_fact_id,source_id,extracted_fact_id' }
        );
        if (evErr && !String(evErr.message).includes('duplicate')) {
          throw new Error(evErr.message);
        }
        mergedEvidence += 1;
      }
    }
  }

  return {
    skipped: false,
    canonicalCount: clusters.length,
    mergedEvidenceLinks: mergedEvidence,
    conflicts,
    duplicateCandidates,
  };
}

export async function getCanonicalDiagnostics(seasonId, raceNumber) {
  const sb = assertResearchDb();
  const { data: canonical, error } = await sb
    .from('race_canonical_facts')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber));
  if (error) {
    if (String(error.message).includes('does not exist')) return { available: false };
    throw new Error(error.message);
  }

  const { data: evidence } = await sb
    .from('race_canonical_fact_evidence')
    .select('canonical_fact_id, source_type, source_id, support_type')
    .in(
      'canonical_fact_id',
      (canonical || []).map((c) => c.id)
    );

  const evByCanonical = {};
  const evRowsByCanonical = {};
  for (const e of evidence || []) {
    if (!evByCanonical[e.canonical_fact_id]) evByCanonical[e.canonical_fact_id] = [];
    evByCanonical[e.canonical_fact_id].push(e.source_type);
    if (!evRowsByCanonical[e.canonical_fact_id]) evRowsByCanonical[e.canonical_fact_id] = [];
    evRowsByCanonical[e.canonical_fact_id].push({
      sourceType: e.source_type,
      sourceIdShort: String(e.source_id || '').slice(0, 8),
      supportType: e.support_type,
    });
  }

  let broadcastConfirmedByOfficial = 0;
  let officialOnly = 0;
  let broadcastOnly = 0;
  let conflicting = 0;

  for (const c of canonical || []) {
    const types = [...new Set(evByCanonical[c.id] || [])];
    const hasOfficial = types.some((t) => ['official_results', 'race_control', 'qualifying'].includes(t));
    const hasBroadcast = types.some((t) => ['youtube_transcript', 'saved_transcript'].includes(t));
    if (c.is_conflicting) conflicting += 1;
    else if (hasOfficial && hasBroadcast) broadcastConfirmedByOfficial += 1;
    else if (hasOfficial) officialOnly += 1;
    else if (hasBroadcast) broadcastOnly += 1;
  }

  let duplicateCandidates = 0;
  for (const c of canonical || []) {
    const memberIds = c.structured_data?.memberFactIds;
    if (Array.isArray(memberIds) && memberIds.length > 1) duplicateCandidates += 1;
  }

  return {
    available: true,
    canonicalFacts: (canonical || []).length,
    mergedEvidenceLinks: (evidence || []).length,
    broadcastConfirmedByOfficial,
    officialOnly,
    broadcastOnly,
    conflicting,
    duplicateCandidates,
    facts: (canonical || []).map((c) => ({
      id: c.id,
      canonicalCode: c.canonical_code,
      summary: c.summary,
      currentConfidence: c.current_confidence,
      isConflicting: c.is_conflicting,
      evidenceSourceTypes: [...new Set(evByCanonical[c.id] || [])],
      evidence: evRowsByCanonical[c.id] || [],
    })),
  };
}
