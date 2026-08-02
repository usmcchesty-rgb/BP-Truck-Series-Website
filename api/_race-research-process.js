import {
  RACE_RESEARCH_EXTRACTION_VERSION,
  RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT,
} from '../server/config/race-research-config.js';
import { chunkTextForResearch, shouldChunkSource } from './_race-research-chunking.js';
import { hashContent } from './_race-research-hash.js';
import {
  deleteFactsForSource,
  deleteChunksForSource,
  insertRaceFact,
  insertResearchChunks,
  listResearchChunksForSource,
  saveChunkExtractionCache,
  updateResearchChunk,
  updateResearchSource,
} from './_race-research-repository.js';
import {
  buildManualNotesFacts,
  buildOfficialResultFacts,
  buildRaceControlFacts,
  buildScheduleMetadataFacts,
  buildStandingsFacts,
  consolidateRaceFactsInMemory,
} from './_race-research-processors.js';
import {
  extractTranscriptChunkHybrid,
  transcriptExtractionToFacts,
} from './_race-research-transcript-extract.js';
import { buildDerivedRaceFacts } from './_race-research-derived.js';
import { refreshRacePackageDiagnostics } from './_race-research-package.js';

export async function processResearchSource(source, context = {}) {
  const warnings = [];
  let factsCreated = 0;
  let factsUpdated = 0;
  let conflictsDetected = 0;

  await updateResearchSource(source.id, {
    processingStatus: 'processing',
    processingError: null,
  });

  try {
    await deleteFactsForSource(source.id);

    const processor = pickProcessor(source.sourceType);
    if (!processor) {
      await updateResearchSource(source.id, {
        processingStatus: 'failed',
        processingError: `No processor for source type ${source.sourceType}`,
      });
      return { processingStatus: 'failed', factsCreated: 0, warnings };
    }

    const result = await processor(source, context);
    factsCreated += result.factsCreated || 0;
    conflictsDetected += result.conflictsDetected || 0;
    warnings.push(...(result.warnings || []));

    const status = result.processingStatus || 'complete';
    await updateResearchSource(source.id, {
      processingStatus: status,
      processingError: result.processingError || null,
      processedAt: new Date().toISOString(),
    });

    if (context.seasonId && context.raceNumber) {
      await refreshDerivedFactsForRace(context.seasonId, context.raceNumber, context);
      await refreshRacePackageDiagnostics(context.seasonId, context.raceNumber);
    }

    return {
      processingStatus: status,
      factsCreated,
      factsUpdated,
      conflictsDetected,
      warnings,
    };
  } catch (error) {
    await updateResearchSource(source.id, {
      processingStatus: 'failed',
      processingError: String(error.message || error).slice(0, 2000),
    });
    throw error;
  }
}

function pickProcessor(sourceType) {
  const map = {
    official_results: processOfficialResultsSource,
    qualifying: processOfficialResultsSource,
    standings: processStandingsSource,
    schedule: processScheduleSource,
    race_control: processRaceControlSource,
    manual_notes: processManualNotesSource,
    youtube_transcript: processTranscriptSource,
    saved_transcript: processTranscriptSource,
    previous_article: processPreviousArticleSource,
    historical_results: processHistoricalResultsSource,
  };
  return map[sourceType] || null;
}

async function persistFacts(facts, source) {
  const { facts: merged, conflictsDetected } = consolidateRaceFactsInMemory(facts);
  let created = 0;
  for (const fact of merged) {
    if (!fact.evidenceLinks?.length) {
      throw new Error('Every fact must have at least one evidence link.');
    }
    await insertRaceFact(fact, fact.evidenceLinks);
    created += 1;
  }
  return { factsCreated: created, conflictsDetected };
}

async function processOfficialResultsSource(source, context) {
  const payload = JSON.parse(source.rawText || '{}');
  const facts = buildOfficialResultFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    raceId: source.raceId,
    scheduleEntry: payload,
    driverLookup: context.driverLookup,
    sourceId: source.id,
  });
  const saved = await persistFacts(facts, source);
  return { ...saved, processingStatus: 'complete' };
}

async function processStandingsSource(source, context) {
  const payload = JSON.parse(source.rawText || '{}');
  const facts = buildStandingsFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    standingsRows: payload.rows || [],
    sourceId: source.id,
  });
  const saved = await persistFacts(facts, source);
  return { ...saved, processingStatus: 'complete' };
}

async function processScheduleSource(source, context) {
  const payload = JSON.parse(source.rawText || '{}');
  const facts = buildScheduleMetadataFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    scheduleRace: payload,
    sourceId: source.id,
  });
  const saved = await persistFacts(facts, source);
  return { ...saved, processingStatus: 'complete' };
}

async function processRaceControlSource(source, context) {
  const payload = JSON.parse(source.rawText || '{}');
  const facts = buildRaceControlFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    report: { parsedJson: payload.parsedJson || payload },
    sourceId: source.id,
    driverLookup: context.driverLookup,
  });
  const saved = await persistFacts(facts, source);
  return { ...saved, processingStatus: 'complete' };
}

async function processManualNotesSource(source) {
  const facts = buildManualNotesFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    notes: source.rawText,
    sourceId: source.id,
  });
  const saved = await persistFacts(facts, source);
  return { ...saved, processingStatus: 'complete' };
}

async function processPreviousArticleSource(source) {
  const payload = JSON.parse(source.rawText || '{}');
  const summary = String(payload.summary || payload.headline || '').trim();
  if (!summary) {
    return { factsCreated: 0, processingStatus: 'partial', warnings: ['Previous article summary empty.'] };
  }
  const facts = [
    {
      seasonId: source.seasonId,
      raceNumber: source.raceNumber,
      factType: 'historical',
      category: 'previous_article',
      summary: summary.slice(0, 800),
      importanceScore: 30,
      confidence: 'historical',
      structuredData: { articleId: payload.id, slug: payload.slug },
      evidenceLinks: [{ sourceId: source.id, supportType: 'primary' }],
    },
  ];
  const saved = await persistFacts(facts, source);
  return { ...saved, processingStatus: 'complete' };
}

async function processHistoricalResultsSource(source) {
  const payload = JSON.parse(source.rawText || '{}');
  const facts = (payload.entries || []).map((entry, index) => ({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    factType: 'historical',
    category: 'track_history',
    summary: String(entry.summary || entry),
    sequenceOrder: index,
    importanceScore: 25,
    confidence: 'historical',
    structuredData: entry,
    evidenceLinks: [{ sourceId: source.id, supportType: 'primary' }],
  }));
  const saved = await persistFacts(facts, source);
  return { ...saved, processingStatus: 'complete' };
}

async function processTranscriptSource(source, context) {
  const text = String(source.rawText || '');
  if (!text.trim()) {
    return { factsCreated: 0, processingStatus: 'failed', processingError: 'Empty transcript' };
  }

  const needsChunks = shouldChunkSource(source.sourceType, text.length);
  let chunks = await listResearchChunksForSource(source.id);

  if (needsChunks && !chunks.length) {
    await deleteChunksForSource(source.id);
    const planned = chunkTextForResearch(text);
    const maxChunks = context.maxChunksPerSource ?? RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT;
    if (planned.length > maxChunks && !context.forceLargeSource) {
      return {
        factsCreated: 0,
        processingStatus: 'failed',
        processingError: `Transcript requires ${planned.length} chunks (max ${maxChunks}). Set forceLargeSource to proceed.`,
        warnings: [`Estimated chunks: ${planned.length}`],
      };
    }
    chunks = await insertResearchChunks(source.id, planned, RACE_RESEARCH_EXTRACTION_VERSION);
  }

  if (!needsChunks) {
    chunks = [
      {
        id: null,
        chunkIndex: 0,
        chunkText: text,
      },
    ];
  }

  const allFacts = [];
  let failed = 0;
  let succeeded = 0;
  let sequenceStart = 0;
  const totalChunks = chunks.length;

  for (const chunk of chunks) {
    const chunkIndex = chunk.chunkIndex ?? 0;
    const cached =
      chunk.extractionCache &&
      chunk.extractionVersion === RACE_RESEARCH_EXTRACTION_VERSION &&
      chunk.processingStatus === 'complete' &&
      !context.forceReprocess;

    if (cached && context.skipCompleteChunks !== false) {
      const { facts, nextSequence } = transcriptExtractionToFacts(chunk.extractionCache, {
        seasonId: source.seasonId,
        raceNumber: source.raceNumber,
        raceId: source.raceId,
        sourceId: source.id,
        chunkId: chunk.id,
        driverLookup: context.driverLookup,
        sequenceStart,
      });
      sequenceStart = nextSequence;
      allFacts.push(...facts);
      succeeded += 1;
      continue;
    }

    try {
      if (chunk.id) {
        await updateResearchChunk(chunk.id, { processingStatus: 'processing', processingError: null });
      }

      const extraction = await extractTranscriptChunkHybrid(chunk.chunkText, {
        extractor: context.transcriptExtractor,
        allowAi: context.allowAi === true,
        transcriptMode: context.transcriptMode,
        preprocessOptions: { chunkIndex, totalChunks },
      });

      const { facts, nextSequence } = transcriptExtractionToFacts(extraction, {
        seasonId: source.seasonId,
        raceNumber: source.raceNumber,
        raceId: source.raceId,
        sourceId: source.id,
        chunkId: chunk.id,
        driverLookup: context.driverLookup,
        sequenceStart,
      });
      sequenceStart = nextSequence;
      allFacts.push(...facts);
      succeeded += 1;

      if (chunk.id) {
        await saveChunkExtractionCache(chunk.id, {
          extraction,
          extractionMethod: extraction._meta?.extractionMethod || 'deterministic',
          extractionVersion: RACE_RESEARCH_EXTRACTION_VERSION,
        });
        await updateResearchChunk(chunk.id, { processingStatus: 'complete', processingError: null });
      }
    } catch (error) {
      failed += 1;
      if (chunk.id) {
        await updateResearchChunk(chunk.id, {
          processingStatus: 'failed',
          processingError: String(error.message || error).slice(0, 500),
        });
      }
    }
  }

  if (!allFacts.length && failed > 0) {
    return {
      factsCreated: 0,
      processingStatus: 'failed',
      processingError: 'All transcript chunks failed extraction.',
      warnings: [`failedChunks: ${failed}`],
    };
  }

  const saved = await persistFacts(allFacts, source);
  const status = failed > 0 ? 'partial' : 'complete';
  return {
    ...saved,
    processingStatus: status,
    warnings: failed > 0 ? [`${failed} chunk(s) failed; ${succeeded} succeeded.`] : [],
  };
}

async function refreshDerivedFactsForRace(seasonId, raceNumber, context) {
  const { listRaceFactsForRace, deleteFactsForSource, findResearchSourceByIdentity, upsertResearchSource } =
    await import('./_race-research-repository.js');

  const facts = await listRaceFactsForRace(seasonId, raceNumber);
  const nonDerived = facts.filter((f) => !f.structuredData?.derivationType);
  const { derivedFacts } = buildDerivedRaceFacts({ seasonId, raceNumber, facts: nonDerived });

  let source = await findResearchSourceByIdentity(seasonId, raceNumber, 'other', 'derived_facts');
  const rawText = JSON.stringify({ derivedFacts, builtAt: new Date().toISOString() });
  const contentHash = hashContent(rawText);

  source = await upsertResearchSource({
    seasonId,
    raceNumber,
    sourceType: 'other',
    sourceKey: 'derived_facts',
    title: 'Derived race facts',
    rawText,
    contentHash,
    processingStatus: 'complete',
    sourceMetadata: { synthetic: true },
  });

  await deleteFactsForSource(source.id);
  const withLinks = derivedFacts.map((fact) => ({
    ...fact,
    evidenceLinks: [{ sourceId: source.id, supportType: 'primary' }],
  }));
  await persistFacts(withLinks, source);
}
