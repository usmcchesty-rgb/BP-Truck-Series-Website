/**
 * Deterministic transcript chunk preprocessing (labels only — not final narrative truth).
 */

const RACING_TERMS =
  /\b(caution|yellow|restart|green|white flag|checkered|lead change|side by side|pit road|pit stop|penalty|black flag|wreck|crash|incident|tight|battle|pass|inside|outside|draft|fuel|strategy|points|standings|championship|playoff)\b/i;

const FILLER_TERMS =
  /\b(subscribe|sponsor|commercial|break|welcome back|don't forget|promo|merchandise)\b/i;

const INTERVIEW_TERMS = /\b(post-race|interview|winner|podium|victory lane|media)\b/i;

const CAR_NUMBER_PATTERN = /\b(?:car|the)\s+#?\s*(\d{1,3})\b/gi;

export function preprocessTranscriptChunk(chunkText, options = {}) {
  const text = String(chunkText || '');
  const lower = text.toLowerCase();
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 8);

  let racingHits = 0;
  let fillerHits = 0;
  for (const sentence of sentences) {
    if (RACING_TERMS.test(sentence)) racingHits += 1;
    if (FILLER_TERMS.test(sentence)) fillerHits += 1;
  }

  const carNumbers = [];
  let match;
  while ((match = CAR_NUMBER_PATTERN.exec(text)) !== null) {
    const num = Number(match[1]);
    if (Number.isFinite(num)) carNumbers.push(num);
  }

  const informationDensity =
    racingHits >= 6 ? 'high' : racingHits >= 2 ? 'medium' : fillerHits > racingHits ? 'low' : 'medium';

  let racePhase = 'unknown';
  const positionRatio =
    options.chunkIndex != null && options.totalChunks > 1
      ? options.chunkIndex / (options.totalChunks - 1)
      : null;

  if (INTERVIEW_TERMS.test(lower) || (positionRatio != null && positionRatio > 0.92)) {
    racePhase = 'post-race';
  } else if (/\bgreen flag\b/i.test(lower) && positionRatio != null && positionRatio < 0.08) {
    racePhase = 'start';
  } else if (positionRatio != null) {
    if (positionRatio < 0.15) racePhase = 'early';
    else if (positionRatio < 0.45) racePhase = 'middle';
    else if (positionRatio < 0.85) racePhase = 'late';
    else racePhase = 'finish';
  }

  if (/\bpre-race|grid|anthem|driver introductions\b/i.test(lower)) racePhase = 'pre-race';

  const skipAiInHybrid = informationDensity === 'low' && racingHits === 0;

  return {
    racePhase,
    informationDensity,
    racingTermHits: racingHits,
    fillerHits,
    carNumbers: [...new Set(carNumbers)],
    driverNameCandidates: options.driverNameCandidates || [],
    sentenceCount: sentences.length,
    skipAiInHybrid,
    primaryTopics: [
      RACING_TERMS.test(lower) ? 'on-track-action' : null,
      INTERVIEW_TERMS.test(lower) ? 'interview' : null,
      /\bstandings|championship|points\b/i.test(lower) ? 'championship' : null,
    ].filter(Boolean),
  };
}

export function selectSampleChunkIndices(totalChunks, count = 7) {
  if (totalChunks <= 0) return [];
  if (totalChunks <= count) return [...Array(totalChunks).keys()];

  const targets = [0, 0.12, 0.35, 0.55, 0.75, 0.88, 0.97];
  const indices = new Set();
  for (const t of targets) {
    indices.add(Math.min(totalChunks - 1, Math.max(0, Math.round(t * (totalChunks - 1)))));
  }
  return [...indices].sort((a, b) => a - b).slice(0, count);
}
