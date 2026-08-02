import {
  getRaceResearchTranscriptMode,
  isNewsIntelligencePackageEnabled,
  isRaceResearchAiExtractionEnabled,
  normalizeArticleDepth,
  RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT,
  TRANSCRIPT_CHUNK_TARGET_CHARACTERS,
} from '../server/config/race-research-config.js';
import { chunkTextForResearch, shouldChunkSource } from './_race-research-chunking.js';
import { chunksMatchSourceContent } from './_race-research-chunk-validate.js';
import {
  runDiagnoseEvidence,
  runDiagnoseFacts,
  runDiagnoseQuotes,
  runDiagnoseQuality,
  runDiagnoseStatus,
  runDiagnoseTimeline,
} from './_race-research-diagnose.js';
import { buildRaceIntelligencePackage } from './_race-research-package.js';
import { syncAutomaticRaceResearchSources, loadRaceResearchBootstrapContext } from './_race-research-sync.js';
import { loadRaceTranscript } from './_race-transcripts.js';
import {
  checkResearchTablesExist,
  findOrphanRaceFacts,
  getRacePackageStatus,
  listFactSourceJoinsForRace,
  listResearchChunksForSource,
  listResearchSourcesForRace,
} from './_race-research-repository.js';
import { buildRaceDriverStoryPackages } from './_race-research-driver-stories.js';
import { assessQuotePublicationReadiness } from './_race-research-readiness.js';
import { processResearchSource } from './_race-research-process.js';
import { extractTranscriptChunkDeterministic } from './_race-research-transcript-extract.js';
import { refreshRacePackageDiagnostics } from './_race-research-package.js';
import { createResearchOperationId, logResearchOperation } from './_race-research-log.js';

export const RESEARCH_MIGRATION_HINT =
  'Race Intelligence database tables are not installed.\n\nApply:\nsupabase/race_research_intelligence_migration.sql';

export function getResearchConfigStatus() {
  return {
    packageBasedArticlePrompt: isNewsIntelligencePackageEnabled(),
    transcriptProcessingMode: getRaceResearchTranscriptMode(),
    aiTranscriptExtraction: isRaceResearchAiExtractionEnabled(),
  };
}

export function resolveResearchAllowAi(body = {}) {
  if (body.allowAi !== true) return false;
  return isRaceResearchAiExtractionEnabled();
}

export async function assertResearchDatabaseReady() {
  const tables = await checkResearchTablesExist();
  if (!tables.configured) {
    throw Object.assign(new Error('Supabase not configured.'), { status: 400, code: 'SUPABASE_MISSING' });
  }
  if (!tables.allPresent) {
    throw Object.assign(new Error(RESEARCH_MIGRATION_HINT), {
      status: 503,
      code: 'MIGRATION_REQUIRED',
      tables: tables.tables,
    });
  }
  return tables;
}

function shortId(id) {
  return id ? String(id).slice(0, 8) : '';
}

function sanitizeSourcePreview(text, max = 220) {
  if (!text) return null;
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

const FACT_FILTER_KEYS = {
  factType: 'factType',
  fact_type: 'factType',
  category: 'category',
  driver: 'driver',
  confidence: 'confidence',
  sourceType: 'sourceType',
  source_type: 'sourceType',
  conflictOnly: 'conflictOnly',
  minImportance: 'minImportance',
};

export function parseFactFilters(body = {}) {
  const filters = body.filters && typeof body.filters === 'object' ? body.filters : body;
  const out = {};
  for (const [key, target] of Object.entries(FACT_FILTER_KEYS)) {
    if (filters[key] != null && filters[key] !== '') out[target] = filters[key];
  }
  if (out.conflictOnly === true || out.conflictOnly === 'true' || out.conflictOnly === '1') {
    out.conflictOnly = true;
  } else {
    delete out.conflictOnly;
  }
  if (out.minImportance != null) {
    const n = Number(out.minImportance);
    if (!Number.isFinite(n)) {
      throw Object.assign(new Error('minImportance must be a number.'), { status: 400 });
    }
    out.minImportance = n;
  }
  const allowedConfidence = new Set([
    'official',
    'officially_confirmed',
    'manual',
    'derived',
    'historical',
    'broadcast_reported',
    'unverified',
    'conflicting',
  ]);
  if (out.confidence && !allowedConfidence.has(String(out.confidence))) {
    throw Object.assign(new Error('Invalid confidence filter.'), { status: 400 });
  }
  return out;
}

export function filterFactsForAdmin(facts, links, sourceById, filters = {}) {
  let rows = facts.map((f) => {
    const factLinks = links.filter((l) => l.fact_id === f.id);
    const types = [...new Set(factLinks.map((l) => sourceById[l.source_id]?.sourceType).filter(Boolean))];
    return {
      id: f.id,
      idShort: shortId(f.id),
      factType: f.factType,
      category: f.category,
      summary: f.summary,
      drivers: (f.driverNames || []).join(', '),
      driverIds: f.driverIds || [],
      lap: f.lapNumber,
      importance: f.importanceScore,
      confidence: f.confidence,
      sourceCount: factLinks.length,
      sourceTypes: types,
      conflictStatus: f.confidence === 'conflicting' ? 'conflict' : 'none',
      structuredData: f.structuredData,
      sequenceOrder: f.sequenceOrder,
      evidence: factLinks.map((l) => ({
        sourceId: shortId(l.source_id),
        sourceType: sourceById[l.source_id]?.sourceType,
        excerpt: sanitizeSourcePreview(l.source_excerpt, 280),
        charStart: l.source_start_character,
        charEnd: l.source_end_character,
        timestampStart: l.source_start_timestamp,
        timestampEnd: l.source_end_timestamp,
        supportType: l.support_type,
        extractionMethod: sourceById[l.source_id]?.sourceMetadata?.lastExtractionMethod || null,
      })),
    };
  });

  if (filters.factType) rows = rows.filter((r) => r.factType === filters.factType);
  if (filters.category) rows = rows.filter((r) => r.category === filters.category);
  if (filters.confidence) rows = rows.filter((r) => r.confidence === filters.confidence);
  if (filters.conflictOnly) rows = rows.filter((r) => r.conflictStatus === 'conflict');
  if (filters.minImportance != null) {
    rows = rows.filter((r) => Number(r.importance) >= filters.minImportance);
  }
  if (filters.driver) {
    const q = String(filters.driver).toLowerCase();
    rows = rows.filter(
      (r) => r.drivers.toLowerCase().includes(q) || r.driverIds.some((id) => String(id).includes(q))
    );
  }
  if (filters.sourceType) {
    rows = rows.filter((r) => r.sourceTypes.includes(filters.sourceType));
  }

  rows.sort(
    (a, b) =>
      Number(b.importance) - Number(a.importance) ||
      String(a.factType).localeCompare(String(b.factType)) ||
      String(a.id).localeCompare(String(b.id))
  );

  return rows;
}

const TIMELINE_PHASE_ORDER = [
  'pre-race',
  'start',
  'early',
  'middle',
  'late',
  'finish',
  'post-race',
  'unknown',
];

function inferTimelinePhase(fact) {
  const fromData = fact.structuredData?.racePhase || fact.structuredData?.chunkSummary?.racePhase;
  if (fromData && TIMELINE_PHASE_ORDER.includes(fromData)) return fromData;
  if (fact.category === 'start' || fact.factType === 'start') return 'start';
  if (fact.category === 'finish' || fact.factType === 'finish') return 'finish';
  if (fact.factType === 'quote' && fact.structuredData?.quoteCompleteness) return 'post-race';
  return 'unknown';
}

export function buildAdminTimeline(seasonId, raceNumber, diagnoseTimeline, facts, links, sourceById) {
  const eventFacts = facts.filter((f) =>
    ['race_event', 'lead_change', 'caution', 'incident', 'penalty', 'strategy', 'restart'].includes(
      f.factType
    )
  );

  const items = eventFacts
    .map((f) => {
      const factLinks = links.filter((l) => l.fact_id === f.id);
      const types = [...new Set(factLinks.map((l) => sourceById[l.source_id]?.sourceType).filter(Boolean))];
      const official = types.some((t) => ['race_control', 'official_results'].includes(t));
      const broadcastOnly =
        types.length > 0 && types.every((t) => ['youtube_transcript', 'saved_transcript'].includes(t));
      return {
        id: f.id,
        idShort: shortId(f.id),
        phase: inferTimelinePhase(f),
        lap: f.lapNumber,
        sequence: f.sequenceOrder,
        category: f.category || f.factType,
        summary: f.summary,
        drivers: (f.driverNames || []).join(', '),
        confidence: f.confidence,
        importance: f.importanceScore,
        sourceTypes: types,
        official,
        broadcastOnly,
        speculation: f.structuredData?.certainty === 'speculation' || f.confidence === 'unverified',
        conflict: f.confidence === 'conflicting',
      };
    })
    .sort(
      (a, b) =>
        (a.sequence ?? 99999) - (b.sequence ?? 99999) ||
        (a.lap ?? 99999) - (b.lap ?? 99999) ||
        String(a.id).localeCompare(String(b.id))
    );

  const grouped = {};
  for (const phase of TIMELINE_PHASE_ORDER) grouped[phase] = [];
  for (const item of items) {
    const phase = grouped[item.phase] ? item.phase : 'unknown';
    grouped[phase].push(item);
  }

  return {
    seasonId,
    raceNumber,
    items,
    grouped,
    issues: diagnoseTimeline?.issues || {},
    highlights: {
      unplaced: items.filter((i) => i.lap == null && i.sequence == null).length,
      duplicates: diagnoseTimeline?.issues?.duplicateCandidates?.length ?? 0,
      gaps: diagnoseTimeline?.issues?.largeGaps?.length ?? 0,
      conflicts: items.filter((i) => i.conflict).length,
    },
  };
}

export async function handleResearchDbCheck() {
  const opId = createResearchOperationId();
  const started = Date.now();
  const tables = await checkResearchTablesExist();
  logResearchOperation({
    opId,
    action: 'research-db-check',
    durationMs: Date.now() - started,
    status: tables.allPresent ? 'ok' : 'migration_required',
  });
  return {
    status: 200,
    data: {
      operationId: opId,
      configured: tables.configured,
      tables: tables.tables,
      ready: Boolean(tables.allPresent),
      architectureExtended: Boolean(tables.architectureExtended),
      message: tables.allPresent
        ? tables.architectureExtended
          ? null
          : 'Core tables ready. Apply race_research_canonical_and_atomic_migration.sql for canonical facts, atomic swap RPC, and source version history.'
        : RESEARCH_MIGRATION_HINT,
      config: getResearchConfigStatus(),
    },
  };
}

export async function handleResearchOverview(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const statusRow = await getRacePackageStatus(seasonId, raceNumber);
  const pkg = await buildRaceIntelligencePackage({ seasonId, raceNumber });
  const stories = buildRaceDriverStoryPackages({ racePackage: pkg });
  const { facts } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const unresolvedDrivers = facts.filter(
    (f) => (f.driverNames || []).some((n) => /unknown/i.test(n)) || f.structuredData?.unresolvedDriver
  ).length;

  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const failedOrPartial = sources.filter((s) =>
    ['failed', 'partial', 'failed_with_previous_data', 'failed_without_previous_data', 'stale'].includes(
      s.processingStatus
    )
  ).length;
  const orphans = await findOrphanRaceFacts(seasonId, raceNumber);
  const proc = statusRow?.sourceCoverage?._processing || {};

  return {
    seasonId,
    raceNumber,
    track: pkg.identity?.track,
    raceDate: pkg.identity?.date,
    packageStatus: statusRow?.packageStatus || pkg.diagnostics?.packageStatus,
    packageVersion: statusRow?.packageVersion,
    coverageScore: statusRow?.coverageScore ?? pkg.diagnostics?.coverageScore,
    sourceCount: statusRow?.sourceCount ?? sources.length,
    processedSourceCount: statusRow?.processedSourceCount ?? 0,
    failedOrPartialSourceCount: failedOrPartial,
    factCount: statusRow?.factCount ?? facts.length,
    timelineEventCount: statusRow?.eventCount ?? pkg.diagnostics?.eventCount,
    quoteCount: statusRow?.quoteCount ?? pkg.diagnostics?.quoteCount,
    driverStoryCount: stories.length,
    conflictCount: statusRow?.conflictCount ?? pkg.diagnostics?.conflictCount,
    unresolvedDriverCount: unresolvedDrivers,
    lastBuiltAt: statusRow?.lastBuiltAt,
    config: getResearchConfigStatus(),
    missingSources: pkg.diagnostics?.missingSources || [],
    orphanFactCount: orphans.count,
    staleSourceCount: proc.staleCount ?? 0,
    preservedFactsSourceCount: proc.preservedCount ?? 0,
    failedLatestAttemptCount: proc.failedWithPreviousCount ?? 0,
    chunkMismatchCount: null,
  };
}

export async function handleResearchSourcesDetail(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const rows = [];
  const youtubeSources = sources.filter((s) => s.sourceType === 'youtube_transcript');
  const youtubeWarning =
    youtubeSources.length > 1
      ? `${youtubeSources.length} YouTube transcript sources exist for this race — review Sources tab.`
      : null;

  for (const s of sources) {
    const chunks = await listResearchChunksForSource(s.id);
    const chunksMatch = chunks.length ? chunksMatchSourceContent(chunks, s) : null;
    const complete = chunks.filter((c) => c.processingStatus === 'complete');
    const failed = chunks.filter((c) => c.processingStatus === 'failed');
    const methods = [...new Set(chunks.map((c) => c.extractionMethod).filter(Boolean))];
    const meta = s.sourceMetadata || {};
    rows.push({
      id: s.id,
      idShort: shortId(s.id),
      sourceType: s.sourceType,
      title: s.title,
      sourceKey: s.sourceKey,
      characterCount: s.characterCount,
      contentHashShort: s.contentHash ? s.contentHash.slice(0, 12) : null,
      processingStatus: s.processingStatus,
      latestProcessingStatus: meta.latest_processing_status || s.processingStatus,
      lastSuccessfulProcessedAt: meta.last_successful_processed_at || s.processedAt,
      lastProcessingAttemptAt: meta.last_processing_attempt_at || null,
      previousFactsPreserved: meta.previous_facts_preserved === true,
      isStale: Boolean(meta.stale_reason) || s.processingStatus === 'stale',
      staleReason: meta.stale_reason || null,
      chunksMatchSource: chunksMatch,
      chunkParentHashSample: chunks[0]?.sourceContentHash?.slice(0, 12) || null,
      chunkCount: chunks.length,
      chunksComplete: complete.length,
      chunksFailed: failed.length,
      extractionMethods: methods,
      extractionVersion: chunks[0]?.extractionVersion || null,
      factsProduced: null,
      processedAt: s.processedAt,
      error: s.processingError,
      skippedUnchanged: Boolean(meta.skippedUnchanged),
      preview: sanitizeSourcePreview(s.rawText),
    });
  }

  const { links } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const factCountBySource = {};
  for (const l of links) {
    factCountBySource[l.source_id] = (factCountBySource[l.source_id] || 0) + 1;
  }
  for (const row of rows) {
    row.factsProduced = factCountBySource[row.id] || 0;
  }

  return { seasonId, raceNumber, sources: rows, youtubeWarning };
}

export async function handleResearchFactsFiltered(seasonId, raceNumber, body) {
  await assertResearchDatabaseReady();
  const filters = parseFactFilters(body);
  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const rows = filterFactsForAdmin(facts, links, sourceById, filters);
  return { seasonId, raceNumber, filters, total: facts.length, returned: rows.length, facts: rows.slice(0, 400) };
}

export async function handleResearchTimelineAdmin(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const diagnose = await runDiagnoseTimeline(seasonId, raceNumber);
  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  return buildAdminTimeline(seasonId, raceNumber, diagnose, facts, links, sourceById);
}

export async function handleResearchQuotesAdmin(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const base = await runDiagnoseQuotes(seasonId, raceNumber);
  const quotes = (base.quotes || []).map((q) => {
    const readiness = assessQuotePublicationReadiness(q);
    return { ...q, ...readiness };
  });
  return { seasonId, raceNumber, count: quotes.length, quotes };
}

export async function handleResearchDriverStoriesAdmin(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const pkg = await buildRaceIntelligencePackage({ seasonId, raceNumber });
  const stories = buildRaceDriverStoryPackages({ racePackage: pkg });
  return { seasonId, raceNumber, count: stories.length, driverStories: stories };
}

export async function handleResearchConflictsAdmin(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const conflicts = facts
    .filter((f) => f.confidence === 'conflicting' || (f.structuredData?.conflictNotes || []).length)
    .map((f) => {
      const factLinks = links.filter((l) => l.fact_id === f.id);
      const excerpts = factLinks.map((l) => ({
        sourceType: sourceById[l.source_id]?.sourceType,
        excerpt: sanitizeSourcePreview(l.source_excerpt, 200),
        confidence: sourceById[l.source_id]?.sourceType === 'race_control' ? 'official' : 'supporting',
      }));
      const hasOfficial = excerpts.some((e) => e.confidence === 'official');
      return {
        factId: shortId(f.id),
        canonicalSummary: f.summary,
        competingStatements: f.structuredData?.conflictNotes || [],
        factType: f.factType,
        category: f.category,
        confidence: f.confidence,
        sources: excerpts,
        officialSourcePriority: hasOfficial,
        articleBehavior: hasOfficial
          ? 'Prefer official Race Control wording; note broadcast disagreement if publishing.'
          : 'Present both statements or omit until verified.',
      };
    });
  return { seasonId, raceNumber, count: conflicts.length, conflicts };
}

export async function handleResearchSyncAdmin(seasonId, raceNumber, body) {
  await assertResearchDatabaseReady();
  const opId = createResearchOperationId();
  const started = Date.now();
  const allowAi = resolveResearchAllowAi(body);
  const sync = await syncAutomaticRaceResearchSources(seasonId, raceNumber, {
    includeYoutube: body.includeYoutube !== false,
    forceLargeSource: body.forceLargeSource === true,
    transcriptExtractor: extractTranscriptChunkDeterministic,
    allowAi,
  });
  await refreshRacePackageDiagnostics(seasonId, raceNumber);
  logResearchOperation({
    opId,
    action: 'research-sync',
    seasonId,
    raceNumber,
    processingMode: getRaceResearchTranscriptMode(),
    created: sync.ingested?.length,
    durationMs: Date.now() - started,
    status: 'ok',
  });
  return {
    operationId: opId,
    warnings: sync.warnings,
    ingested: sync.ingested?.length ?? 0,
    allowAi,
    skippedAi: !allowAi,
  };
}

export async function handleResearchRebuildEstimate(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const config = getResearchConfigStatus();
  const allowAi = false;
  const ctx = await loadRaceResearchBootstrapContext(seasonId, raceNumber);
  let estimatedSources = 0;
  if (ctx.scheduleRace) estimatedSources += 1;
  if (ctx.scheduleEntry?.driverResults) estimatedSources += 1;
  if (ctx.standings?.length) estimatedSources += 1;
  estimatedSources += 2;

  let transcriptChars = 0;
  try {
    const tr = await loadRaceTranscript(raceNumber);
    transcriptChars = tr?.transcript?.length || tr?.length || 0;
  } catch {
    transcriptChars = 0;
  }

  let estimatedChunks = 0;
  if (transcriptChars > 0 && shouldChunkSource('saved_transcript', transcriptChars)) {
    estimatedChunks = chunkTextForResearch('x'.repeat(transcriptChars)).length;
  } else if (transcriptChars > 0) {
    estimatedChunks = 1;
  }

  const mode = config.transcriptProcessingMode;
  let estimatedPaidAiRequests = 0;
  if (allowAi && config.aiTranscriptExtraction && (mode === 'ai' || mode === 'hybrid')) {
    estimatedPaidAiRequests = mode === 'ai' ? estimatedChunks : Math.ceil(estimatedChunks * 0.6);
  }

  return {
    seasonId,
    raceNumber,
    config,
    allowAiDefault: false,
    estimatedSourceCount: estimatedSources,
    estimatedTranscriptChunks: estimatedChunks,
    maxChunksWithoutForce: RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT,
    transcriptChars,
    chunkTargetChars: TRANSCRIPT_CHUNK_TARGET_CHARACTERS,
    estimatedPaidAiRequests,
    unchangedSourcesWillBeSkipped: true,
    forceLargeSourceRequired: estimatedChunks > RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT,
  };
}

function aggregateIngestResults(ingested = []) {
  const summary = {
    sourcesAdded: 0,
    sourcesUpdated: 0,
    sourcesUnchanged: 0,
    chunksCreated: 0,
    chunksProcessed: 0,
    chunksFailed: 0,
    factsCreated: 0,
    conflictsFound: 0,
    warnings: [],
  };
  for (const row of ingested) {
    if (row.duplicate && row.updated === false) summary.sourcesUnchanged += 1;
    else if (row.updated) summary.sourcesUpdated += 1;
    else summary.sourcesAdded += 1;
    summary.chunksCreated += row.chunksCreated || 0;
    summary.factsCreated += row.factsCreated || 0;
    summary.conflictsFound += row.conflictsDetected || 0;
    if (row.warnings?.length) summary.warnings.push(...row.warnings);
    const failedMatch = String(row.processingError || '').match(/failed/i);
    if (row.processingStatus === 'failed' || failedMatch) summary.chunksFailed += 1;
    if (row.processingStatus === 'complete' || row.processingStatus === 'partial') {
      summary.chunksProcessed += 1;
    }
  }
  return summary;
}

export async function handleResearchRebuildPackage(seasonId, raceNumber, body) {
  await assertResearchDatabaseReady();
  const opId = createResearchOperationId();
  const started = Date.now();
  const allowAi = resolveResearchAllowAi(body);
  const sync = await syncAutomaticRaceResearchSources(seasonId, raceNumber, {
    manualNotes: body.manualNotes ?? body.manual_notes,
    includeYoutube: body.includeYoutube !== false,
    forceLargeSource: body.forceLargeSource !== false,
    transcriptExtractor: extractTranscriptChunkDeterministic,
    allowAi,
  });
  const status = await refreshRacePackageDiagnostics(seasonId, raceNumber);
  let canonical = { skipped: true };
  try {
    const { persistCanonicalConsolidation } = await import('./_race-research-canonical-persist.js');
    canonical = await persistCanonicalConsolidation(seasonId, raceNumber);
  } catch (err) {
    canonical = { skipped: true, error: err.message };
  }
  const quality = await runDiagnoseQuality(seasonId, raceNumber);
  const summary = aggregateIngestResults(sync.ingested);

  logResearchOperation({
    opId,
    action: 'rebuild-package',
    seasonId,
    raceNumber,
    processingMode: getRaceResearchTranscriptMode(),
    created: summary.sourcesAdded,
    updated: summary.sourcesUpdated,
    skipped: summary.sourcesUnchanged,
    durationMs: Date.now() - started,
    status: 'ok',
  });

  return {
    operationId: opId,
    allowAi,
    estimatedPaidAiRequests: allowAi ? summary.chunksProcessed : 0,
    syncWarnings: sync.warnings,
    ...summary,
    packageStatus: status,
    canonicalConsolidation: canonical,
    coverageScore: status?.coverageScore,
    readiness: quality.readiness,
    report: quality.report,
  };
}

export async function handleResearchContinueProcessing(seasonId, raceNumber, body) {
  await assertResearchDatabaseReady();
  const opId = createResearchOperationId();
  const started = Date.now();
  const ctx = await loadRaceResearchBootstrapContext(seasonId, raceNumber);
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const targets = sources.filter(
    (s) =>
      ['partial', 'failed', 'processing'].includes(s.processingStatus) ||
      (body.sourceId && s.id === body.sourceId)
  );

  if (!targets.length) {
    return {
      operationId: opId,
      continued: 0,
      message: 'No partial or failed sources require continuation.',
    };
  }

  const allowAi = resolveResearchAllowAi(body);
  const results = [];
  for (const source of targets) {
    const result = await processResearchSource(source, {
      seasonId,
      raceNumber,
      driverLookup: ctx.driverLookup,
      forceLargeSource: true,
      allowAi,
    });
    results.push({ sourceId: shortId(source.id), sourceType: source.sourceType, ...result });
  }

  await refreshRacePackageDiagnostics(seasonId, raceNumber);
  logResearchOperation({
    opId,
    action: 'research-continue-processing',
    seasonId,
    raceNumber,
    chunkCount: results.length,
    durationMs: Date.now() - started,
    status: 'ok',
  });

  return { operationId: opId, continued: results.length, results };
}

export async function handleResearchCanonicalAdmin(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const { getCanonicalDiagnostics } = await import('./_race-research-canonical-persist.js');
  return getCanonicalDiagnostics(seasonId, raceNumber);
}

export async function handleResearchSourceHistoryAdmin(seasonId, raceNumber, body) {
  await assertResearchDatabaseReady();
  const { listSourceVersions } = await import('./_race-research-source-versions.js');
  const sourceId = body.sourceId ?? body.source_id;
  if (!sourceId) {
    const sources = await listResearchSourcesForRace(seasonId, raceNumber);
    const bySource = [];
    for (const s of sources) {
      bySource.push({
        sourceId: s.id,
        sourceType: s.sourceType,
        sourceKey: s.sourceKey,
        versions: await listSourceVersions(s.id),
      });
    }
    return { seasonId, raceNumber, sources: bySource };
  }
  return { seasonId, raceNumber, sourceId, versions: await listSourceVersions(sourceId) };
}

export async function handleResearchRollbackSourceAdmin(seasonId, raceNumber, body) {
  await assertResearchDatabaseReady();
  const sourceId = body.sourceId ?? body.source_id;
  const versionId = body.versionId ?? body.version_id;
  if (!sourceId || !versionId) {
    throw Object.assign(new Error('sourceId and versionId are required.'), { status: 400 });
  }
  const ctx = await loadRaceResearchBootstrapContext(seasonId, raceNumber);
  const { rollbackSourceToVersion } = await import('./_race-research-source-versions.js');
  return rollbackSourceToVersion(sourceId, versionId, {
    seasonId,
    raceNumber,
    driverLookup: ctx.driverLookup,
    forceRechunk: true,
    forceLargeSource: true,
    allowAi: false,
  });
}

export async function handleResearchStatusReadOnly(seasonId, raceNumber) {
  await assertResearchDatabaseReady();
  const overview = await handleResearchOverview(seasonId, raceNumber);
  const status = await runDiagnoseStatus(seasonId, raceNumber);
  return {
    ...overview,
    migration: status.migration,
    chunks: status.chunks,
    factCounts: status.factCounts,
    missingSourceTypes: status.missingSourceTypes,
    sourcesSummary: status.sources,
  };
}
