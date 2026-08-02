import { RACE_RESEARCH_EXTRACTION_VERSION } from '../server/config/race-research-config.js';
import {
  assertResearchDb,
  getResearchSourceById,
  listResearchChunksForSource,
  upsertResearchSource,
} from './_race-research-repository.js';
import { getFactIdsLinkedToSource } from './_race-research-repository.js';
import { processResearchSource } from './_race-research-process.js';

/**
 * Archive prior content when hash changes (no duplicate rows for same hash).
 */
export async function archiveSourceVersionBeforeUpdate(sourceId, previousSource) {
  const sb = assertResearchDb();
  const { error: probe } = await sb.from('race_research_source_versions').select('id').limit(1);
  if (probe && String(probe.message || '').includes('does not exist')) {
    return { skipped: true };
  }

  if (!previousSource?.rawText && !previousSource?.contentHash) return { skipped: true };

  const { data: dup } = await sb
    .from('race_research_source_versions')
    .select('id')
    .eq('source_id', sourceId)
    .eq('content_hash', previousSource.contentHash)
    .maybeSingle();
  if (dup) return { skipped: true, reason: 'hash_exists' };

  const { count } = await sb
    .from('race_research_source_versions')
    .select('*', { count: 'exact', head: true })
    .eq('source_id', sourceId);

  const versionNumber = (count ?? 0) + 1;
  let chunkCount = 0;
  try {
    chunkCount = (await listResearchChunksForSource(sourceId)).length;
  } catch {
    chunkCount = 0;
  }
  const factCount = (await getFactIdsLinkedToSource(sourceId)).length;

  await sb.from('race_research_source_versions').update({ is_active: false }).eq('source_id', sourceId);

  await sb.from('race_research_source_versions').insert({
    source_id: sourceId,
    version_number: versionNumber,
    content_hash: previousSource.contentHash,
    raw_text: previousSource.rawText,
    source_metadata: previousSource.sourceMetadata || {},
    processing_version: RACE_RESEARCH_EXTRACTION_VERSION,
    is_active: false,
    fact_count_at_version: factCount,
    chunk_count_at_version: chunkCount,
  });

  return { versionNumber, archived: true };
}

export async function markActiveSourceVersion(sourceId, contentHash) {
  const sb = assertResearchDb();
  const { error: probe } = await sb.from('race_research_source_versions').select('id').limit(1);
  if (probe && String(probe.message || '').includes('does not exist')) return;

  const { count } = await sb
    .from('race_research_source_versions')
    .select('*', { count: 'exact', head: true })
    .eq('source_id', sourceId)
    .eq('content_hash', contentHash);

  if ((count ?? 0) > 0) {
    await sb.from('race_research_source_versions').update({ is_active: false }).eq('source_id', sourceId);
    await sb
      .from('race_research_source_versions')
      .update({ is_active: true })
      .eq('source_id', sourceId)
      .eq('content_hash', contentHash);
    return;
  }

  const { count: total } = await sb
    .from('race_research_source_versions')
    .select('*', { count: 'exact', head: true })
    .eq('source_id', sourceId);

  const source = await getResearchSourceById(sourceId);
  if (!source) return;

  await sb.from('race_research_source_versions').update({ is_active: false }).eq('source_id', sourceId);
  await sb.from('race_research_source_versions').insert({
    source_id: sourceId,
    version_number: (total ?? 0) + 1,
    content_hash: contentHash,
    raw_text: source.rawText,
    source_metadata: source.sourceMetadata || {},
    processing_version: RACE_RESEARCH_EXTRACTION_VERSION,
    is_active: true,
  });
}

export async function listSourceVersions(sourceId) {
  const sb = assertResearchDb();
  const { data, error } = await sb
    .from('race_research_source_versions')
    .select('id, version_number, content_hash, is_active, created_at, fact_count_at_version, chunk_count_at_version, processing_version')
    .eq('source_id', sourceId)
    .order('version_number', { ascending: false });
  if (error) {
    if (String(error.message).includes('does not exist')) return [];
    throw new Error(error.message);
  }
  return (data || []).map((row) => ({
    id: row.id,
    versionNumber: row.version_number,
    contentHashShort: String(row.content_hash || '').slice(0, 12),
    isActive: row.is_active,
    createdAt: row.created_at,
    factCount: row.fact_count_at_version,
    chunkCount: row.chunk_count_at_version,
    processingVersion: row.processing_version,
  }));
}

export async function rollbackSourceToVersion(sourceId, versionId, context = {}) {
  const sb = assertResearchDb();
  const { data: version, error } = await sb
    .from('race_research_source_versions')
    .select('*')
    .eq('id', versionId)
    .eq('source_id', sourceId)
    .single();
  if (error) throw new Error(error.message);

  const current = await getResearchSourceById(sourceId);
  if (current && current.contentHash !== version.content_hash) {
    await archiveSourceVersionBeforeUpdate(sourceId, current);
  }

  const restored = await upsertResearchSource({
    seasonId: current.seasonId,
    raceNumber: current.raceNumber,
    sourceType: current.sourceType,
    sourceKey: current.sourceKey,
    title: current.title,
    rawText: version.raw_text,
    contentHash: version.content_hash,
    characterCount: version.raw_text?.length ?? null,
    processingStatus: 'pending',
    sourceMetadata: {
      ...(version.source_metadata || {}),
      rolledBackFromVersion: version.version_number,
    },
  });

  await sb.from('race_research_source_versions').update({ is_active: false }).eq('source_id', sourceId);
  await sb
    .from('race_research_source_versions')
    .update({ is_active: true })
    .eq('id', versionId);

  const processResult = await processResearchSource(restored, {
    ...context,
    seasonId: current.seasonId,
    raceNumber: current.raceNumber,
    forceRechunk: true,
    forceLargeSource: true,
  });

  return { restoredSourceId: restored.id, processResult };
}
