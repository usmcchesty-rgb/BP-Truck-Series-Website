import { getRaceResearchTranscriptMode, isRaceResearchAiExtractionEnabled } from '../server/config/race-research-config.js';

/** Priority order: saved transcript wins when both exist (matches sync ingest behavior). */
export const TRANSCRIPT_SOURCE_TYPE_PRIORITY = ['saved_transcript', 'youtube_transcript'];

export function labelForTranscriptSourceType(sourceType) {
  if (sourceType === 'saved_transcript') return 'Saved Transcript';
  if (sourceType === 'youtube_transcript') return 'YouTube Transcript';
  return String(sourceType || '').replace(/_/g, ' ');
}

export function resolveTranscriptSources(sources = []) {
  const saved = sources.filter((s) => s.sourceType === 'saved_transcript');
  const youtube = sources.filter((s) => s.sourceType === 'youtube_transcript');
  const active =
    saved.find((s) => s.processingStatus === 'complete' || s.processingStatus === 'partial') ||
    saved[0] ||
    youtube.find((s) => s.processingStatus === 'complete' || s.processingStatus === 'partial') ||
    youtube[0] ||
    null;

  return {
    saved,
    youtube,
    active,
    hasAny: saved.length > 0 || youtube.length > 0,
  };
}

function statusRank(status) {
  const order = {
    missing: 0,
    failed: 1,
    stale: 1,
    partial: 2,
    available: 3,
    complete: 4,
    pending: 2,
    processing: 2,
  };
  return order[status] ?? 0;
}

export function processingStatusLabel(status) {
  if (status === 'complete') return 'Complete';
  if (status === 'partial') return 'Partial';
  if (!status || status === 'missing') return 'Missing';
  if (status === 'failed' || status === 'failed_without_previous_data') return 'Failed';
  if (status === 'failed_with_previous_data') return 'Failed (prior data preserved)';
  return String(status).replace(/_/g, ' ');
}

/**
 * Unified transcript coverage for Overview / Research Quality (reporting only).
 */
export function buildTranscriptCoverageSummary(sources = [], processingStats = {}, config = {}) {
  const { saved, youtube, active, hasAny } = resolveTranscriptSources(sources);
  const transcriptMode = config.transcriptProcessingMode ?? getRaceResearchTranscriptMode();
  const aiEnabled = config.aiTranscriptExtraction ?? isRaceResearchAiExtractionEnabled();

  if (!hasAny) {
    return {
      hasTranscript: false,
      coverageStatus: 'missing',
      coverageLabel: 'No Transcript Available',
      activeSourceType: null,
      activeSourceLabel: null,
      processingStatus: 'missing',
      processingLabel: 'Missing',
      characterCount: null,
      chunkTotal: processingStats.chunkTotal ?? 0,
      chunkComplete: processingStats.chunkComplete ?? 0,
      chunkFailed: processingStats.chunkFailed ?? 0,
      processingSummary: '—',
      extraction: transcriptMode,
      aiExtraction: aiEnabled ? 'Enabled' : 'Disabled',
      alternates: [],
    };
  }

  const processingStatus = active?.processingStatus || 'missing';
  let coverageStatus = 'missing';
  if (processingStatus === 'complete') coverageStatus = 'complete';
  else if (['partial', 'processing', 'pending'].includes(processingStatus)) coverageStatus = 'partial';
  else if (statusRank(processingStatus) >= statusRank('available')) coverageStatus = 'partial';

  const chunkTotal = processingStats.chunkTotal ?? 0;
  const chunkComplete = processingStats.chunkComplete ?? 0;
  const chunkFailed = processingStats.chunkFailed ?? 0;
  const processingSummary =
    chunkTotal > 0 ? `${chunkComplete}/${chunkTotal} successful` : processingStatusLabel(processingStatus);

  const alternates = [];
  for (const src of [...saved, ...youtube]) {
    if (!src || src.id === active?.id) continue;
    alternates.push({
      sourceType: src.sourceType,
      label: labelForTranscriptSourceType(src.sourceType),
      processingStatus: src.processingStatus,
      processingLabel: processingStatusLabel(src.processingStatus),
      role: 'available',
    });
  }

  let coverageLabel = 'Partial';
  if (coverageStatus === 'complete') coverageLabel = 'Complete';
  if (coverageStatus === 'missing') coverageLabel = 'No Transcript Available';

  return {
    hasTranscript: true,
    coverageStatus,
    coverageLabel,
    activeSourceType: active?.sourceType ?? null,
    activeSourceLabel: active ? `${labelForTranscriptSourceType(active.sourceType)} (active)` : null,
    processingStatus,
    processingLabel: processingStatusLabel(processingStatus),
    characterCount: active?.characterCount ?? null,
    chunkTotal,
    chunkComplete,
    chunkFailed,
    processingSummary,
    extraction: transcriptMode,
    aiExtraction: aiEnabled ? 'Enabled' : 'Disabled',
    alternates,
  };
}

export const COVERAGE_KEY_LABELS = {
  officialResults: 'Official results',
  standings: 'Standings',
  qualifying: 'Qualifying',
  transcript: 'Transcript coverage',
  raceControl: 'Race control',
  historicalResults: 'Historical results',
  driverStats: 'Driver stats',
  scheduleMetadata: 'Schedule metadata',
  previousArticles: 'Previous articles',
  manualNotes: 'Manual notes',
  derivedFacts: 'Derived facts',
};

/** Hide transcript from "missing" lists when an active saved/YouTube source satisfies coverage. */
export function filterDisplayMissingCoverageKeys(missingKeys = [], sources = []) {
  const summary = buildTranscriptCoverageSummary(sources);
  return missingKeys.filter((key) => {
    if (key !== 'transcript') return true;
    if (summary.coverageStatus === 'complete' || summary.coverageStatus === 'partial') return false;
    return true;
  });
}

export function formatCoverageKeyLabel(key) {
  return COVERAGE_KEY_LABELS[key] || String(key).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
}
