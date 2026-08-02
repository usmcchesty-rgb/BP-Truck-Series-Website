import { chunkTextForResearch } from './_race-research-chunking.js';
import {
  deleteChunksForSource,
  insertResearchChunks,
  listResearchChunksForSource,
} from './_race-research-repository.js';
import {
  chunksMatchSourceContent,
  validatePlannedChunkSet,
} from './_race-research-chunk-validate.js';
import { RACE_RESEARCH_CHUNKING_POLICY_VERSION, RACE_RESEARCH_EXTRACTION_VERSION } from '../server/config/race-research-config.js';

export function shouldRegenerateChunks(source, chunks, context = {}) {
  if (context.forceRechunk === true) return { stale: true, reason: 'forceRechunk' };
  if (!chunks?.length) return { stale: true, reason: 'no_chunks' };
  if (!chunksMatchSourceContent(chunks, source)) {
    return { stale: true, reason: 'content_hash_mismatch' };
  }
  return { stale: false };
}

export async function ensureTranscriptChunksForSource(source, context = {}) {
  const text = String(source.rawText || '');
  const existing = await listResearchChunksForSource(source.id);
  const regen = shouldRegenerateChunks(source, existing, context);

  if (!regen.stale) {
    return { chunks: existing, regenerated: false, reason: null };
  }

  const planned = chunkTextForResearch(text).map((c) => ({
    ...c,
    sourceContentHash: source.contentHash,
    chunkingPolicyVersion: RACE_RESEARCH_CHUNKING_POLICY_VERSION,
  }));

  const validation = validatePlannedChunkSet(planned, {
    sourceContentHash: source.contentHash,
    rawTextLength: text.length,
  });
  if (!validation.valid) {
    throw Object.assign(new Error(`Invalid chunk plan: ${validation.errors.join('; ')}`), {
      code: 'CHUNK_VALIDATION_FAILED',
    });
  }

  const backup = existing;
  try {
    if (backup.length) {
      await deleteChunksForSource(source.id);
    }
    const inserted = await insertResearchChunks(source.id, planned, RACE_RESEARCH_EXTRACTION_VERSION, {
      sourceContentHash: source.contentHash,
      chunkingPolicyVersion: RACE_RESEARCH_CHUNKING_POLICY_VERSION,
    });
    return { chunks: inserted, regenerated: true, reason: regen.reason };
  } catch (error) {
    if (backup.length) {
      try {
        const restorePlan = backup.map((c) => ({
          chunkIndex: c.chunkIndex,
          startCharacter: c.startCharacter,
          endCharacter: c.endCharacter,
          chunkText: c.chunkText,
          sourceContentHash: c.sourceContentHash,
          chunkingPolicyVersion: c.chunkingPolicyVersion,
        }));
        await insertResearchChunks(source.id, restorePlan, RACE_RESEARCH_EXTRACTION_VERSION, {
          sourceContentHash: backup[0]?.sourceContentHash,
          chunkingPolicyVersion: backup[0]?.chunkingPolicyVersion,
        });
      } catch {
        // Best-effort restore; caller marks source failed.
      }
    }
    throw error;
  }
}
