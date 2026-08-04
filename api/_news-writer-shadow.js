import { computePackageFingerprint } from './_news-writer-fingerprint.js';
import { estimateOpenAiCostUsd } from '../server/config/news-writer-multipass-config.js';
import { buildRaceIntelligencePackage } from './_race-research-package.js';
import { selectEvidenceForArticle } from './_race-research-evidence.js';
import { buildNewsArticlePlan } from './_race-research-plan.js';
import { formatIntelligencePromptBlock } from './_race-research-handlers.js';
import { generateNewsArticle } from './_news-generator.js';
import { runMultipassWriterPipeline } from './_news-writer-orchestrator.js';
import { loadRaceResearchBootstrapContext } from './_race-research-sync.js';

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function tokenizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

export function takeawayCoverageScore(body, takeaways) {
  const text = String(body || '').toLowerCase();
  const list = takeaways || [];
  if (!list.length) return 100;
  let hit = 0;
  for (const t of list) {
    const tokens = tokenizeLabel(t.label);
    if (tokens.some((tok) => text.includes(tok))) hit += 1;
  }
  return Math.round((hit / list.length) * 1000) / 10;
}

export function validationScoreFromLegacy(validation) {
  if (!validation) return 0;
  if (validation.valid) return 100;
  const errors = validation.errors?.length || 0;
  const warnings = validation.warnings?.length || 0;
  return Math.max(0, 100 - errors * 12 - warnings * 4);
}

export function validationScoreFromMultipass(validation) {
  if (!validation) return 0;
  if (validation.ok) return 100;
  const errors = validation.errors?.length || 0;
  const warnings = validation.warnings?.length || 0;
  return Math.max(0, 100 - errors * 12 - warnings * 4);
}

export function buildArticleDifferences({ legacyArticle, multipassArticle, storyPlan, legacyValidation, multipassValidation }) {
  const legacyBody = String(legacyArticle?.body || '');
  const multiBody = String(multipassArticle?.body || '');
  const legacyLead = legacyBody.split(/\n\n+/)[0] || '';
  const multiLead = multiBody.split(/\n\n+/)[0] || '';

  const takeaways = storyPlan?.readerTakeaways || [];
  const legacyTakeaway = takeawayCoverageScore(legacyBody, takeaways);
  const multiTakeaway = takeawayCoverageScore(multiBody, takeaways);

  const missingRecapLegacy = (multipassValidation?.errors || [])
    .filter((e) => e.type === 'missing_required_recap')
    .map((e) => e.role);
  const missingRecapMulti = (multipassValidation?.errors || [])
    .filter((e) => e.type === 'missing_required_recap')
    .map((e) => e.role);

  return {
    headlineDiff: {
      legacy: legacyArticle?.headline || '',
      multipass: multipassArticle?.headline || '',
      changed: (legacyArticle?.headline || '') !== (multipassArticle?.headline || ''),
    },
    leadParagraphDiff: {
      legacy: legacyLead.slice(0, 600),
      multipass: multiLead.slice(0, 600),
      changed: legacyLead.trim() !== multiLead.trim(),
    },
    readerTakeawayCoverage: {
      legacyPercent: legacyTakeaway,
      multipassPercent: multiTakeaway,
    },
    validationWarnings: {
      legacy: (legacyValidation?.warnings || legacyValidation?.errors || []).slice(0, 8),
      multipass: (multipassValidation?.warnings || multipassValidation?.errors || []).slice(0, 8),
    },
    missingRecapFacts: {
      legacy: missingRecapLegacy,
      multipass: missingRecapMulti,
    },
    duplicateContentRisk: {
      legacyParagraphs: new Set(legacyBody.split(/\n\n+/).map((p) => p.slice(0, 60))).size,
      multipassParagraphs: new Set(multiBody.split(/\n\n+/).map((p) => p.slice(0, 60))).size,
    },
    storyOrderingNote:
      'Multipass follows deterministic outline section order; legacy uses single-pass narrative ordering.',
  };
}

export function buildComparisonMetrics({ legacyResult, multipassResult, packageFingerprint, storyPlan }) {
  const legacyArticle = legacyResult?.article || {};
  const multiArticle = multipassResult?.article || {};
  const legacyPrompt = legacyResult?.promptSize?.totalEstimatedTokens || legacyResult?.promptSize?.totalTokens || 0;
  const multiPrompt = multipassResult?.openAiUsage?.promptTokens || 0;
  const multiCompletion = multipassResult?.openAiUsage?.completionTokens || 0;

  return {
    packageFingerprint,
    packageFactCount: storyPlan ? undefined : undefined,
    legacy: {
      headline: legacyArticle.headline || '',
      wordCount: wordCount(legacyArticle.body),
      validationScore: validationScoreFromLegacy(legacyResult?.validation),
      openAiCalls: 1 + (legacyResult?.repairAttempts || 0),
      promptTokens: legacyPrompt,
      completionTokens: legacyResult?.promptSize?.outputEstimatedTokens || null,
      estimatedCostUsd: estimateOpenAiCostUsd({
        promptTokens: legacyPrompt,
        completionTokens: legacyResult?.promptSize?.outputEstimatedTokens || 800,
      }),
      generationTimeMs: legacyResult?.generationTimeMs || null,
      repairAttempts: legacyResult?.repairAttempts || 0,
      takeawayCoveragePercent: takeawayCoverageScore(legacyArticle.body, storyPlan?.readerTakeaways),
    },
    multipass: {
      headline: multiArticle.headline || multipassResult?.headlinePack?.headline || '',
      wordCount: wordCount(multiArticle.body),
      validationScore: validationScoreFromMultipass(multipassResult?.validation),
      canonicalCoveragePercent: multipassResult?.ledgerCoverageAfterWrite?.criticalCoveragePercent ?? null,
      openAiCalls: multipassResult?.openAiUsage?.calls || 0,
      promptTokens: multiPrompt,
      completionTokens: multiCompletion,
      estimatedCostUsd: estimateOpenAiCostUsd({
        promptTokens: multiPrompt,
        completionTokens: multiCompletion,
        model: multipassResult?.openAiUsage?.model,
      }),
      generationTimeMs: multipassResult?.openAiUsage?.elapsedMs || null,
      repairAttempts: multipassResult?.repairAttempted ? 1 : 0,
      sectionCount: multipassResult?.generatedSections?.length || 0,
      takeawayCoveragePercent: takeawayCoverageScore(
        multiArticle.body,
        storyPlan?.readerTakeaways || multipassResult?.deterministicPlan?.storyPlan?.readerTakeaways
      ),
      factsUsed: multipassResult?.ledgerCoverageAfterWrite?.factsUsed ?? null,
      depthCompliance: multipassResult?.depthCompliance || multipassResult?.validation?.depthCompliance || null,
      depthScore:
        multipassResult?.validation?.depthCompliance?.overallDepthScore ??
        multipassResult?.depthCompliance?.overallDepthScore ??
        null,
    },
  };
}

export async function runWriterShadowComparison({
  seasonId,
  raceNumber,
  articleType = 'race-recap',
  articleDepth = 'medium',
  manualNotes,
  callOpenAi,
  legacyGenerator = generateNewsArticle,
  multipassRunner = runMultipassWriterPipeline,
  racePackageOverride = null,
}) {
  const started = Date.now();
  const racePackage =
    racePackageOverride ||
    (await buildRaceIntelligencePackage({
      seasonId: String(seasonId),
      raceNumber: Number(raceNumber),
      includeRawExcerpts: true,
    }));
  const packageFingerprint = computePackageFingerprint(racePackage, seasonId, raceNumber);

  const evidence = selectEvidenceForArticle({ racePackage, articleType, articleDepth });
  const plan = buildNewsArticlePlan({ articleType, articleDepth, evidenceSelection: evidence });
  const pinnedPromptBlock = formatIntelligencePromptBlock(racePackage, evidence, plan);

  let previewDriverLookup = null;
  try {
    const ctx = await loadRaceResearchBootstrapContext(seasonId, raceNumber);
    previewDriverLookup = ctx.driverLookup;
  } catch {
    previewDriverLookup = null;
  }

  const legacyStarted = Date.now();
  const legacyResult = await legacyGenerator({
    articleType,
    raceNumber: Number(raceNumber),
    articleDepth,
    manualNotes,
    pinnedIntelligencePromptBlock: pinnedPromptBlock,
    pinnedPackageFingerprint: packageFingerprint,
    skipIntelligenceAutoLoad: true,
  });
  legacyResult.generationTimeMs = Date.now() - legacyStarted;

  const multiStarted = Date.now();
  const multipassResult = await multipassRunner({
    seasonId,
    raceNumber,
    articleType,
    articleDepth,
    driverLookup: previewDriverLookup,
    racePackageOverride: racePackage,
    callOpenAi,
    previewOnly: true,
    forceRun: true,
  });
  multipassResult.openAiUsage = {
    ...(multipassResult.openAiUsage || {}),
    elapsedMs: Date.now() - multiStarted,
  };

  const storyPlan = multipassResult.deterministicPlan?.storyPlan || multipassResult.storyPlan;
  const metrics = buildComparisonMetrics({
    legacyResult,
    multipassResult,
    packageFingerprint,
    storyPlan,
  });
  metrics.packageFactCount = racePackage.facts?.length || 0;

  const differences = buildArticleDifferences({
    legacyArticle: legacyResult.article,
    multipassArticle: multipassResult.article,
    storyPlan,
    legacyValidation: legacyResult.validation,
    multipassValidation: multipassResult.validation,
  });

  return {
    mode: 'shadow',
    packageFingerprint,
    packageFactCount: racePackage.facts?.length || 0,
    pinnedIntelligencePackage: true,
    legacy: legacyResult,
    multipass: multipassResult,
    comparison: metrics,
    differences,
    totalElapsedMs: Date.now() - started,
  };
}
