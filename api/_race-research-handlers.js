import { getSettings } from './_lib.js';
import { isNewsIntelligencePackageEnabled } from '../server/config/race-research-config.js';
import { ingestRaceResearchSource, listRaceResearchSummary } from './_race-research-ingest.js';
import { processResearchSource } from './_race-research-process.js';
import {
  buildRaceIntelligencePackage,
  refreshRacePackageDiagnostics,
} from './_race-research-package.js';
import { syncAutomaticRaceResearchSources, loadRaceResearchBootstrapContext } from './_race-research-sync.js';
import {
  findResearchSourceByIdentity,
  listRaceFactsForRace,
  listResearchSourcesForRace,
} from './_race-research-repository.js';
import { formatResearchQualityReport, assessArticleReadiness } from './_race-research-readiness.js';
import { runDiagnoseQuality } from './_race-research-diagnose.js';
import { selectEvidenceForArticle } from './_race-research-evidence.js';
import { buildNewsArticlePlan } from './_race-research-plan.js';
import { buildDeterministicArticlePlan } from './_news-writer-deterministic-plan.js';
import {
  createResearchOperationId,
  logResearchOperation,
  researchErrorResponse,
} from './_race-research-log.js';
import {
  assertResearchDatabaseReady,
  getResearchConfigStatus,
  handleResearchConflictsAdmin,
  handleResearchContinueProcessing,
  handleResearchDbCheck,
  handleResearchDriverStoriesAdmin,
  handleResearchFactsFiltered,
  handleResearchOverview,
  handleResearchQuotesAdmin,
  handleResearchRebuildEstimate,
  handleResearchRebuildPackage,
  handleResearchSourcesDetail,
  handleResearchStatusReadOnly,
  handleResearchSyncAdmin,
  handleResearchTimelineAdmin,
  handleResearchCanonicalAdmin,
  handleResearchSourceHistoryAdmin,
  handleResearchRollbackSourceAdmin,
  RESEARCH_MIGRATION_HINT,
  resolveResearchAllowAi,
} from './_race-research-admin-api.js';
import { runDiagnoseEvidence } from './_race-research-diagnose.js';

function parseRaceBody(body) {
  const seasonId = body.seasonId ?? body.season_id ?? null;
  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    return { error: 'Valid raceNumber is required.', status: 400 };
  }
  return { raceNumber, seasonId };
}

async function resolveSeasonId(seasonId) {
  if (seasonId) return String(seasonId);
  const settings = await getSettings();
  return String(settings.seasonId || '27987');
}

function wrapResearchHandler(fn) {
  return async (body) => {
    const opId = createResearchOperationId();
    const started = Date.now();
    try {
      const parsed = parseRaceBody(body);
      if (parsed.error) return { ...parsed, data: { operationId: opId } };
      const seasonId = await resolveSeasonId(parsed.seasonId);
      const data = await fn(seasonId, parsed.raceNumber, body);
      logResearchOperation({
        opId,
        action: body.action,
        seasonId,
        raceNumber: parsed.raceNumber,
        durationMs: Date.now() - started,
        status: 'ok',
      });
      return { status: 200, data: { ...data, operationId: opId } };
    } catch (error) {
      logResearchOperation({
        opId,
        action: body.action,
        durationMs: Date.now() - started,
        status: 'error',
        error: error.message,
      });
      const status = error.status || 500;
      return {
        status,
        error: error.message || 'Research request failed.',
        code: error.code,
        operationId: opId,
        migrationHint: error.code === 'MIGRATION_REQUIRED' ? RESEARCH_MIGRATION_HINT : undefined,
      };
    }
  };
}

export async function handleResearchStatus(body) {
  return wrapResearchHandler(async (seasonId, raceNumber) => {
    const overview = await handleResearchStatusReadOnly(seasonId, raceNumber);
    return {
      enabled: isNewsIntelligencePackageEnabled(),
      ...overview,
      diagnostics: {
        coverageScore: overview.coverageScore,
        factCount: overview.factCount,
        eventCount: overview.timelineEventCount,
        quoteCount: overview.quoteCount,
        conflictCount: overview.conflictCount,
        missingSources: overview.missingSources,
      },
      sources: overview.sourcesSummary,
      config: getResearchConfigStatus(),
    };
  })(body);
}

export async function handleResearchDbCheckAction(body) {
  const opId = createResearchOperationId();
  try {
    const result = await handleResearchDbCheck();
    return result;
  } catch (error) {
    return researchErrorResponse(error.message, opId, error.status || 500);
  }
}

export const handleResearchSync = wrapResearchHandler(handleResearchSyncAdmin);
export const handleResearchSources = wrapResearchHandler(handleResearchSourcesDetail);
export const handleResearchFacts = wrapResearchHandler(handleResearchFactsFiltered);
export const handleResearchTimeline = wrapResearchHandler(handleResearchTimelineAdmin);
export const handleResearchQuotes = wrapResearchHandler(handleResearchQuotesAdmin);
export const handleResearchDriverStories = wrapResearchHandler(handleResearchDriverStoriesAdmin);
export const handleResearchConflicts = wrapResearchHandler(handleResearchConflictsAdmin);
export const handleResearchRebuildEstimateAction = wrapResearchHandler(handleResearchRebuildEstimate);

export async function handleRebuildPackage(body) {
  const opId = createResearchOperationId();
  const started = Date.now();
  try {
    const parsed = parseRaceBody(body);
    if (parsed.error) return parsed;
    const seasonId = await resolveSeasonId(parsed.seasonId);
    const data = await handleResearchRebuildPackage(seasonId, parsed.raceNumber, body, opId);
    return { status: 200, data: { ...data, operationId: opId } };
  } catch (error) {
    logResearchOperation({
      opId,
      action: 'rebuild-package',
      durationMs: Date.now() - started,
      status: 'error',
      error: error.message,
    });
    return {
      status: error.status || 500,
      error: error.message,
      code: error.code,
      operationId: opId,
      migrationHint: error.code === 'MIGRATION_REQUIRED' ? RESEARCH_MIGRATION_HINT : undefined,
    };
  }
}

export async function handleResearchContinue(body) {
  return wrapResearchHandler(handleResearchContinueProcessing)(body);
}

export async function handleResearchCanonical(body) {
  return wrapResearchHandler(handleResearchCanonicalAdmin)(body);
}

export async function handleResearchSourceHistory(body) {
  return wrapResearchHandler(handleResearchSourceHistoryAdmin)(body);
}

export async function handleResearchRollbackSourceVersion(body) {
  return wrapResearchHandler(handleResearchRollbackSourceAdmin)(body);
}

export async function handleIngestSource(body) {
  try {
    const parsed = parseRaceBody(body);
    if (parsed.error) return parsed;
    await assertResearchDatabaseReady();
    const seasonId = await resolveSeasonId(parsed.seasonId);
    const ctx = await loadRaceResearchBootstrapContext(seasonId, parsed.raceNumber);

    const result = await ingestRaceResearchSource(
      {
        seasonId,
        raceNumber: parsed.raceNumber,
        sourceType: body.sourceType ?? body.source_type,
        sourceKey: body.sourceKey ?? body.source_key,
        title: body.title,
        rawText: body.rawText ?? body.raw_text,
        sourceUrl: body.sourceUrl ?? body.source_url,
        metadata: body.metadata,
      },
      {
        driverLookup: ctx.driverLookup,
        forceLargeSource: body.forceLargeSource === true,
        reprocess: body.reprocess === true,
        allowAi: resolveResearchAllowAi(body),
      }
    );

    return { status: 200, data: result };
  } catch (error) {
    return {
      status: error.status || 500,
      error: error.message || 'Ingest failed.',
      code: error.code,
    };
  }
}

export async function handleProcessSource(body) {
  try {
    const sourceId = body.sourceId ?? body.source_id;
    if (!sourceId) return { error: 'sourceId is required.', status: 400 };

    const parsed = parseRaceBody(body);
    if (parsed.error) return parsed;
    await assertResearchDatabaseReady();
    const seasonId = await resolveSeasonId(parsed.seasonId);
    const ctx = await loadRaceResearchBootstrapContext(seasonId, parsed.raceNumber);

    const sources = await listResearchSourcesForRace(seasonId, parsed.raceNumber);
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return { error: 'Source not found for race.', status: 404 };

    const result = await processResearchSource(source, {
      seasonId,
      raceNumber: parsed.raceNumber,
      driverLookup: ctx.driverLookup,
      forceLargeSource: body.forceLargeSource === true,
      reprocess: true,
      allowAi: resolveResearchAllowAi(body),
    });

    return { status: 200, data: result };
  } catch (error) {
    return {
      status: error.status || 500,
      error: error.message || 'Process source failed.',
    };
  }
}

export async function handleRetrySource(body) {
  body.reprocess = true;
  return handleProcessSource(body);
}

export async function handleListFacts(body) {
  return handleResearchFacts(body);
}

export async function handleListConflicts(body) {
  return handleResearchConflicts(body);
}

export async function handleResearchQuality(body) {
  return wrapResearchHandler(async (seasonId, raceNumber) => {
    const quality = await runDiagnoseQuality(seasonId, raceNumber);
    return quality;
  })(body);
}

export async function handleResearchPreview(body) {
  return wrapResearchHandler(async (seasonId, raceNumber, reqBody) => {
    const articleType = String(reqBody.articleType ?? reqBody.article_type ?? 'race-recap');
    const articleDepth = reqBody.articleDepth ?? reqBody.article_depth ?? 'medium';
    const pkg = await buildRaceIntelligencePackage({ seasonId, raceNumber });
    const evidence = selectEvidenceForArticle({ racePackage: pkg, articleType, articleDepth });
    const plan = buildNewsArticlePlan({ articleType, articleDepth, evidenceSelection: evidence });
    const deterministicPlan = buildDeterministicArticlePlan({
      racePackage: pkg,
      seasonId,
      raceNumber,
      articleType,
      articleDepth,
    });
    const allDepths = await runDiagnoseEvidence(seasonId, raceNumber);
    return {
      articleDepth,
      diagnostics: pkg.diagnostics,
      evidence,
      plan,
      deterministicPlan,
      samePackage: {
        factCount: pkg.facts?.length ?? 0,
        message: 'Short, Medium, and In-Depth previews use the same stored Race Intelligence Package.',
      },
      allDepths: allDepths.byDepth,
    };
  })(body);
}

export async function loadIntelligenceSupplementForNews(options = {}) {
  if (!isNewsIntelligencePackageEnabled()) {
    return null;
  }

  try {
    const seasonId = await resolveSeasonId(options.seasonId);
    const raceNumber = Number(options.raceNumber);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) return null;

    let pkg = await buildRaceIntelligencePackage({ seasonId, raceNumber });
    if (!pkg.facts?.length && options.autoRebuild !== false) {
      await syncAutomaticRaceResearchSources(seasonId, raceNumber, {
        manualNotes: options.manualNotes,
        includeYoutube: false,
        allowAi: false,
      });
      pkg = await buildRaceIntelligencePackage({ seasonId, raceNumber });
    }

    const evidence = selectEvidenceForArticle({
      racePackage: pkg,
      articleType: options.articleType || 'race-recap',
      articleDepth: options.articleDepth || 'medium',
    });
    const plan = buildNewsArticlePlan({
      articleType: options.articleType || 'race-recap',
      articleDepth: options.articleDepth || 'medium',
      evidenceSelection: evidence,
    });

    return {
      packageDiagnostics: pkg.diagnostics,
      evidence,
      plan,
      promptBlock: formatIntelligencePromptBlock(pkg, evidence, plan),
    };
  } catch (error) {
    console.warn('[race-research] supplement failed — falling back to legacy context', error.message);
    return { error: error.message, fallback: true };
  }
}

function formatIntelligencePromptBlock(pkg, evidence, plan) {
  const factLines = (evidence.selectedFacts || []).map(
    (f) => `- [${f.confidence}] (${f.factType}) ${f.summary} {factId:${f.id}}`
  );
  const quoteLines = (evidence.selectedQuotes || []).map(
    (q) => `- Quote {factId:${q.id}}: ${q.summary}`
  );

  return [
    'Race Intelligence Package (verified evidence — prefer official confidence over broadcast):',
    `Coverage score: ${pkg.diagnostics?.coverageScore ?? 0}%`,
    `Primary story plan: ${plan.primaryStory}`,
    '',
    'Selected facts:',
    factLines.join('\n') || '(none)',
    '',
    'Selected quotes:',
    quoteLines.join('\n') || '(none)',
    '',
    'Use fact IDs internally for consistency; do not print factId tokens in the published article.',
  ].join('\n');
}

export async function findResearchSource(seasonId, raceNumber, sourceType, sourceKey) {
  return findResearchSourceByIdentity(seasonId, raceNumber, sourceType, sourceKey);
}
