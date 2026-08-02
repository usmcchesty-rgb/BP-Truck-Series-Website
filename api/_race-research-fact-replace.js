import { consolidateRaceFactsInMemory } from './_race-research-processors.js';
import { swapSourceFactsAtomicRpc } from './_race-research-atomic-swap.js';
import { getFactIdsLinkedToSource, insertRaceFact, assertResearchDb } from './_race-research-repository.js';

export function validateProposedFacts(proposedFacts, sourceId) {
  const errors = [];
  if (!Array.isArray(proposedFacts)) {
    return { valid: false, errors: ['proposedFacts must be an array.'] };
  }

  for (let i = 0; i < proposedFacts.length; i += 1) {
    const fact = proposedFacts[i];
    if (!String(fact.summary || '').trim()) {
      errors.push(`Fact ${i} missing summary.`);
    }
    if (!fact.factType) {
      errors.push(`Fact ${i} missing factType.`);
    }
    const links = fact.evidenceLinks || [];
    if (!links.length) {
      errors.push(`Fact ${i} missing evidence links.`);
    }
    for (const link of links) {
      if (link.sourceId && sourceId && String(link.sourceId) !== String(sourceId)) {
        errors.push(`Fact ${i} evidence sourceId must match processing source.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Atomic replacement via RPC when available; staged swap only as explicit fallback.
 */
export async function swapFactsForSource(sourceId, proposedFacts) {
  const { facts: merged, conflictsDetected } = consolidateRaceFactsInMemory(proposedFacts || []);
  const validation = validateProposedFacts(
    merged.map((f) => ({ ...f, evidenceLinks: f.evidenceLinks || [] })),
    sourceId
  );
  if (merged.length && !validation.valid) {
    throw Object.assign(new Error(validation.errors.join(' ')), { code: 'FACT_VALIDATION_FAILED' });
  }

  try {
    const rpcResult = await swapSourceFactsAtomicRpc(sourceId, merged);
    return {
      factsCreated: rpcResult.factsCreated,
      conflictsDetected,
      newFactIds: rpcResult.newFactIds || [],
      replacedFactCount: rpcResult.replacedFactCount ?? 0,
      atomic: true,
    };
  } catch (error) {
    if (error.code !== 'RPC_UNAVAILABLE' && error.code !== 'PGRST202') {
      throw error;
    }
  }

  return swapFactsForSourceStaged(sourceId, merged, conflictsDetected);
}

async function swapFactsForSourceStaged(sourceId, merged, conflictsDetected) {
  const oldFactIds = await getFactIdsLinkedToSource(sourceId);
  const newFactIds = [];

  for (const fact of merged) {
    const saved = await insertRaceFact(fact, fact.evidenceLinks);
    newFactIds.push(saved.id);
  }

  const sb = assertResearchDb();

  if (oldFactIds.length) {
    const { error: delLinkErr } = await sb
      .from('race_fact_sources')
      .delete()
      .eq('source_id', sourceId)
      .in('fact_id', oldFactIds);
    if (delLinkErr) throw new Error(delLinkErr.message);
  }

  for (const oldId of oldFactIds) {
    if (newFactIds.includes(oldId)) continue;
    const { count, error: countErr } = await sb
      .from('race_fact_sources')
      .select('*', { count: 'exact', head: true })
      .eq('fact_id', oldId);
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) === 0) {
      const { error: delFactErr } = await sb.from('race_facts').delete().eq('id', oldId);
      if (delFactErr) throw new Error(delFactErr.message);
    }
  }

  return {
    factsCreated: newFactIds.length,
    conflictsDetected,
    newFactIds,
    replacedFactCount: oldFactIds.length,
    atomic: false,
  };
}

export { deleteFactsForSource } from './_race-research-repository.js';
