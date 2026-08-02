import { normalizeArticleDepth, ARTICLE_DEPTH_EVIDENCE_GUIDELINES, getRaceResearchTranscriptMode, isRaceResearchAiExtractionEnabled } from '../server/config/race-research-config.js';
import { buildRaceDriverStoryPackages } from './_race-research-driver-stories.js';
import {
  buildTranscriptCoverageSummary,
  labelForTranscriptSourceType,
  processingStatusLabel,
  resolveTranscriptSources,
} from './_race-research-transcript-coverage.js';

const IN_DEPTH_CATEGORIES = [
  { key: 'winner_story', test: (f) => f.category === 'winner' || f.structuredData?.finishPosition === 1 },
  { key: 'main_challenger', test: (f) => f.factType === 'result' && (f.structuredData?.finishPosition === 2 || f.structuredData?.finishPosition === 3) },
  { key: 'race_deciding_sequence', test: (f) => ['lead_change', 'caution', 'strategy'].includes(f.factType) && (f.importanceScore || 0) >= 55 },
  { key: 'chronological_progression', test: (f) => f.sequenceOrder != null || f.lapNumber != null },
  { key: 'cautions_restarts', test: (f) => f.factType === 'caution' || f.category === 'restart' },
  { key: 'strategy', test: (f) => f.factType === 'strategy' },
  { key: 'penalties_race_control', test: (f) => f.factType === 'penalty' || f.category?.includes('race_control') },
  { key: 'biggest_gainer', test: (f) => f.category === 'biggest_gainer' },
  { key: 'major_recovery', test: (f) => f.category === 'recovery' || f.structuredData?.storylineType === 'recovery' },
  { key: 'championship_leader', test: (f) => f.category === 'points_leader' || (f.factType === 'championship' && f.structuredData?.position === 1) },
  { key: 'championship_mover', test: (f) => f.factType === 'championship' && f.structuredData?.movement != null && f.structuredData.movement !== 0 },
  { key: 'driver_stories', test: (f) => f.category === 'driver_story' || f.factType === 'trend' },
  { key: 'verified_quotes', test: (f) => f.factType === 'quote' },
  { key: 'historical_comparison', test: (f) => f.factType === 'historical' },
  { key: 'looking_ahead', test: (f) => f.category === 'schedule_metadata' || f.factType === 'championship' },
];

export function assessArticleReadiness(racePackage, articleDepth = 'medium') {
  const depth = normalizeArticleDepth(articleDepth);
  const facts = racePackage?.facts || [];
  const diagnostics = racePackage?.diagnostics || {};
  const sources = racePackage?.sources || [];

  const transcriptSource = resolveTranscriptSources(sources).active;
  const transcriptComplete =
    transcriptSource?.processingStatus === 'complete' || transcriptSource?.processingStatus === 'partial';
  const transcriptFailed =
    transcriptSource?.processingStatus === 'failed' ||
    transcriptSource?.processingStatus === 'failed_without_previous_data';
  const hasResults = facts.some((f) => f.category === 'official_finish');
  const hasStandings = facts.some((f) => f.category === 'standings_snapshot');
  const hasRaceControl = sources.some((s) => s.sourceType === 'race_control' && s.processingStatus === 'complete');
  const timelineQuality = facts.filter((f) => f.sequenceOrder != null || f.lapNumber != null).length;
  const driverStories = buildRaceDriverStoryPackages({ racePackage }).filter((d) => d.availableEvidenceCount >= 2);
  const quotes = facts.filter((f) => f.factType === 'quote');
  const conflicts = facts.filter((f) => f.confidence === 'conflicting').length;
  const failedChunks = sources.some((s) => s.processingError) || transcriptFailed;

  const missing = [];
  if (!hasResults) missing.push('official_results');
  if (!hasStandings) missing.push('standings');
  if (!transcriptComplete) missing.push('processed_transcript');
  if (depth === 'in-depth') {
    if (timelineQuality < 8) missing.push('complete_late_race_timeline');
    if (driverStories.length < 6) missing.push('multiple_driver_stories');
    if (!hasRaceControl) missing.push('race_control_events');
    if (conflicts > 0 && !missing.includes('unresolved_conflicts')) missing.push('unresolved_conflicts');
    if (failedChunks) missing.push('failed_transcript_chunks');
  }

  let status = 'Ready';
  if (missing.length >= 3 || !hasResults) status = 'Not Ready';
  else if (missing.length > 0) status = depth === 'in-depth' ? 'Partial' : 'Ready';

  if (depth === 'short' && hasResults && hasStandings) status = 'Ready';

  return {
    articleDepth: depth,
    status,
    missing,
    metrics: {
      transcriptComplete,
      hasResults,
      hasStandings,
      hasRaceControl,
      timelineFactCount: timelineQuality,
      driverStoryCount: driverStories.length,
      quoteCount: quotes.length,
      conflicts,
      coverageScore: diagnostics.coverageScore ?? 0,
      failedChunks,
    },
  };
}

export function formatResearchQualityReport({ seasonId, raceNumber, racePackage, processingStats = {} }) {
  const sources = racePackage?.sources || [];
  const facts = racePackage?.facts || [];
  const lines = [];
  lines.push(`Race ${raceNumber} Research Quality (Season ${seasonId})`, '');

  const transcriptCoverage = buildTranscriptCoverageSummary(sources, processingStats, {
    transcriptProcessingMode: getRaceResearchTranscriptMode(),
    aiTranscriptExtraction: isRaceResearchAiExtractionEnabled(),
  });

  lines.push('Transcript Coverage', '-------------------');
  lines.push(`Status: ${transcriptCoverage.coverageLabel}`);
  if (transcriptCoverage.hasTranscript) {
    lines.push(`Source: ${labelForTranscriptSourceType(transcriptCoverage.activeSourceType)} (active)`);
    for (const alt of transcriptCoverage.alternates) {
      lines.push(`${alt.label}: ${alt.processingLabel} (available, not active)`);
    }
    lines.push(`Processing status: ${transcriptCoverage.processingLabel}`);
    if (transcriptCoverage.characterCount != null) {
      lines.push(`Characters: ${transcriptCoverage.characterCount.toLocaleString('en-US')}`);
    }
    lines.push(`Chunks: ${transcriptCoverage.chunkTotal || '—'}`);
    lines.push(`Processing: ${transcriptCoverage.processingSummary}`);
    lines.push(`Extraction: ${transcriptCoverage.extraction}`);
    lines.push(`AI: ${transcriptCoverage.aiExtraction}`);
  } else {
    lines.push('No saved or YouTube transcript is ingested for this race.');
  }

  lines.push('', 'Other Sources', '---------------');
  for (const type of ['race_control', 'official_results', 'standings', 'schedule']) {
    const src = sources.find((s) => s.sourceType === type);
    const label = processingStatusLabel(src ? src.processingStatus : 'missing');
    const name = type.replace(/_/g, ' ');
    lines.push(`${name}: ${label}`);
  }

  lines.push('', 'Processing (active transcript)', '------------------------------');
  lines.push(`Transcript chunks: ${processingStats.chunkTotal ?? '—'}`);
  lines.push(`Successful: ${processingStats.chunkComplete ?? '—'}`);
  lines.push(`Failed: ${processingStats.chunkFailed ?? '—'}`);
  lines.push(`AI processed chunks: ${processingStats.aiProcessed ?? '—'}`);
  lines.push(`Deterministic only: ${processingStats.deterministicOnly ?? '—'}`);

  lines.push('', 'Evidence', '--------');
  lines.push(`Race events: ${facts.filter((f) => ['race_event', 'lead_change', 'caution', 'incident'].includes(f.factType)).length}`);
  lines.push(`Driver stories: ${buildRaceDriverStoryPackages({ racePackage }).length}`);
  lines.push(`Verified quotes: ${facts.filter((f) => f.factType === 'quote').length}`);
  lines.push(`Official facts: ${facts.filter((f) => f.confidence === 'official').length}`);
  lines.push(`Broadcast facts: ${facts.filter((f) => f.confidence === 'broadcast_reported').length}`);
  lines.push(`Derived facts: ${facts.filter((f) => f.structuredData?.derivationType).length}`);
  lines.push(`Conflicts: ${facts.filter((f) => f.confidence === 'conflicting').length}`);
  lines.push(`Unresolved drivers: ${processingStats.unresolvedDrivers ?? 0}`);

  lines.push('', 'Article Readiness', '-----------------');
  for (const depth of ['short', 'medium', 'in-depth']) {
    const r = assessArticleReadiness(racePackage, depth);
    lines.push(`${depth[0].toUpperCase()}${depth.slice(1)}: ${r.status}`);
    if (depth === 'in-depth' && r.missing.length) {
      lines.push('In-Depth missing:');
      for (const m of r.missing) lines.push(`- ${m.replace(/_/g, ' ')}`);
    }
  }

  return lines.join('\n');
}

export function categoryCoverageForFacts(facts) {
  const available = [];
  const selected = [];
  for (const cat of IN_DEPTH_CATEGORIES) {
    if (facts.some(cat.test)) available.push(cat.key);
  }
  return { requiredCategories: IN_DEPTH_CATEGORIES.map((c) => c.key), availableCategories: available, selectedCategories: selected, missingCategories: IN_DEPTH_CATEGORIES.map((c) => c.key).filter((k) => !available.includes(k)) };
}

export function assessQuotePublicationReadiness(quoteRow = {}) {
  const quoteText = String(quoteRow.quote || '').trim();
  const completeness = quoteRow.completeness || quoteRow.quoteCompleteness || 'uncertain';
  const speaker = quoteRow.speaker || quoteRow.speakerRaw || '';
  const speakerUnresolved = !speaker || /unknown|unidentified/i.test(speaker);

  let publicationReadiness = 'not_recommended';
  let publicationLabel = 'Not recommended for publication';

  if (speakerUnresolved) {
    publicationLabel = 'Unresolved speaker';
  } else if (completeness === 'complete' && quoteText.length >= 20) {
    publicationReadiness = 'ready';
    publicationLabel = 'Complete';
  } else if (completeness === 'partial' && quoteText.length >= 12) {
    publicationReadiness = 'partial';
    publicationLabel = 'Partial';
  } else if (completeness === 'uncertain') {
    publicationReadiness = 'uncertain';
    publicationLabel = 'Uncertain';
  }

  return {
    speakerResolutionSucceeded: !speakerUnresolved,
    publicationReadiness,
    publicationLabel,
  };
}

export { IN_DEPTH_CATEGORIES, ARTICLE_DEPTH_EVIDENCE_GUIDELINES };
