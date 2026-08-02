import {
  TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS,
  TRANSCRIPT_CHUNK_TARGET_CHARACTERS,
} from '../server/config/race-research-config.js';

function findSentenceBoundary(text, index, direction) {
  const slice =
    direction > 0
      ? text.slice(index, Math.min(text.length, index + 400))
      : text.slice(Math.max(0, index - 400), index);
  const rel = direction > 0 ? slice.search(/[.!?]\s+/) : slice.search(/[.!?]\s+[^.!?]*$/);
  if (rel < 0) return index;
  return direction > 0 ? index + rel + 2 : index - (slice.length - rel) + 2;
}

/**
 * Split long text into overlapping chunks, preferring sentence boundaries.
 * @returns {Array<{ chunkIndex, startCharacter, endCharacter, chunkText, contentHash }>}
 */
export function chunkTextForResearch(text, options = {}) {
  const raw = String(text || '');
  const target = Number(options.targetChars) || TRANSCRIPT_CHUNK_TARGET_CHARACTERS;
  const overlap = Number(options.overlapChars) || TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS;

  if (!raw.trim()) return [];

  if (raw.length <= target) {
    return [
      {
        chunkIndex: 0,
        startCharacter: 0,
        endCharacter: raw.length,
        chunkText: raw,
      },
    ];
  }

  const chunks = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < raw.length) {
    let end = Math.min(raw.length, start + target);
    if (end < raw.length) {
      end = findSentenceBoundary(raw, end, -1);
      if (end <= start) end = Math.min(raw.length, start + target);
    }

    const chunkText = raw.slice(start, end);
    chunks.push({
      chunkIndex,
      startCharacter: start,
      endCharacter: end,
      chunkText,
    });

    if (end >= raw.length) break;

    const nextStart = Math.max(start + 1, end - overlap);
    start = findSentenceBoundary(raw, nextStart, 1);
    if (start >= end) start = nextStart;
    chunkIndex += 1;
  }

  return chunks;
}

export function shouldChunkSource(sourceType, characterCount) {
  const type = String(sourceType || '');
  const count = Number(characterCount) || 0;
  if (type === 'youtube_transcript' || type === 'saved_transcript') {
    return count > TRANSCRIPT_CHUNK_TARGET_CHARACTERS;
  }
  if (count > TRANSCRIPT_CHUNK_TARGET_CHARACTERS * 2) return true;
  return false;
}
