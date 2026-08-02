import { supabase } from './_lib.js';
import { hashContent } from './_race-research-hash.js';

function nowIso() {
  return new Date().toISOString();
}

function mapSourceRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seasonId: row.season_id,
    raceNumber: row.race_number,
    raceId: row.race_id,
    sourceType: row.source_type,
    sourceKey: row.source_key,
    title: row.title,
    originalFilename: row.original_filename,
    sourceUrl: row.source_url,
    rawText: row.raw_text,
    storagePath: row.storage_path,
    contentHash: row.content_hash,
    characterCount: row.character_count,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    sourceMetadata: row.source_metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    processedAt: row.processed_at,
  };
}

function mapChunkRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    startCharacter: row.start_character,
    endCharacter: row.end_character,
    startTimestamp: row.start_timestamp,
    endTimestamp: row.end_timestamp,
    chunkText: row.chunk_text,
    contentHash: row.content_hash,
    sourceContentHash: row.source_content_hash,
    chunkingPolicyVersion: row.chunking_policy_version,
    processingStatus: row.processing_status,
    extractionVersion: row.extraction_version,
    extractionMethod: row.extraction_method,
    extractionCache: row.extraction_cache,
    processingError: row.processing_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFactRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seasonId: row.season_id,
    raceNumber: row.race_number,
    raceId: row.race_id,
    factType: row.fact_type,
    category: row.category,
    summary: row.summary,
    driverIds: row.driver_ids || [],
    driverNames: row.driver_names || [],
    teamNames: row.team_names || [],
    lapNumber: row.lap_number,
    sequenceOrder: row.sequence_order,
    importanceScore: Number(row.importance_score) || 0,
    confidence: row.confidence,
    structuredData: row.structured_data || {},
    canonicalFactId: row.canonical_fact_id || null,
    firstSeenAt: row.first_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPackageRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seasonId: row.season_id,
    raceNumber: row.race_number,
    raceId: row.race_id,
    packageVersion: row.package_version,
    packageStatus: row.package_status,
    sourceCount: row.source_count,
    processedSourceCount: row.processed_source_count,
    factCount: row.fact_count,
    eventCount: row.event_count,
    quoteCount: row.quote_count,
    conflictCount: row.conflict_count,
    coverageScore: Number(row.coverage_score) || 0,
    sourceCoverage: row.source_coverage || {},
    lastBuiltAt: row.last_built_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function assertResearchDb() {
  const sb = supabase();
  if (!sb) {
    throw Object.assign(new Error('Supabase not configured. Run race_research_intelligence_migration.sql.'), {
      status: 503,
    });
  }
  return sb;
}

export async function findResearchSourceByIdentity(seasonId, raceNumber, sourceType, sourceKey = '') {
  const sb = assertResearchDb();
  const { data, error } = await sb
    .from('race_research_sources')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .eq('source_type', String(sourceType))
    .eq('source_key', String(sourceKey || ''))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return mapSourceRow(data);
}

export async function findResearchSourceByHash(seasonId, raceNumber, contentHash) {
  const sb = assertResearchDb();
  const { data, error } = await sb
    .from('race_research_sources')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .eq('content_hash', String(contentHash))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return mapSourceRow(data);
}

export async function upsertResearchSource(payload) {
  const sb = assertResearchDb();
  const now = nowIso();
  const row = {
    season_id: String(payload.seasonId),
    race_number: Number(payload.raceNumber),
    race_id: payload.raceId != null ? String(payload.raceId) : null,
    source_type: String(payload.sourceType),
    source_key: String(payload.sourceKey || ''),
    title: payload.title || null,
    original_filename: payload.originalFilename || null,
    source_url: payload.sourceUrl || null,
    raw_text: payload.rawText ?? null,
    storage_path: payload.storagePath || null,
    content_hash: String(payload.contentHash),
    character_count: payload.characterCount ?? (payload.rawText ? String(payload.rawText).length : null),
    processing_status: payload.processingStatus || 'pending',
    processing_error: payload.processingError || null,
    source_metadata: payload.sourceMetadata || {},
    updated_at: now,
    processed_at: payload.processedAt || null,
  };

  const { data, error } = await sb
    .from('race_research_sources')
    .upsert(row, { onConflict: 'season_id,race_number,source_type,source_key' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return mapSourceRow(data);
}

export async function updateResearchSource(id, patch) {
  const sb = assertResearchDb();
  const row = { updated_at: nowIso() };
  if (patch.processingStatus != null) row.processing_status = patch.processingStatus;
  if (patch.processingError !== undefined) row.processing_error = patch.processingError;
  if (patch.processedAt !== undefined) row.processed_at = patch.processedAt;
  if (patch.sourceMetadata != null) row.source_metadata = patch.sourceMetadata;
  // raw_text, content_hash, source_key intentionally not patchable here — ingest only.

  const { data, error } = await sb
    .from('race_research_sources')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapSourceRow(data);
}

export async function listResearchSourcesForRace(seasonId, raceNumber) {
  const sb = assertResearchDb();
  const { data, error } = await sb
    .from('race_research_sources')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(mapSourceRow);
}

export async function deleteChunksForSource(sourceId) {
  const sb = assertResearchDb();
  const { error } = await sb.from('race_research_chunks').delete().eq('source_id', sourceId);
  if (error) throw new Error(error.message);
}

export async function insertResearchChunks(sourceId, chunks, extractionVersion, options = {}) {
  const sb = assertResearchDb();
  const now = nowIso();
  const parentHash = options.sourceContentHash ?? null;
  const policyVersion = options.chunkingPolicyVersion ?? null;
  const rows = chunks.map((chunk) => ({
    source_id: sourceId,
    chunk_index: chunk.chunkIndex,
    start_character: chunk.startCharacter ?? null,
    end_character: chunk.endCharacter ?? null,
    start_timestamp: chunk.startTimestamp ?? null,
    end_timestamp: chunk.endTimestamp ?? null,
    chunk_text: chunk.chunkText,
    content_hash: hashContent(chunk.chunkText),
    source_content_hash: chunk.sourceContentHash ?? parentHash,
    chunking_policy_version: chunk.chunkingPolicyVersion ?? policyVersion,
    processing_status: 'pending',
    extraction_version: extractionVersion,
    updated_at: now,
  }));

  const { data, error } = await sb.from('race_research_chunks').insert(rows).select('*');
  if (error) throw new Error(error.message);
  return (data || []).map(mapChunkRow);
}

export async function listResearchChunksForSource(sourceId) {
  const sb = assertResearchDb();
  const { data, error } = await sb
    .from('race_research_chunks')
    .select('*')
    .eq('source_id', sourceId)
    .order('chunk_index', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(mapChunkRow);
}

export async function updateResearchChunk(id, patch) {
  const sb = assertResearchDb();
  const row = { updated_at: nowIso() };
  if (patch.processingStatus != null) row.processing_status = patch.processingStatus;
  if (patch.processingError !== undefined) row.processing_error = patch.processingError;

  const { data, error } = await sb
    .from('race_research_chunks')
    .update(row)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapChunkRow(data);
}

export async function insertRaceFact(fact, evidenceLinks = []) {
  const sb = assertResearchDb();
  const now = nowIso();
  const row = {
    season_id: String(fact.seasonId),
    race_number: Number(fact.raceNumber),
    race_id: fact.raceId != null ? String(fact.raceId) : null,
    fact_type: fact.factType,
    category: fact.category || '',
    summary: fact.summary,
    driver_ids: fact.driverIds || [],
    driver_names: fact.driverNames || [],
    team_names: fact.teamNames || [],
    lap_number: fact.lapNumber ?? null,
    sequence_order: fact.sequenceOrder ?? null,
    importance_score: fact.importanceScore ?? 0,
    confidence: fact.confidence || 'unverified',
    structured_data: fact.structuredData || {},
    first_seen_at: fact.firstSeenAt || now,
    updated_at: now,
  };

  const { data, error } = await sb.from('race_facts').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  const saved = mapFactRow(data);

  if (evidenceLinks.length) {
    await insertRaceFactSources(saved.id, evidenceLinks);
  }

  return saved;
}

export async function insertRaceFactSources(factId, links) {
  const sb = assertResearchDb();
  const rows = links.map((link) => ({
    fact_id: factId,
    source_id: link.sourceId,
    chunk_id: link.chunkId || null,
    source_start_character: link.sourceStartCharacter ?? null,
    source_end_character: link.sourceEndCharacter ?? null,
    source_start_timestamp: link.sourceStartTimestamp ?? null,
    source_end_timestamp: link.sourceEndTimestamp ?? null,
    source_excerpt: link.sourceExcerpt || null,
    support_type: link.supportType || 'primary',
  }));
  const { error } = await sb.from('race_fact_sources').insert(rows);
  if (error) throw new Error(error.message);
}

export async function listRaceFactsForRace(seasonId, raceNumber, options = {}) {
  const sb = assertResearchDb();
  let query = sb
    .from('race_facts')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .order('importance_score', { ascending: false });

  if (options.factType) query = query.eq('fact_type', options.factType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map(mapFactRow);
}

export async function listFactSourcesForFacts(factIds) {
  const sb = assertResearchDb();
  if (!factIds?.length) return [];
  const { data, error } = await sb.from('race_fact_sources').select('*').in('fact_id', factIds);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getFactIdsLinkedToSource(sourceId) {
  const sb = assertResearchDb();
  const { data, error } = await sb.from('race_fact_sources').select('fact_id').eq('source_id', sourceId);
  if (error) throw new Error(error.message);
  return [...new Set((data || []).map((row) => row.fact_id))];
}

export async function findOrphanRaceFacts(seasonId, raceNumber) {
  const facts = await listRaceFactsForRace(seasonId, raceNumber);
  if (!facts.length) return { count: 0, factIds: [] };
  const factIds = facts.map((f) => f.id);
  const links = await listFactSourcesForFacts(factIds);
  const linked = new Set(links.map((l) => l.fact_id));
  const orphans = facts.filter((f) => !linked.has(f.id)).map((f) => f.id);
  return { count: orphans.length, factIds: orphans };
}

export async function getResearchSourceById(sourceId) {
  const sb = assertResearchDb();
  const { data, error } = await sb.from('race_research_sources').select('*').eq('id', sourceId).maybeSingle();
  if (error) throw new Error(error.message);
  return mapSourceRow(data);
}

export async function deleteFactsForSource(sourceId) {
  const sb = assertResearchDb();
  const { data: links, error: linkErr } = await sb
    .from('race_fact_sources')
    .select('fact_id')
    .eq('source_id', sourceId);
  if (linkErr) throw new Error(linkErr.message);

  const factIds = [...new Set((links || []).map((row) => row.fact_id))];
  const { error: delLinkErr } = await sb.from('race_fact_sources').delete().eq('source_id', sourceId);
  if (delLinkErr) throw new Error(delLinkErr.message);

  for (const factId of factIds) {
    const { count, error: countErr } = await sb
      .from('race_fact_sources')
      .select('*', { count: 'exact', head: true })
      .eq('fact_id', factId);
    if (countErr) throw new Error(countErr.message);
    if ((count ?? 0) === 0) {
      const { error: delFactErr } = await sb.from('race_facts').delete().eq('id', factId);
      if (delFactErr) throw new Error(delFactErr.message);
    }
  }
}

export async function listFactSourceJoinsForRace(seasonId, raceNumber) {
  const facts = await listRaceFactsForRace(seasonId, raceNumber);
  const factIds = facts.map((f) => f.id);
  const links = await listFactSourcesForFacts(factIds);
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const sourceById = Object.fromEntries(sources.map((s) => [s.id, s]));
  return { facts, links, sourceById };
}

export async function checkResearchTablesExist() {
  const sb = supabase();
  if (!sb) return { configured: false, tables: {} };

  const requiredTables = [
    'race_research_sources',
    'race_research_chunks',
    'race_facts',
    'race_fact_sources',
    'race_package_status',
  ];
  const optionalTables = ['race_canonical_facts', 'race_research_source_versions'];
  const result = {};
  for (const table of [...requiredTables, ...optionalTables]) {
    const { error } = await sb.from(table).select('id').limit(1);
    if (!error) {
      result[table] = true;
      continue;
    }
    const msg = String(error.message || '').toLowerCase();
    const missing =
      msg.includes('does not exist') ||
      msg.includes('could not find the table') ||
      error.code === '42P01' ||
      error.code === 'PGRST205';
    result[table] = !missing;
  }
  return {
    configured: true,
    tables: result,
    allPresent: requiredTables.every((t) => result[t]),
    architectureExtended: optionalTables.every((t) => result[t]),
  };
}

export async function saveChunkExtractionCache(chunkId, { extraction, extractionMethod, extractionVersion }) {
  const sb = assertResearchDb();
  const { data, error } = await sb
    .from('race_research_chunks')
    .update({
      extraction_cache: extraction,
      extraction_method: extractionMethod,
      extraction_version: extractionVersion,
      updated_at: nowIso(),
    })
    .eq('id', chunkId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapChunkRow(data);
}

export async function upsertRacePackageStatus(payload) {
  const sb = assertResearchDb();
  const now = nowIso();
  const row = {
    season_id: String(payload.seasonId),
    race_number: Number(payload.raceNumber),
    race_id: payload.raceId != null ? String(payload.raceId) : null,
    package_version: payload.packageVersion || '1.0',
    package_status: payload.packageStatus || 'collecting',
    source_count: payload.sourceCount ?? 0,
    processed_source_count: payload.processedSourceCount ?? 0,
    fact_count: payload.factCount ?? 0,
    event_count: payload.eventCount ?? 0,
    quote_count: payload.quoteCount ?? 0,
    conflict_count: payload.conflictCount ?? 0,
    coverage_score: payload.coverageScore ?? 0,
    source_coverage: payload.sourceCoverage || {},
    last_built_at: payload.lastBuiltAt || now,
    updated_at: now,
  };

  const { data, error } = await sb
    .from('race_package_status')
    .upsert(row, { onConflict: 'season_id,race_number' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return mapPackageRow(data);
}

export async function getRacePackageStatus(seasonId, raceNumber) {
  const sb = assertResearchDb();
  const { data, error } = await sb
    .from('race_package_status')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return mapPackageRow(data);
}

export async function countFactsByType(seasonId, raceNumber) {
  const facts = await listRaceFactsForRace(seasonId, raceNumber);
  const counts = {};
  for (const fact of facts) {
    counts[fact.factType] = (counts[fact.factType] || 0) + 1;
  }
  return { facts, counts, total: facts.length };
}
