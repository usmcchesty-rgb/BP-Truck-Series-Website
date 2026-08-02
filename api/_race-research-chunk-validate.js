import {
  RACE_RESEARCH_CHUNKING_POLICY_VERSION,
  TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS,
  TRANSCRIPT_CHUNK_TARGET_CHARACTERS,
} from '../server/config/race-research-config.js';

/**
 * Validate a planned chunk set before persisting.
 */
export function validatePlannedChunkSet(planned, { sourceContentHash, rawTextLength = 0 } = {}) {
  const errors = [];
  const chunks = planned || [];

  if (rawTextLength > 0 && chunks.length === 0) {
    errors.push('Non-empty source requires at least one chunk.');
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    if (c.chunkIndex !== i) {
      errors.push(`Expected chunkIndex ${i}, got ${c.chunkIndex}.`);
    }
    if (!String(c.chunkText || '').length && rawTextLength > 0) {
      errors.push(`Chunk ${i} is empty.`);
    }
    const start = c.startCharacter ?? 0;
    const end = c.endCharacter ?? 0;
    if (end < start && c.chunkText?.length) {
      errors.push(`Chunk ${i} has invalid character range.`);
    }
  }

  if (chunks.length > 1) {
    const overlap = TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS;
    const maxOverlap = overlap * 2 + 500;
    for (let i = 1; i < chunks.length; i += 1) {
      const prev = chunks[i - 1];
      const curr = chunks[i];
      const gap = (curr.startCharacter ?? 0) - (prev.endCharacter ?? 0);
      if (gap > maxOverlap) {
        errors.push(`Large gap between chunk ${i - 1} and ${i}.`);
      }
    }
  }

  if (sourceContentHash && chunks.length) {
    for (const c of chunks) {
      if (c.sourceContentHash && c.sourceContentHash !== sourceContentHash) {
        errors.push('Chunk parent hash mismatch in planned set.');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function chunksMatchSourceContent(chunks, source) {
  const sourceHash = String(source?.contentHash || '');
  if (!sourceHash) return false;
  if (!chunks?.length) return false;

  for (const chunk of chunks) {
    const parent = chunk.sourceContentHash;
    if (!parent) return false;
    if (parent !== sourceHash) return false;
    if (chunk.chunkingPolicyVersion && chunk.chunkingPolicyVersion !== RACE_RESEARCH_CHUNKING_POLICY_VERSION) {
      return false;
    }
  }

  const indexes = chunks.map((c) => c.chunkIndex ?? -1).sort((a, b) => a - b);
  for (let i = 0; i < indexes.length; i += 1) {
    if (indexes[i] !== i) return false;
  }

  return true;
}

export function getChunkingPolicyFingerprint() {
  return {
    version: RACE_RESEARCH_CHUNKING_POLICY_VERSION,
    targetChars: TRANSCRIPT_CHUNK_TARGET_CHARACTERS,
    overlapChars: TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS,
  };
}
