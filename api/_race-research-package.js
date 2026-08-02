import { RACE_RESEARCH_PACKAGE_VERSION } from '../server/config/race-research-config.js';
import {
  buildSourceCoverageDiagnostics,
  computeCoverageScore,
  listMissingCoverageKeys,
} from './_race-research-coverage.js';
import {
  findOrphanRaceFacts,
  getRacePackageStatus,
  listRaceFactsForRace,
  listResearchSourcesForRace,
  upsertRacePackageStatus,
} from './_race-research-repository.js';
import { buildRaceDriverStoryPackages } from './_race-research-driver-stories.js';

export async function refreshRacePackageDiagnostics(seasonId, raceNumber) {
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const facts = await listRaceFactsForRace(seasonId, raceNumber);

  const eventCount = facts.filter((f) =>
    ['race_event', 'lead_change', 'caution', 'incident', 'penalty', 'strategy'].includes(f.factType)
  ).length;
  const quoteCount = facts.filter((f) => f.factType === 'quote').length;
  const conflictCount = facts.filter((f) => f.confidence === 'conflicting').length;

  const processedSourceCount = sources.filter((s) => s.processingStatus === 'complete').length;
  const partialCount = sources.filter((s) => s.processingStatus === 'partial').length;
  const failedCount = sources.filter(
    (s) =>
      s.processingStatus === 'failed' ||
      s.processingStatus === 'failed_without_previous_data'
  ).length;
  const failedWithPreviousCount = sources.filter(
    (s) => s.processingStatus === 'failed_with_previous_data'
  ).length;
  const staleCount = sources.filter((s) => s.sourceMetadata?.stale_reason || s.processingStatus === 'stale').length;
  const preservedCount = sources.filter((s) => s.sourceMetadata?.previous_facts_preserved === true).length;

  const orphans = await findOrphanRaceFacts(seasonId, raceNumber);

  let packageStatus = 'collecting';
  if (!sources.length) packageStatus = 'empty';
  else if (failedCount && !processedSourceCount && !failedWithPreviousCount) packageStatus = 'failed';
  else if (partialCount || failedCount || failedWithPreviousCount || staleCount) packageStatus = 'partial';
  else if (processedSourceCount === sources.length) packageStatus = 'ready';

  const sourceCoverage = buildSourceCoverageDiagnostics(sources);
  sourceCoverage._processing = {
    failedWithPreviousCount,
    preservedCount,
    staleCount,
    orphanFactCount: orphans.count,
  };

  const coverageScore = computeCoverageScore(sourceCoverage);

  return upsertRacePackageStatus({
    seasonId,
    raceNumber,
    packageVersion: RACE_RESEARCH_PACKAGE_VERSION,
    packageStatus,
    sourceCount: sources.length,
    processedSourceCount,
    factCount: facts.length,
    eventCount,
    quoteCount,
    conflictCount,
    coverageScore,
    sourceCoverage,
    lastBuiltAt: new Date().toISOString(),
  });
}

export async function buildRaceIntelligencePackage({ seasonId, raceNumber, includeRawExcerpts = false }) {
  const sources = await listResearchSourcesForRace(seasonId, raceNumber);
  const facts = await listRaceFactsForRace(seasonId, raceNumber);
  const status = (await getRacePackageStatus(seasonId, raceNumber)) || (await refreshRacePackageDiagnostics(seasonId, raceNumber));

  const sourceCoverage = status.sourceCoverage || buildSourceCoverageDiagnostics(sources);
  const timeline = facts
    .filter((f) => f.sequenceOrder != null || f.lapNumber != null)
    .sort((a, b) => (a.sequenceOrder ?? 0) - (b.sequenceOrder ?? 0))
    .map((f) => ({
      id: f.id,
      factType: f.factType,
      summary: f.summary,
      lapNumber: f.lapNumber,
      sequenceOrder: f.sequenceOrder,
      confidence: f.confidence,
    }));

  const results = facts.filter((f) => f.factType === 'result');
  const qualifying = facts.filter((f) => f.factType === 'qualifying');
  const standings = facts.filter((f) => f.factType === 'championship' && f.category === 'standings_snapshot');
  const derivedFacts = facts.filter((f) => f.structuredData?.derivationType);
  const conflicts = facts.filter((f) => f.confidence === 'conflicting');
  const verifiedQuotes = facts.filter((f) => f.factType === 'quote');
  const raceControlEvents = facts.filter((f) => f.category?.includes('race_control') || f.structuredData?.raw);
  const driverSummaries = buildRaceDriverStoryPackages({ racePackage: { facts } });

  const scheduleSource = sources.find((s) => s.sourceType === 'schedule');
  let raceMetadata = null;
  if (scheduleSource?.rawText) {
    try {
      raceMetadata = JSON.parse(scheduleSource.rawText);
    } catch {
      raceMetadata = null;
    }
  }

  const partialSources = sources.filter((s) => s.processingStatus === 'partial').map((s) => s.sourceType);
  const failedSources = sources.filter((s) => s.processingStatus === 'failed').map((s) => s.sourceType);
  const missingSources = listMissingCoverageKeys(sourceCoverage);

  return {
    identity: {
      seasonId: String(seasonId),
      raceNumber: Number(raceNumber),
      track: raceMetadata?.track || null,
      date: raceMetadata?.date || null,
      winner: raceMetadata?.winner || null,
    },
    sources: sources.map((s) => ({
      id: s.id,
      sourceType: s.sourceType,
      sourceKey: s.sourceKey,
      title: s.title,
      processingStatus: s.processingStatus,
      characterCount: s.characterCount,
      processingError: s.processingError,
      excerpt: includeRawExcerpts ? String(s.rawText || '').slice(0, 400) : undefined,
    })),
    raceMetadata,
    results,
    qualifying,
    standings,
    standingsChanges: standings.filter((f) => f.structuredData?.movement != null),
    timeline,
    facts,
    verifiedQuotes,
    raceControlEvents,
    driverSummaries,
    recentForm: [],
    historicalContext: facts.filter((f) => f.factType === 'historical'),
    sameTrackHistory: [],
    previousArticleContext: facts.filter((f) => f.category === 'previous_article'),
    derivedFacts,
    conflicts,
    packageStatus: status,
    diagnostics: {
      coverageScore: status.coverageScore,
      missingSources,
      partialSources,
      failedSources,
      unresolvedDrivers: [],
      factCount: facts.length,
      eventCount: timeline.length,
      quoteCount: verifiedQuotes.length,
      conflictCount: conflicts.length,
    },
  };
}

export function estimatePackagePromptTokens(racePackage) {
  const sample = JSON.stringify({
    facts: (racePackage.facts || []).slice(0, 80).map((f) => ({
      id: f.id,
      factType: f.factType,
      summary: f.summary,
      confidence: f.confidence,
    })),
    timeline: racePackage.timeline?.slice(0, 40),
    diagnostics: racePackage.diagnostics,
  });
  return Math.ceil(sample.length / 4);
}
