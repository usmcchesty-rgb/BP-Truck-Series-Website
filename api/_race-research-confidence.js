import { mergeFactConfidence } from './_race-research-processors.js';
const CONFIDENCE_RANK = {
  official: 7,
  officially_confirmed: 6,
  manual: 5,
  derived: 4,
  historical: 3,
  broadcast_reported: 2,
  unverified: 1,
  conflicting: 0,
};

export function evolveConfidence(current, incoming, meta = {}) {
  const historyEntry = {
    at: new Date().toISOString(),
    from: current,
    to: incoming,
    reason: meta.reason || 'evidence_added',
    sourceType: meta.sourceType || null,
  };

  if (current === 'conflicting' || incoming === 'conflicting') {
    return {
      currentConfidence: 'conflicting',
      historyEntry: { ...historyEntry, to: 'conflicting' },
    };
  }

  const merged = mergeFactConfidence(current, incoming);
  if (merged !== current) {
    return { currentConfidence: merged, historyEntry: { ...historyEntry, to: merged } };
  }
  return { currentConfidence: current, historyEntry: null };
}

export function confidenceFromSourceType(sourceType) {
  if (sourceType === 'official_results' || sourceType === 'qualifying') return 'official';
  if (sourceType === 'race_control') return 'officially_confirmed';
  if (sourceType === 'youtube_transcript' || sourceType === 'saved_transcript') return 'broadcast_reported';
  if (sourceType === 'manual_notes') return 'manual';
  if (sourceType === 'previous_article' || sourceType === 'historical_results') return 'historical';
  if (sourceType === 'other') return 'derived';
  return 'unverified';
}

export function combinedConfidenceFromEvidence(sourceTypes = []) {
  let best = 'unverified';
  for (const st of sourceTypes) {
    const c = confidenceFromSourceType(st);
    if ((CONFIDENCE_RANK[c] ?? 0) > (CONFIDENCE_RANK[best] ?? 0)) best = c;
  }
  if (sourceTypes.some((t) => t === 'race_control' || t === 'official_results') &&
      sourceTypes.some((t) => t === 'youtube_transcript' || t === 'saved_transcript')) {
    if (best !== 'conflicting' && (CONFIDENCE_RANK[best] ?? 0) < CONFIDENCE_RANK.officially_confirmed) {
      best = 'officially_confirmed';
    }
  }
  return best;
}

export { CONFIDENCE_RANK };
