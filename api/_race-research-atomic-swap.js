import { assertResearchDb } from './_race-research-repository.js';

function serializeFactForRpc(fact) {
  return {
    seasonId: String(fact.seasonId),
    raceNumber: Number(fact.raceNumber),
    raceId: fact.raceId != null ? String(fact.raceId) : null,
    factType: fact.factType,
    category: fact.category || '',
    summary: fact.summary,
    driverIds: fact.driverIds || [],
    driverNames: fact.driverNames || [],
    teamNames: fact.teamNames || [],
    lapNumber: fact.lapNumber ?? null,
    sequenceOrder: fact.sequenceOrder ?? null,
    importanceScore: fact.importanceScore ?? 0,
    confidence: fact.confidence || 'unverified',
    structuredData: fact.structuredData || {},
    evidenceLinks: (fact.evidenceLinks || []).map((link) => ({
      sourceId: link.sourceId,
      chunkId: link.chunkId || null,
      sourceStartCharacter: link.sourceStartCharacter ?? null,
      sourceEndCharacter: link.sourceEndCharacter ?? null,
      sourceStartTimestamp: link.sourceStartTimestamp ?? null,
      sourceEndTimestamp: link.sourceEndTimestamp ?? null,
      sourceExcerpt: link.sourceExcerpt || null,
      supportType: link.supportType || 'primary',
    })),
  };
}

export async function swapSourceFactsAtomicRpc(sourceId, facts = []) {
  const sb = assertResearchDb();
  const payload = facts.map(serializeFactForRpc);

  const { data, error } = await sb.rpc('swap_source_facts_atomic', {
    p_source_id: sourceId,
    p_facts: payload,
  });

  if (error) {
    const msg = String(error.message || '');
    if (msg.includes('Could not find the function') || error.code === 'PGRST202') {
      throw Object.assign(new Error('RPC swap_source_facts_atomic unavailable'), { code: 'RPC_UNAVAILABLE' });
    }
    throw error;
  }

  return {
    factsCreated: data?.factsCreated ?? data?.factscreated ?? 0,
    newFactIds: data?.newFactIds ?? data?.newfactids ?? [],
    replacedFactCount: data?.replacedFactCount ?? data?.replacedfactcount ?? 0,
  };
}
