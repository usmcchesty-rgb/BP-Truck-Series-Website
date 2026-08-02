import { hashContent } from './_race-research-hash.js';
import { chunkTextForResearch, shouldChunkSource } from './_race-research-chunking.js';
import {
  findResearchSourceByHash,
  findResearchSourceByIdentity,
  insertResearchChunks,
  listResearchSourcesForRace,
  upsertResearchSource,
} from './_race-research-repository.js';
import { processResearchSource } from './_race-research-process.js';
import { refreshRacePackageDiagnostics } from './_race-research-package.js';
import { RACE_RESEARCH_EXTRACTION_VERSION } from '../server/config/race-research-config.js';
import { archiveSourceVersionBeforeUpdate, markActiveSourceVersion } from './_race-research-source-versions.js';

function validateRaceIdentity(seasonId, raceNumber) {
  if (!seasonId) throw Object.assign(new Error('seasonId is required.'), { status: 400 });
  const num = Number(raceNumber);
  if (!Number.isInteger(num) || num < 1) {
    throw Object.assign(new Error('Valid raceNumber is required.'), { status: 400 });
  }
  return { seasonId: String(seasonId), raceNumber: num };
}

/**
 * Central ingestion entry point.
 */
export async function ingestRaceResearchSource(input, context = {}) {
  const { seasonId, raceNumber } = validateRaceIdentity(input.seasonId, input.raceNumber);
  const sourceType = String(input.sourceType || 'other');
  const sourceKey = String(input.sourceKey || '');
  const rawText = input.rawText != null ? String(input.rawText) : null;

  if (!rawText && !input.storagePath) {
    throw Object.assign(new Error('rawText or storagePath is required.'), { status: 400 });
  }

  const contentHash = hashContent(rawText || input.storagePath || '');
  const duplicateByHash = await findResearchSourceByHash(seasonId, raceNumber, contentHash);
  const existing = await findResearchSourceByIdentity(seasonId, raceNumber, sourceType, sourceKey);

  if (existing && existing.contentHash !== contentHash && existing.rawText) {
    await archiveSourceVersionBeforeUpdate(existing.id, existing);
  }

  if (duplicateByHash && duplicateByHash.sourceType === sourceType && duplicateByHash.sourceKey === sourceKey) {
    if (!context.reprocess && duplicateByHash.processingStatus === 'complete') {
      await refreshRacePackageDiagnostics(seasonId, raceNumber);
      return {
        sourceId: duplicateByHash.id,
        duplicate: true,
        updated: false,
        chunksCreated: 0,
        processingStatus: duplicateByHash.processingStatus,
        factsCreated: 0,
        factsUpdated: 0,
        conflictsDetected: 0,
        warnings: ['Exact duplicate content hash — skipped reprocessing.'],
      };
    }
  }

  const source = await upsertResearchSource({
    seasonId,
    raceNumber,
    raceId: input.raceId ?? null,
    sourceType,
    sourceKey,
    title: input.title ?? null,
    originalFilename: input.originalFilename ?? null,
    sourceUrl: input.sourceUrl ?? null,
    rawText,
    storagePath: input.storagePath ?? null,
    contentHash,
    characterCount: rawText?.length ?? null,
    processingStatus: 'pending',
    processingError: null,
    sourceMetadata: input.metadata || input.sourceMetadata || {},
  });

  let chunksCreated = 0;
  if (rawText && shouldChunkSource(sourceType, rawText.length)) {
    const planned = chunkTextForResearch(rawText);
    if (context.prepareChunksOnly || context.autoProcess === false) {
      await import('./_race-research-repository.js').then(({ deleteChunksForSource }) =>
        deleteChunksForSource(source.id)
      );
      await insertResearchChunks(source.id, planned, RACE_RESEARCH_EXTRACTION_VERSION, {
        sourceContentHash: contentHash,
      });
      chunksCreated = planned.length;
    }
  }

  let processResult = {
    processingStatus: 'pending',
    factsCreated: 0,
    factsUpdated: 0,
    conflictsDetected: 0,
    warnings: [],
  };

  if (context.autoProcess !== false) {
    processResult = await processResearchSource(source, {
      ...context,
      seasonId,
      raceNumber,
    });
  }

  try {
    await markActiveSourceVersion(source.id, contentHash);
  } catch {
    // version table optional until migration applied
  }

  return {
    sourceId: source.id,
    duplicate: Boolean(existing && existing.contentHash === contentHash),
    updated: Boolean(existing),
    chunksCreated,
    ...processResult,
    warnings: processResult.warnings || [],
  };
}

export async function listRaceResearchSummary(seasonId, raceNumber) {
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  return sources.map((s) => ({
    id: s.id,
    sourceType: s.sourceType,
    sourceKey: s.sourceKey,
    title: s.title,
    processingStatus: s.processingStatus,
    characterCount: s.characterCount,
    contentHash: s.contentHash,
    updatedAt: s.updatedAt,
  }));
}
