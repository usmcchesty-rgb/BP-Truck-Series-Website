import { supabase } from './_lib.js';
import { loadNewsGenerationContext } from './_news-generator.js';
import { syncAutomaticRaceResearchSources, loadRaceResearchBootstrapContext } from './_race-research-sync.js';
import { buildRaceIntelligencePackage, refreshRacePackageDiagnostics } from './_race-research-package.js';
import {
  checkResearchTablesExist,
  getRacePackageStatus,
  listFactSourceJoinsForRace,
  listResearchChunksForSource,
  listResearchSourcesForRace,
} from './_race-research-repository.js';
import { selectEvidenceForArticle } from './_race-research-evidence.js';
import { detectTimelineIssues } from './_race-research-consolidate.js';
import { buildRaceDriverStoryPackages } from './_race-research-driver-stories.js';
import {
  assessArticleReadiness,
  formatResearchQualityReport,
} from './_race-research-readiness.js';
import { listMissingCoverageKeys, buildSourceCoverageDiagnostics } from './_race-research-coverage.js';
import { extractTranscriptChunkDeterministic, extractTranscriptChunkWithAi, compareExtractions } from './_race-research-transcript-extract.js';
import { preprocessTranscriptChunk, selectSampleChunkIndices } from './_race-research-transcript-preprocess.js';
import { getRaceResearchTranscriptMode, isNewsIntelligencePackageEnabled } from '../server/config/race-research-config.js';

export function parseDiagnoseArgs(argv) {
  const args = argv.slice(2);
  let raceNumber = 15;
  const modes = new Set();
  let allowAi = false;

  for (const arg of args) {
    if (arg === '--allow-ai') allowAi = true;
    else if (arg.startsWith('--')) modes.add(arg.slice(2));
    else if (/^\d+$/.test(arg)) raceNumber = Number(arg);
  }

  if (!modes.size) modes.add('full');
  return { raceNumber, modes, allowAi };
}

async function resolveSeasonAndRace(raceNumber) {
  const ctx = await loadNewsGenerationContext({ raceNumber, articleType: 'race-recap' });
  return { seasonId: String(ctx.settings?.seasonId || '27987'), raceNumber, legacyContext: ctx };
}

export async function runDiagnoseStatus(seasonId, raceNumber) {
  const tables = await checkResearchTablesExist();
  const status = await getRacePackageStatus(seasonId, raceNumber);
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);

  const factByType = {};
  const factByConfidence = {};
  for (const f of facts) {
    factByType[f.factType] = (factByType[f.factType] || 0) + 1;
    factByConfidence[f.confidence] = (factByConfidence[f.confidence] || 0) + 1;
  }

  let chunkStats = { total: 0, complete: 0, failed: 0, ai: 0, deterministic: 0 };
  const transcript = sources.find((s) => ['youtube_transcript', 'saved_transcript'].includes(s.sourceType));
  if (transcript) {
    const chunks = await listResearchChunksForSource(transcript.id);
    chunkStats.total = chunks.length;
    chunkStats.complete = chunks.filter((c) => c.processingStatus === 'complete').length;
    chunkStats.failed = chunks.filter((c) => c.processingStatus === 'failed').length;
    chunkStats.ai = chunks.filter((c) => String(c.extractionMethod || '').includes('ai')).length;
    chunkStats.deterministic = chunks.filter((c) => c.extractionMethod === 'deterministic').length;
  }

  const coverage = buildSourceCoverageDiagnostics(sources);

  return {
    mode: 'status',
    migration: tables,
    intelligenceFlag: isNewsIntelligencePackageEnabled(),
    transcriptMode: getRaceResearchTranscriptMode(),
    packageStatus: status,
    sources: sources.map((s) => ({
      type: s.sourceType,
      key: s.sourceKey,
      hash: s.contentHash?.slice(0, 12),
      status: s.processingStatus,
      chars: s.characterCount,
      error: s.processingError,
    })),
    chunks: chunkStats,
    factCounts: { total: facts.length, byType: factByType, byConfidence: factByConfidence },
    missingSourceTypes: listMissingCoverageKeys(coverage),
    coverageScore: status?.coverageScore ?? 0,
    linkCount: links.length,
    sourceByIdCount: Object.keys(sourceById).length,
  };
}

export async function runDiagnoseSync(seasonId, raceNumber, options = {}) {
  const bootstrap = await loadRaceResearchBootstrapContext(seasonId, raceNumber);
  const sync = await syncAutomaticRaceResearchSources(seasonId, raceNumber, {
    includeYoutube: options.includeYoutube !== false,
    forceLargeSource: options.forceLargeSource === true,
    transcriptExtractor: extractTranscriptChunkDeterministic,
    allowAi: false,
  });
  await refreshRacePackageDiagnostics(seasonId, raceNumber);
  return { mode: 'sync', warnings: sync.warnings, ingested: sync.ingested.length, skippedAi: true };
}

export async function runDiagnoseFacts(seasonId, raceNumber) {
  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const linkCountByFact = {};
  for (const l of links) {
    linkCountByFact[l.fact_id] = (linkCountByFact[l.fact_id] || 0) + 1;
  }

  const rows = facts.slice(0, 200).map((f) => {
    const factLinks = links.filter((l) => l.fact_id === f.id);
    const types = [...new Set(factLinks.map((l) => sourceById[l.source_id]?.sourceType).filter(Boolean))];
    return {
      id: f.id,
      factType: f.factType,
      category: f.category,
      summary: f.summary.slice(0, 140),
      drivers: (f.driverNames || []).slice(0, 3).join(', '),
      lap: f.lapNumber,
      importance: f.importanceScore,
      confidence: f.confidence,
      sources: linkCountByFact[f.id] || 0,
      sourceTypes: types,
      conflict: f.confidence === 'conflicting',
    };
  });

  return { mode: 'facts', count: facts.length, rows };
}

export async function runDiagnoseTimeline(seasonId, raceNumber) {
  const { facts, links, sourceById } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const withLinks = facts.map((f) => ({
    ...f,
    evidenceLinks: links
      .filter((l) => l.fact_id === f.id)
      .map((l) => ({ sourceId: l.source_id, chunkId: l.chunk_id })),
  }));

  const issues = detectTimelineIssues(withLinks, sourceById);
  const ordered = [...facts]
    .filter((f) => ['race_event', 'lead_change', 'caution', 'incident', 'penalty', 'strategy'].includes(f.factType))
    .sort((a, b) => (a.sequenceOrder ?? 9999) - (b.sequenceOrder ?? 9999) || (a.lapNumber ?? 9999) - (b.lapNumber ?? 9999))
    .slice(0, 80)
    .map((f) => ({
      id: f.id,
      seq: f.sequenceOrder,
      lap: f.lapNumber,
      type: f.factType,
      confidence: f.confidence,
      summary: f.summary.slice(0, 120),
    }));

  return { mode: 'timeline', ordered, issues };
}

export async function runDiagnoseQuotes(seasonId, raceNumber) {
  const { facts, links } = await listFactSourceJoinsForRace(seasonId, raceNumber);
  const quotes = facts.filter((f) => f.factType === 'quote').map((f) => {
    const link = links.find((l) => l.fact_id === f.id);
    return {
      id: f.id,
      speaker: f.structuredData?.speakerRaw || f.structuredData?.speaker,
      quote: f.structuredData?.quote || f.summary,
      completeness: f.structuredData?.quoteCompleteness,
      confidence: f.confidence,
      charRange: link
        ? [link.source_start_character, link.source_end_character]
        : null,
      excerpt: link?.source_excerpt?.slice(0, 100) || null,
      publicationReady: f.structuredData?.quoteCompleteness === 'complete' && (f.structuredData?.quote || '').length > 20,
    };
  });
  return { mode: 'quotes', count: quotes.length, quotes };
}

export async function runDiagnoseEvidence(seasonId, raceNumber) {
  const pkg = await buildRaceIntelligencePackage({ seasonId, raceNumber });
  const depths = ['short', 'medium', 'in-depth'];
  const byDepth = {};
  for (const depth of depths) {
    const ev = selectEvidenceForArticle({ racePackage: pkg, articleType: 'race-recap', articleDepth: depth });
    byDepth[depth] = {
      selectedFactCount: ev.selectedFacts.length,
      timelineEvents: ev.selectedTimelineEvents.length,
      drivers: ev.featuredDriverCount,
      quotes: ev.selectedQuotes.length,
      historical: ev.selectedHistory.length,
      championship: ev.selectedChampionshipFacts.length,
      estimatedTokens: ev.estimatedTokens,
      omittedHighPriority: ev.omittedHighPriorityFacts,
      categoryCoverage: ev.categoryCoverage,
      confidenceDistribution: ev.confidenceDistribution,
      samePackageFactCount: ev.samePackageFactCount,
    };
  }
  return { mode: 'evidence', byDepth };
}

export async function runDiagnoseCompareExtractors(seasonId, raceNumber, allowAi) {
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const transcript = sources.find((s) => ['youtube_transcript', 'saved_transcript'].includes(s.sourceType));
  if (!transcript?.rawText && !transcript?.id) {
    return { mode: 'compare-extractors', error: 'No transcript source — run --sync first' };
  }

  let chunks = transcript.id ? await listResearchChunksForSource(transcript.id) : [];
  if (!chunks.length && transcript.rawText) {
    chunks = [{ chunkIndex: 0, chunkText: transcript.rawText.slice(0, 12000) }];
  }

  const sampleIndices = selectSampleChunkIndices(chunks.length, 7);
  const samples = [];

  for (const idx of sampleIndices) {
    const chunk = chunks[idx];
    if (!chunk) continue;
    const preprocess = preprocessTranscriptChunk(chunk.chunkText, { chunkIndex: idx, totalChunks: chunks.length });
    const deterministic = extractTranscriptChunkDeterministic(chunk.chunkText, preprocess);

    let ai = null;
    let aiSkipped = true;
    if (allowAi) {
      aiSkipped = false;
      ai = await extractTranscriptChunkWithAi(chunk.chunkText, { preprocess, allowAi: true });
    }

    samples.push({
      chunkIndex: idx,
      informationDensity: preprocess.informationDensity,
      deterministic: compareExtractions(deterministic, ai || { events: [], quotes: [] }).deterministic,
      ai: ai ? compareExtractions(deterministic, ai).ai : null,
      aiSkipped,
    });
  }

  const summary = {
    deterministic: {
      factsFound: samples.reduce((s, x) => s + x.deterministic.factsFound, 0),
      note: 'Keyword/heuristic — strong on explicit cautions/lead mentions; weak on narrative context',
    },
    ai: allowAi
      ? { factsFound: samples.reduce((s, x) => s + (x.ai?.factsFound || 0), 0), estimatedRequests: samples.length }
      : { skipped: true, message: 'Re-run with --allow-ai to perform paid comparison' },
    recommendedProductionMode: allowAi ? 'hybrid (pending manual review of sample)' : 'undetermined — run with --allow-ai',
  };

  return { mode: 'compare-extractors', allowAi, sampleCount: samples.length, samples, summary };
}

export async function runDiagnoseQuality(seasonId, raceNumber) {
  const pkg = await buildRaceIntelligencePackage({ seasonId, raceNumber });
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const transcript = sources.find((s) => ['youtube_transcript', 'saved_transcript'].includes(s.sourceType));
  let chunkStats = {};
  if (transcript?.id) {
    const chunks = await listResearchChunksForSource(transcript.id);
    chunkStats = {
      chunkTotal: chunks.length,
      chunkComplete: chunks.filter((c) => c.processingStatus === 'complete').length,
      chunkFailed: chunks.filter((c) => c.processingStatus === 'failed').length,
      aiProcessed: chunks.filter((c) => String(c.extractionMethod || '').includes('ai')).length,
      deterministicOnly: chunks.filter((c) => c.extractionMethod === 'deterministic').length,
    };
  }

  const text = formatResearchQualityReport({ seasonId, raceNumber, racePackage: pkg, processingStats: chunkStats });
  return { mode: 'quality', report: text, readiness: {
    short: assessArticleReadiness(pkg, 'short'),
    medium: assessArticleReadiness(pkg, 'medium'),
    inDepth: assessArticleReadiness(pkg, 'in-depth'),
  } };
}

export async function runDiagnoseFull(seasonId, raceNumber, options) {
  const parts = {};
  parts.status = await runDiagnoseStatus(seasonId, raceNumber);
  if (options.sync !== false) parts.sync = await runDiagnoseSync(seasonId, raceNumber, options);
  parts.facts = await runDiagnoseFacts(seasonId, raceNumber);
  parts.timeline = await runDiagnoseTimeline(seasonId, raceNumber);
  parts.quotes = await runDiagnoseQuotes(seasonId, raceNumber);
  parts.evidence = await runDiagnoseEvidence(seasonId, raceNumber);
  parts.quality = await runDiagnoseQuality(seasonId, raceNumber);
  parts.compare = await runDiagnoseCompareExtractors(seasonId, raceNumber, options.allowAi);
  return { mode: 'full', parts };
}

export async function runDiagnoseModes(parsed) {
  if (!supabase()) {
    return { error: 'Supabase not configured', modes: [...parsed.modes] };
  }

  const { seasonId, raceNumber } = await resolveSeasonAndRace(parsed.raceNumber);
  const out = { raceNumber, seasonId, results: [] };

  for (const mode of parsed.modes) {
    switch (mode) {
      case 'status':
        out.results.push(await runDiagnoseStatus(seasonId, raceNumber));
        break;
      case 'sync':
        out.results.push(await runDiagnoseSync(seasonId, raceNumber, { forceLargeSource: true }));
        break;
      case 'facts':
        out.results.push(await runDiagnoseFacts(seasonId, raceNumber));
        break;
      case 'timeline':
        out.results.push(await runDiagnoseTimeline(seasonId, raceNumber));
        break;
      case 'quotes':
        out.results.push(await runDiagnoseQuotes(seasonId, raceNumber));
        break;
      case 'evidence':
        out.results.push(await runDiagnoseEvidence(seasonId, raceNumber));
        break;
      case 'compare-extractors':
        out.results.push(await runDiagnoseCompareExtractors(seasonId, raceNumber, parsed.allowAi));
        break;
      case 'quality':
        out.results.push(await runDiagnoseQuality(seasonId, raceNumber));
        break;
      case 'full':
        out.results.push(await runDiagnoseFull(seasonId, raceNumber, parsed));
        break;
      default:
        out.results.push({ error: `Unknown mode: ${mode}` });
    }
  }

  return out;
}
