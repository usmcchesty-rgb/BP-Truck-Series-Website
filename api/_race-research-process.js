import {
  RACE_RESEARCH_EXTRACTION_VERSION,
  RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT,
} from '../server/config/race-research-config.js';
import { chunkTextForResearch, shouldChunkSource } from './_race-research-chunking.js';
import { ensureTranscriptChunksForSource } from './_race-research-chunk-sync.js';
import { hashContent } from './_race-research-hash.js';
import {
  getFactIdsLinkedToSource,
  getResearchSourceById,
  saveChunkExtractionCache,
  updateResearchChunk,
  updateResearchSource,
  upsertResearchSource,
  findResearchSourceByIdentity,
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
import { persistCanonicalConsolidation } from './_race-research-canonical-persist.js';
import { swapFactsForSource } from './_race-research-fact-replace.js';

function processingMetaPatch(source, patch) {
  const prev = source.sourceMetadata || {};
  return { ...prev, ...patch };
}

function mapFailureStatus(source, hadPreviousFacts) {
  if (hadPreviousFacts) {
    return {
      processingStatus: 'failed_with_previous_data',
      latestProcessingStatus: 'failed',
    };
  }
  return {
    processingStatus: 'failed_without_previous_data',
    latestProcessingStatus: 'failed',
  };
}

export async function processResearchSource(source, context = {}) {
  const timing = context.rebuildTiming;
  const warnings = [];
  const attemptAt = new Date().toISOString();
  const rawBefore = source.rawText;

  timing?.emit('source.process.start', {
    sourceType: source.sourceType,
    sourceId: source.id,
    raceNumber: source.raceNumber,
    seasonId: source.seasonId,
  });

  const priorFactIds = await getFactIdsLinkedToSource(source.id);
  const hadPreviousFacts = priorFactIds.length > 0;

  await updateResearchSource(source.id, {
    processingStatus: 'processing',
    processingError: null,
    sourceMetadata: processingMetaPatch(source, {
      last_processing_attempt_at: attemptAt,
      latest_processing_status: 'processing',
    }),
  });

  try {
    const fresh = (await getResearchSourceById(source.id)) || source;
    if (rawBefore != null && fresh.rawText !== rawBefore) {
      throw new Error('Raw source mutated during processing.');
    }

    const processor = pickProcessor(fresh.sourceType);
    if (!processor) {
      const fail = mapFailureStatus(fresh, hadPreviousFacts);
      await updateResearchSource(fresh.id, {
        processingStatus: fail.processingStatus,
        processingError: `No processor for source type ${fresh.sourceType}`,
        sourceMetadata: processingMetaPatch(fresh, {
          latest_processing_status: fail.latestProcessingStatus,
          previous_facts_preserved: hadPreviousFacts,
        }),
      });
      return { processingStatus: fail.processingStatus, factsCreated: 0, warnings, previousFactsPreserved: hadPreviousFacts };
    }

    const isTranscriptSource = ['youtube_transcript', 'saved_transcript'].includes(fresh.sourceType);
    const genericExtractStage =
      timing && !isTranscriptSource ? timing.startStage('factExtraction') : null;
    const result = await processor(fresh, context);
    genericExtractStage?.finish({
      sourceType: fresh.sourceType,
      proposedFactCount: result.proposedFacts?.length ?? 0,
    });

    warnings.push(...(result.warnings || []));

    let factsCreated = 0;
    let conflictsDetected = 0;

    if (result.activateReplacement === true && Array.isArray(result.proposedFacts)) {
      const swapStage = timing?.startStage('factExtraction.swapFacts');
      const swapped = await swapFactsForSource(fresh.id, result.proposedFacts);
      swapStage?.finish({ factsCreated: swapped.factsCreated, atomic: swapped.atomic });
      factsCreated = swapped.factsCreated;
      conflictsDetected = swapped.conflictsDetected;
    } else if (result.activateReplacement === true && result.proposedFacts?.length === 0 && result.allowEmptyReplacement) {
      const swapStage = timing?.startStage('factExtraction.swapFacts');
      const swapped = await swapFactsForSource(fresh.id, []);
      swapStage?.finish({ factsCreated: swapped.factsCreated, atomic: swapped.atomic, emptyReplacement: true });
      factsCreated = swapped.factsCreated;
    }

    let status = result.processingStatus || 'complete';
    if (!result.activateReplacement) {
      if (status === 'failed') {
        status = hadPreviousFacts ? 'failed_with_previous_data' : 'failed_without_previous_data';
      } else if (status === 'partial' && hadPreviousFacts) {
        status = 'partial';
      }
    }

    const successAt = result.activateReplacement ? attemptAt : fresh.processedAt;

    await updateResearchSource(fresh.id, {
      processingStatus: status,
      processingError: result.processingError || null,
      processedAt: result.activateReplacement ? successAt : fresh.processedAt || null,
      sourceMetadata: processingMetaPatch(fresh, {
        latest_processing_status: status,
        last_successful_processed_at: result.activateReplacement ? attemptAt : fresh.sourceMetadata?.last_successful_processed_at,
        previous_facts_preserved: !result.activateReplacement && hadPreviousFacts,
        chunks_match_source: result.chunksMatchSource ?? fresh.sourceMetadata?.chunks_match_source,
        stale_reason: result.staleReason ?? null,
      }),
    });

    if (context.seasonId && context.raceNumber) {
      if (result.activateReplacement) {
        try {
          const derivedStage = timing?.startStage('derivedFactsRefresh');
          await refreshDerivedFactsForRace(context.seasonId, context.raceNumber, context);
          derivedStage?.finish({});
          if (timing) timing.totals.derivedRefreshRuns += 1;
        } catch (derivedErr) {
          warnings.push(`derived_refresh_failed: ${derivedErr.message}`);
        }
      }
      try {
        const canonicalStage = timing?.startStage('canonicalPersistence');
        await persistCanonicalConsolidation(context.seasonId, context.raceNumber, { rebuildTiming: timing });
        canonicalStage?.finish({ trigger: 'postSourceProcess' });
        if (timing) timing.totals.canonicalPersistenceRuns += 1;
      } catch (canonicalErr) {
        warnings.push(`canonical_consolidation_failed: ${canonicalErr.message}`);
      }
      const pkgStage = timing?.startStage('packageSave');
      await refreshRacePackageDiagnostics(context.seasonId, context.raceNumber, { rebuildTiming: timing });
      pkgStage?.finish({ trigger: 'postSourceProcess' });
    }

    timing?.emit('source.process.finish', {
      sourceType: fresh.sourceType,
      sourceId: fresh.id,
      factsCreated,
      processingStatus: status,
      activateReplacement: result.activateReplacement,
      proposedFactCount: result.proposedFacts?.length ?? 0,
    });

    return {
      processingStatus: status,
      factsCreated,
      factsUpdated: 0,
      conflictsDetected,
      warnings,
      previousFactsPreserved: !result.activateReplacement && hadPreviousFacts,
      activateReplacement: result.activateReplacement,
    };
  } catch (error) {
    const fresh = (await getResearchSourceById(source.id)) || source;
    const fail = mapFailureStatus(fresh, hadPreviousFacts);
    await updateResearchSource(source.id, {
      processingStatus: fail.processingStatus,
      processingError: String(error.message || error).slice(0, 2000),
      sourceMetadata: processingMetaPatch(fresh, {
        latest_processing_status: fail.latestProcessingStatus,
        previous_facts_preserved: hadPreviousFacts,
      }),
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

function buildProposedFacts(facts, sourceId) {
  const { facts: merged } = consolidateRaceFactsInMemory(facts);
  return merged.map((f) => ({
    ...f,
    evidenceLinks: (f.evidenceLinks || []).map((l) => ({ ...l, sourceId })),
  }));
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
  return {
    proposedFacts: buildProposedFacts(facts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
  };
}

async function processStandingsSource(source, context) {
  const payload = JSON.parse(source.rawText || '{}');
  const facts = buildStandingsFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    standingsRows: payload.rows || [],
    sourceId: source.id,
  });
  return {
    proposedFacts: buildProposedFacts(facts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
  };
}

async function processScheduleSource(source, context) {
  const payload = JSON.parse(source.rawText || '{}');
  const facts = buildScheduleMetadataFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    scheduleRace: payload,
    sourceId: source.id,
  });
  return {
    proposedFacts: buildProposedFacts(facts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
  };
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
  return {
    proposedFacts: buildProposedFacts(facts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
  };
}

async function processManualNotesSource(source) {
  const facts = buildManualNotesFacts({
    seasonId: source.seasonId,
    raceNumber: source.raceNumber,
    notes: source.rawText,
    sourceId: source.id,
  });
  return {
    proposedFacts: buildProposedFacts(facts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
  };
}

async function processPreviousArticleSource(source) {
  const payload = JSON.parse(source.rawText || '{}');
  const summary = String(payload.summary || payload.headline || '').trim();
  if (!summary) {
    return {
      activateReplacement: false,
      processingStatus: 'partial',
      warnings: ['Previous article summary empty.'],
    };
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
  return {
    proposedFacts: buildProposedFacts(facts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
  };
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
  return {
    proposedFacts: buildProposedFacts(facts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
  };
}

async function processTranscriptSource(source, context) {
  const timing = context.rebuildTiming;
  const text = String(source.rawText || '');
  if (!text.trim()) {
    return {
      activateReplacement: false,
      processingStatus: 'failed',
      processingError: 'Empty transcript',
    };
  }

  const needsChunks = shouldChunkSource(source.sourceType, text.length);
  let chunks = [];
  let chunksMatchSource = true;
  let staleReason = null;

  if (needsChunks) {
    const maxChunks = context.maxChunksPerSource ?? RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT;
    const plannedLen = chunkTextForResearch(text).length;
    if (plannedLen > maxChunks && !context.forceLargeSource) {
      return {
        activateReplacement: false,
        processingStatus: 'failed',
        processingError: `Transcript requires ${plannedLen} chunks (max ${maxChunks}). Set forceLargeSource to proceed.`,
        warnings: [`Estimated chunks: ${plannedLen}`],
      };
    }
    const chunkGenStage = timing?.startStage('chunkGeneration');
    const ensured = await ensureTranscriptChunksForSource(source, context);
    chunks = ensured.chunks;
    chunksMatchSource = !ensured.regenerated;
    staleReason = ensured.reason;
    chunkGenStage?.finish({
      sourceId: source.id,
      sourceType: source.sourceType,
      chunkCount: chunks.length,
      regenerated: ensured.regenerated,
      reason: ensured.reason,
    });
    if (timing) timing.totals.chunksProcessed += chunks.length;
  } else {
    chunks = [{ id: null, chunkIndex: 0, chunkText: text }];
  }

  const allFacts = [];
  let failed = 0;
  let succeeded = 0;
  let sequenceStart = 0;
  const totalChunks = chunks.length;

  const extractStage = timing?.startStage('factExtraction');

  for (let chunkLoopIndex = 0; chunkLoopIndex < chunks.length; chunkLoopIndex += 1) {
    const chunk = chunks[chunkLoopIndex];
    const chunkIndex = chunk.chunkIndex ?? chunkLoopIndex;
    const chunkIterStage = timing?.startStage('factExtraction.chunk');
    timing?.emit('factExtraction.chunk.start', {
      sourceId: source.id,
      sourceType: source.sourceType,
      chunkIndex,
      iteration: chunkLoopIndex + 1,
      iterationCount: totalChunks,
    });
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
      if (timing) timing.totals.transcriptChunkIterations += 1;
      chunkIterStage?.finish({
        chunkIndex,
        fromCache: true,
        factCount: facts.length,
      });
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
      if (timing) timing.totals.transcriptChunkIterations += 1;

      if (chunk.id) {
        await saveChunkExtractionCache(chunk.id, {
          extraction,
          extractionMethod: extraction._meta?.extractionMethod || 'deterministic',
          extractionVersion: RACE_RESEARCH_EXTRACTION_VERSION,
        });
        await updateResearchChunk(chunk.id, { processingStatus: 'complete', processingError: null });
      }
      chunkIterStage?.finish({
        chunkIndex,
        fromCache: false,
        factCount: facts.length,
        extractionMethod: extraction._meta?.extractionMethod || 'deterministic',
      });
    } catch (error) {
      failed += 1;
      chunkIterStage?.finish({
        chunkIndex,
        error: String(error.message || error).slice(0, 120),
        failed: true,
      });
      if (chunk.id) {
        await updateResearchChunk(chunk.id, {
          processingStatus: 'failed',
          processingError: String(error.message || error).slice(0, 500),
        });
      }
    }
  }

  extractStage?.finish({
    sourceId: source.id,
    sourceType: source.sourceType,
    factCount: allFacts.length,
    chunkCount: totalChunks,
    succeeded,
    failed,
  });

  if (failed > 0 || succeeded < totalChunks) {
    return {
      activateReplacement: false,
      processingStatus: failed === totalChunks ? 'failed' : 'partial',
      processingError:
        failed === totalChunks
          ? 'All transcript chunks failed extraction.'
          : `${failed} chunk(s) failed; prior facts preserved.`,
      warnings: [`failedChunks: ${failed}`, `succeededChunks: ${succeeded}`],
      chunksMatchSource,
      staleReason,
    };
  }

  return {
    proposedFacts: buildProposedFacts(allFacts, source.id),
    activateReplacement: true,
    processingStatus: 'complete',
    chunksMatchSource,
    staleReason,
  };
}

async function refreshDerivedFactsForRace(seasonId, raceNumber, context) {
  const { listRaceFactsForRace, findResearchSourceByIdentity } = await import('./_race-research-repository.js');

  const facts = await listRaceFactsForRace(seasonId, raceNumber);
  const nonDerived = facts.filter((f) => !f.structuredData?.derivationType);
  const { derivedFacts } = buildDerivedRaceFacts({ seasonId, raceNumber, facts: nonDerived });

  let source = await findResearchSourceByIdentity(seasonId, raceNumber, 'other', 'derived_facts');
  const rawText = JSON.stringify({ derivedFacts, builtAt: new Date().toISOString() });
  const contentHash = hashContent(rawText);

  const hadPrevious = source ? (await getFactIdsLinkedToSource(source.id)).length > 0 : false;

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

  const withLinks = derivedFacts.map((fact) => ({
    ...fact,
    evidenceLinks: [{ sourceId: source.id, supportType: 'primary' }],
  }));

  try {
    await swapFactsForSource(source.id, withLinks);
    await updateResearchSource(source.id, {
      processingStatus: 'complete',
      processingError: null,
      processedAt: new Date().toISOString(),
      sourceMetadata: processingMetaPatch(source, {
        latest_processing_status: 'complete',
        last_successful_processed_at: new Date().toISOString(),
        derived_stale: false,
      }),
    });
  } catch (error) {
    await updateResearchSource(source.id, {
      processingStatus: hadPrevious ? 'failed_with_previous_data' : 'failed_without_previous_data',
      processingError: String(error.message || error).slice(0, 500),
      sourceMetadata: processingMetaPatch(source, {
        latest_processing_status: 'failed',
        previous_facts_preserved: hadPrevious,
        derived_stale: true,
      }),
    });
    throw error;
  }
}
