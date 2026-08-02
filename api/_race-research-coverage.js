import { RACE_RESEARCH_COVERAGE_WEIGHTS } from '../server/config/race-research-config.js';

const SOURCE_TYPE_TO_COVERAGE_KEY = {
  official_results: 'officialResults',
  qualifying: 'qualifying',
  standings: 'standings',
  youtube_transcript: 'transcript',
  saved_transcript: 'transcript',
  race_control: 'raceControl',
  historical_results: 'historicalResults',
  schedule: 'scheduleMetadata',
  manual_notes: 'manualNotes',
  previous_article: 'previousArticles',
  driver_profiles: 'driverStats',
};

export function buildSourceCoverageDiagnostics(sources = []) {
  const byKey = {};
  for (const [key] of Object.entries(RACE_RESEARCH_COVERAGE_WEIGHTS)) {
    byKey[key] = { status: 'missing', weight: RACE_RESEARCH_COVERAGE_WEIGHTS[key] };
  }

  for (const source of sources) {
    const coverageKey = SOURCE_TYPE_TO_COVERAGE_KEY[source.sourceType] || null;
    if (!coverageKey) continue;

    let status = 'available';
    if (source.processingStatus === 'complete') status = 'complete';
    else if (source.processingStatus === 'partial') status = 'partial';
    else if (source.processingStatus === 'failed') status = 'failed';
    else if (source.processingStatus === 'stale') status = 'stale';
    else if (source.processingStatus === 'pending' || source.processingStatus === 'processing') {
      status = 'partial';
    }

    const prev = byKey[coverageKey];
    if (!prev || rankStatus(status) > rankStatus(prev.status)) {
      byKey[coverageKey] = { status, weight: RACE_RESEARCH_COVERAGE_WEIGHTS[coverageKey], sourceType: source.sourceType };
    }
  }

  return byKey;
}

function rankStatus(status) {
  const order = { missing: 0, failed: 1, stale: 1, partial: 2, available: 3, complete: 4 };
  return order[status] ?? 0;
}

export function computeCoverageScore(sourceCoverage) {
  const weights = RACE_RESEARCH_COVERAGE_WEIGHTS;
  let earned = 0;
  let total = 0;

  for (const [key, weight] of Object.entries(weights)) {
    total += weight;
    const entry = sourceCoverage?.[key];
    if (!entry) continue;
    if (entry.status === 'complete') earned += weight;
    else if (entry.status === 'partial') earned += weight * 0.45;
    else if (entry.status === 'available') earned += weight * 0.2;
  }

  if (!total) return 0;
  return Math.round((earned / total) * 1000) / 10;
}

export function listMissingCoverageKeys(sourceCoverage) {
  return Object.entries(sourceCoverage || {})
    .filter(([, entry]) => entry.status === 'missing' || entry.status === 'failed')
    .map(([key]) => key);
}
