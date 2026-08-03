import { NEWS_AUTHOR, NEWS_PROMPT_VERSION } from '../server/config/news-system-prompt.js';
import {
  NEWS_WRITER_MULTIPASS_VERSION,
  SECTION_WRITE_ORDER,
  estimateOpenAiCostUsd,
} from '../server/config/news-writer-multipass-config.js';
import { buildRaceIntelligencePackage } from './_race-research-package.js';
import { loadRaceResearchBootstrapContext } from './_race-research-sync.js';
import { buildDeterministicArticlePlan } from './_news-writer-deterministic-plan.js';
import { prepareFactsForPlanning } from './_news-writer-fact-quality.js';
import { computePackageFingerprint } from './_news-writer-fingerprint.js';
import { writeArticleSection } from './_news-writer-section-writer.js';
import { editArticle, rewriteOneSection } from './_news-writer-editor.js';
import { buildHeadlinePack } from './_news-writer-headline.js';
import { callOpenAiWriterJson } from './_news-writer-openai.js';
import {
  validateMultipassDraft,
  buildRepairHints,
} from './_news-writer-multipass-validation.js';
import {
  cloneLedger,
  applySectionDraftToLedger,
  ledgerCoverageSnapshot,
} from './_news-writer-ledger-writer.js';
import {
  createEmptySectionMemory,
  appendSectionMemory,
} from './_news-writer-section-memory.js';
import { selectEvidenceForArticle } from './_race-research-evidence.js';
import { buildNewsArticlePlan } from './_race-research-plan.js';
import { formatIntelligencePromptBlock } from './_race-research-handlers.js';
import { generateNewsArticle } from './_news-generator.js';
import {
  buildArticleDifferences,
  buildComparisonMetrics,
} from './_news-writer-shadow.js';
import {
  countOutlineSections,
  WRITER_RUN_MAX_OPENAI_CALLS_PER_REQUEST,
} from './_news-writer-cost-estimate.js';

function aggregateUsage(usages) {
  return usages.reduce(
    (acc, u) => {
      acc.promptTokens += u.promptTokens || 0;
      acc.completionTokens += u.completionTokens || 0;
      acc.totalTokens += u.totalTokens || 0;
      acc.calls += 1;
      return acc;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 }
  );
}

function allowedDriverNames(storyPlan, preparedFacts) {
  const names = new Set();
  for (const d of storyPlan.rankedDrivers || []) {
    if (d.displayName) names.add(d.displayName);
  }
  for (const f of preparedFacts) {
    for (const n of f.driverNames || []) names.add(n);
  }
  return [...names];
}

export function buildMultipassStepQueue(outline) {
  const byId = Object.fromEntries((outline?.sections || []).map((s) => [s.sectionId, s]));
  const steps = [];
  for (const sectionId of SECTION_WRITE_ORDER) {
    if (byId[sectionId]) steps.push(`section:${sectionId}`);
  }
  steps.push('editor', 'headline', 'validation');
  return steps;
}

export function buildShadowStepQueue(outline) {
  return ['shadow:legacy', ...buildMultipassStepQueue(outline), 'shadow:compare'];
}

function isStepComplete(completedSteps, step) {
  return (completedSteps || []).includes(step);
}

function markStepComplete(checkpoint, step) {
  if (!checkpoint.completedSteps) checkpoint.completedSteps = [];
  if (!checkpoint.completedSteps.includes(step)) checkpoint.completedSteps.push(step);
}

function nextPendingStep(checkpoint) {
  const queue = checkpoint.stepQueue || [];
  for (const step of queue) {
    if (!isStepComplete(checkpoint.completedSteps, step)) return step;
  }
  return null;
}

function pushUsage(checkpoint, usage) {
  if (!checkpoint.usageLog) checkpoint.usageLog = [];
  checkpoint.usageLog.push(usage || {});
}

function totalUsageFromCheckpoint(checkpoint) {
  return aggregateUsage(checkpoint.usageLog || []);
}

function sanitizeLegacyForCheckpoint(legacyResult) {
  if (!legacyResult) return null;
  return {
    article: legacyResult.article,
    validation: legacyResult.validation,
    generationTimeMs: legacyResult.generationTimeMs,
    repairAttempts: legacyResult.repairAttempts || 0,
    promptSize: legacyResult.promptSize
      ? {
          totalEstimatedTokens: legacyResult.promptSize.totalEstimatedTokens,
          totalTokens: legacyResult.promptSize.totalTokens,
          outputEstimatedTokens: legacyResult.promptSize.outputEstimatedTokens,
        }
      : null,
  };
}

export function createInitialCheckpoint({
  planResult,
  runType,
  manualNotes = '',
  stepQueue,
}) {
  return {
    v: 1,
    runType,
    manualNotes: String(manualNotes || ''),
    plannerVersion: planResult.storyPlan?.plannerVersion,
    operationId: planResult.storyPlan?.operationId,
    planResult: {
      storyPlan: planResult.storyPlan,
      outline: planResult.outline,
      factUsageLedger: planResult.factUsageLedger,
      requiredRecap: planResult.requiredRecap,
      coverageTargets: planResult.coverageTargets,
      temperature: planResult.temperature,
      readerTakeaways: planResult.readerTakeaways,
    },
    ledger: cloneLedger(planResult.factUsageLedger),
    sectionDrafts: [],
    sectionMemory: createEmptySectionMemory(),
    edited: null,
    headlinePack: null,
    validation: null,
    repairAttempted: false,
    legacyResult: null,
    stepQueue,
    completedSteps: [],
    usageLog: [],
    packageStale: false,
    startedAtMs: Date.now(),
  };
}

export async function loadRunPackageContext({
  seasonId,
  raceNumber,
  articleType,
  articleDepth,
  driverLookup = null,
}) {
  const racePackage = await buildRaceIntelligencePackage({
    seasonId: String(seasonId),
    raceNumber: Number(raceNumber),
    includeRawExcerpts: true,
  });
  let lookup = driverLookup;
  if (!lookup) {
    try {
      const ctx = await loadRaceResearchBootstrapContext(seasonId, raceNumber);
      lookup = ctx.driverLookup;
    } catch {
      lookup = null;
    }
  }
  const planResult = buildDeterministicArticlePlan({
    racePackage,
    seasonId: String(seasonId),
    raceNumber: Number(raceNumber),
    articleType,
    articleDepth,
    driverLookup: lookup,
  });
  const fingerprint = computePackageFingerprint(racePackage, seasonId, raceNumber);
  const preparedFacts = prepareFactsForPlanning(racePackage, lookup);
  return { racePackage, planResult, fingerprint, preparedFacts, driverLookup: lookup };
}

export function verifyRunPackageFingerprint({ storedFingerprint, liveFingerprint }) {
  if (!storedFingerprint || !liveFingerprint) return { ok: true };
  if (storedFingerprint === liveFingerprint) return { ok: true };
  return {
    ok: false,
    reason: 'package_stale',
    message:
      'Race Intelligence Package fingerprint changed since this run started. Continue is blocked to avoid mixing package versions.',
  };
}

function rebuildPlanFromCheckpoint(checkpoint) {
  return checkpoint.planResult;
}

function outlineByIdFromCheckpoint(checkpoint) {
  const outline = checkpoint.planResult?.outline;
  return Object.fromEntries((outline?.sections || []).map((s) => [s.sectionId, s]));
}

function buildMultipassPipelineResult(checkpoint, { seasonId, raceNumber, articleType, articleDepth }) {
  const planResult = rebuildPlanFromCheckpoint(checkpoint);
  const storyPlan = planResult.storyPlan;
  const edited = checkpoint.edited || {};
  const headlinePack = checkpoint.headlinePack || {};
  const usage = totalUsageFromCheckpoint(checkpoint);
  const elapsedMs = Date.now() - (checkpoint.startedAtMs || Date.now());
  const draft = {
    headline: headlinePack.headline || edited.headline,
    subheadline: headlinePack.subheadline || edited.subheadline,
    summary: edited.summary,
    body: edited.body,
  };
  return {
    phase: '3b-multipass-preview',
    multipassVersion: NEWS_WRITER_MULTIPASS_VERSION,
    plannerVersion: storyPlan.plannerVersion,
    previewOnly: true,
    deterministicPlan: planResult,
    generatedSections: checkpoint.sectionDrafts || [],
    editorialDraft: edited,
    headlinePack,
    validation: checkpoint.validation,
    repairAttempted: checkpoint.repairAttempted,
    factUsageLedgerAfterWrite: checkpoint.ledger,
    ledgerCoverageAfterWrite: ledgerCoverageSnapshot(checkpoint.ledger),
    openAiUsage: { ...usage, elapsedMs },
    article: draft,
    author: NEWS_AUTHOR,
    promptVersion: NEWS_PROMPT_VERSION,
    articleType,
    articleDepth: storyPlan.articleDepth || articleDepth,
    raceNumber: Number(raceNumber),
    seasonId: String(seasonId),
  };
}

function buildShadowResult(checkpoint, ctx) {
  const multipassResult = buildMultipassPipelineResult(checkpoint, ctx);
  const legacyResult = checkpoint.legacyResult;
  const storyPlan = checkpoint.planResult?.storyPlan;
  const metrics = buildComparisonMetrics({
    legacyResult,
    multipassResult,
    packageFingerprint: ctx.packageFingerprint,
    storyPlan,
  });
  metrics.packageFactCount = ctx.factCount;
  const differences = buildArticleDifferences({
    legacyArticle: legacyResult?.article,
    multipassArticle: multipassResult.article,
    storyPlan,
    legacyValidation: legacyResult?.validation,
    multipassValidation: multipassResult.validation,
  });
  return {
    mode: 'shadow',
    packageFingerprint: ctx.packageFingerprint,
    packageFactCount: ctx.factCount,
    pinnedIntelligencePackage: true,
    legacy: legacyResult,
    multipass: multipassResult,
    comparison: metrics,
    differences,
    totalElapsedMs: Date.now() - (checkpoint.startedAtMs || Date.now()),
  };
}

/**
 * Advance a writer run by up to maxOpenAiCalls OpenAI invocations (validation/compare steps are free).
 */
export async function advanceWriterRun(run, {
  maxOpenAiCalls = WRITER_RUN_MAX_OPENAI_CALLS_PER_REQUEST,
  writeArticleSectionFn = writeArticleSection,
  legacyGenerator = generateNewsArticle,
  persistRun = null,
  loadRunPackageContextFn = loadRunPackageContext,
  callOpenAi = callOpenAiWriterJson,
} = {}) {
  if (!run || !run.checkpoint) {
    throw new Error('Writer run checkpoint missing.');
  }
  if (run.status === 'cancelled') {
    return { run, done: true, cancelled: true };
  }
  if (run.status === 'complete') {
    return { run, done: true, result: run.result };
  }
  if (run.checkpoint.packageStale) {
    return {
      run,
      done: false,
      stale: true,
      message: run.errorMessage || 'Package fingerprint mismatch.',
    };
  }

  const checkpoint = run.checkpoint;
  const ctx = await loadRunPackageContextFn({
    seasonId: run.seasonId,
    raceNumber: run.raceNumber,
    articleType: run.articleType,
    articleDepth: run.articleDepth,
  });
  const fpCheck = verifyRunPackageFingerprint({
    storedFingerprint: run.packageFingerprint,
    liveFingerprint: ctx.fingerprint,
  });
  if (!fpCheck.ok) {
    checkpoint.packageStale = true;
    const updated = await persistRun?.({
      status: 'partial',
      errorMessage: fpCheck.message,
      checkpoint,
      currentStep: 'stale',
    });
    return {
      run: updated || run,
      done: false,
      stale: true,
      message: fpCheck.message,
    };
  }

  const planResult = rebuildPlanFromCheckpoint(checkpoint);
  const storyPlan = planResult.storyPlan;
  const outlineById = outlineByIdFromCheckpoint(checkpoint);
  let openAiBudget = maxOpenAiCalls;
  let tickOpenAiCalls = 0;

  const persist = async (patch) => {
    if (!persistRun) return run;
    run = await persistRun(patch);
    return run;
  };

  while (openAiBudget > 0) {
    const step = nextPendingStep(checkpoint);
    if (!step) break;

    if (step.startsWith('section:')) {
      const sectionId = step.slice('section:'.length);
      const section = outlineById[sectionId];
      if (!section) {
        markStepComplete(checkpoint, step);
        continue;
      }
      const draft = await writeArticleSectionFn({
        storyPlan,
        section,
        factUsageLedger: checkpoint.ledger,
        preparedFacts: ctx.preparedFacts,
        racePackage: ctx.racePackage,
        sectionMemory: checkpoint.sectionMemory,
        callOpenAi,
      });
      checkpoint.sectionDrafts.push(draft);
      appendSectionMemory(checkpoint.sectionMemory, draft);
      applySectionDraftToLedger(checkpoint.ledger, draft);
      pushUsage(checkpoint, draft.writerDiagnostics?.usage || {});
      markStepComplete(checkpoint, step);
      openAiBudget -= 1;
      tickOpenAiCalls += 1;
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step === 'editor') {
      const edited = await editArticle({
        sectionDrafts: checkpoint.sectionDrafts,
        storyPlan,
        outline: planResult.outline,
        requiredRecap: planResult.requiredRecap,
        callOpenAi,
      });
      checkpoint.edited = edited;
      pushUsage(checkpoint, edited.editorDiagnostics?.usage || {});
      markStepComplete(checkpoint, step);
      openAiBudget -= 1;
      tickOpenAiCalls += 1;
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step === 'headline') {
      const headlinePack = await buildHeadlinePack({
        editedArticle: checkpoint.edited,
        storyPlan,
        callOpenAi,
      });
      checkpoint.headlinePack = headlinePack;
      pushUsage(checkpoint, headlinePack.headlineDiagnostics?.usage || {});
      checkpoint.edited = {
        ...checkpoint.edited,
        headline: headlinePack.headline || checkpoint.edited.headline,
        subheadline: headlinePack.subheadline || checkpoint.edited.subheadline,
      };
      markStepComplete(checkpoint, step);
      openAiBudget -= 1;
      tickOpenAiCalls += 1;
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step === 'validation') {
      let validation = validateMultipassDraft({
        editedArticle: checkpoint.edited,
        headlinePack: checkpoint.headlinePack,
        storyPlan,
        requiredRecap: planResult.requiredRecap,
        ledgerSnapshot: ledgerCoverageSnapshot(checkpoint.ledger),
        coverageTargets: planResult.coverageTargets,
        allowedDriverNames: allowedDriverNames(storyPlan, ctx.preparedFacts),
      });
      checkpoint.validation = validation;

      if (!validation.ok && !checkpoint.repairAttempted) {
        checkpoint.repairAttempted = true;
        const rewriteId =
          checkpoint.edited?.rewriteSectionId || checkpoint.sectionDrafts[0]?.sectionId;
        const repairSteps = [];
        if (rewriteId) repairSteps.push(`repair:section:${rewriteId}`);
        repairSteps.push('repair:editor', 'repair:headline', 'validation:post-repair');
        checkpoint.stepQueue = [...(checkpoint.stepQueue || []), ...repairSteps];
        markStepComplete(checkpoint, step);
        await persist({
          checkpoint,
          currentStep: 'validation:repair-scheduled',
          stepsCompleted: (checkpoint.completedSteps || []).length,
        });
        continue;
      }

      markStepComplete(checkpoint, step);
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step === 'validation:post-repair') {
      const validation = validateMultipassDraft({
        editedArticle: checkpoint.edited,
        headlinePack: checkpoint.headlinePack,
        storyPlan,
        requiredRecap: planResult.requiredRecap,
        ledgerSnapshot: ledgerCoverageSnapshot(checkpoint.ledger),
        coverageTargets: planResult.coverageTargets,
        allowedDriverNames: allowedDriverNames(storyPlan, ctx.preparedFacts),
      });
      checkpoint.validation = validation;
      markStepComplete(checkpoint, step);
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step.startsWith('repair:section:')) {
      const sectionId = step.slice('repair:section:'.length);
      const section = outlineById[sectionId];
      const hints = buildRepairHints(checkpoint.validation);
      const idx = checkpoint.sectionDrafts.findIndex((s) => s.sectionId === sectionId);
      if (section && idx >= 0) {
        const redraft = await rewriteOneSection({
          sectionDraft: checkpoint.sectionDrafts[idx],
          storyPlan,
          section,
          preparedFacts: ctx.preparedFacts,
          racePackage: ctx.racePackage,
          sectionMemory: checkpoint.sectionMemory,
          repairReason: JSON.stringify(hints),
          writeArticleSectionFn,
          callOpenAi,
        });
        checkpoint.sectionDrafts[idx] = redraft;
        applySectionDraftToLedger(checkpoint.ledger, redraft);
        pushUsage(checkpoint, redraft.writerDiagnostics?.usage || {});
      }
      markStepComplete(checkpoint, step);
      openAiBudget -= 1;
      tickOpenAiCalls += 1;
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step === 'repair:editor') {
      const hints = buildRepairHints(checkpoint.validation);
      const edited = await editArticle({
        sectionDrafts: checkpoint.sectionDrafts,
        storyPlan,
        outline: planResult.outline,
        requiredRecap: planResult.requiredRecap,
        repairHints: hints,
        callOpenAi,
      });
      checkpoint.edited = edited;
      pushUsage(checkpoint, edited.editorDiagnostics?.usage || {});
      markStepComplete(checkpoint, step);
      openAiBudget -= 1;
      tickOpenAiCalls += 1;
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step === 'repair:headline') {
      const headlinePack = await buildHeadlinePack({
        editedArticle: checkpoint.edited,
        storyPlan,
        callOpenAi,
      });
      checkpoint.headlinePack = headlinePack;
      pushUsage(checkpoint, headlinePack.headlineDiagnostics?.usage || {});
      checkpoint.edited = {
        ...checkpoint.edited,
        headline: headlinePack.headline || checkpoint.edited.headline,
        subheadline: headlinePack.subheadline || checkpoint.edited.subheadline,
      };
      markStepComplete(checkpoint, step);
      openAiBudget -= 1;
      tickOpenAiCalls += 1;
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    if (step === 'shadow:legacy') {
      const evidence = selectEvidenceForArticle({
        racePackage: ctx.racePackage,
        articleType: run.articleType,
        articleDepth: run.articleDepth,
      });
      const plan = buildNewsArticlePlan({
        articleType: run.articleType,
        articleDepth: run.articleDepth,
        evidenceSelection: evidence,
      });
      const pinnedPromptBlock = formatIntelligencePromptBlock(ctx.racePackage, evidence, plan);
      const legacyStarted = Date.now();
      const legacyResult = await legacyGenerator({
        articleType: run.articleType,
        raceNumber: Number(run.raceNumber),
        articleDepth: run.articleDepth,
        manualNotes: checkpoint.manualNotes,
        pinnedIntelligencePromptBlock: pinnedPromptBlock,
        pinnedPackageFingerprint: ctx.fingerprint,
        skipIntelligenceAutoLoad: true,
      });
      legacyResult.generationTimeMs = Date.now() - legacyStarted;
      checkpoint.legacyResult = sanitizeLegacyForCheckpoint(legacyResult);
      markStepComplete(checkpoint, step);
      openAiBudget = 0;
      tickOpenAiCalls += 1;
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      break;
    }

    if (step === 'shadow:compare') {
      markStepComplete(checkpoint, step);
      await persist({
        checkpoint,
        currentStep: step,
        stepsCompleted: (checkpoint.completedSteps || []).length,
      });
      continue;
    }

    markStepComplete(checkpoint, step);
  }

  const pending = nextPendingStep(checkpoint);
  const usage = totalUsageFromCheckpoint(checkpoint);
  const elapsedMs = Date.now() - (checkpoint.startedAtMs || Date.now());
  const costUsd = estimateOpenAiCostUsd({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
  });

  if (!pending) {
    const pipelineCtx = {
      seasonId: run.seasonId,
      raceNumber: run.raceNumber,
      articleType: run.articleType,
      articleDepth: run.articleDepth,
      packageFingerprint: ctx.fingerprint,
      factCount: ctx.racePackage.facts?.length ?? 0,
    };
    const result =
      run.runType === 'shadow_compare'
        ? buildShadowResult(checkpoint, pipelineCtx)
        : buildMultipassPipelineResult(checkpoint, pipelineCtx);
    const updated = await persist({
      status: 'complete',
      result,
      checkpoint,
      currentStep: 'complete',
      stepsCompleted: (checkpoint.stepQueue || []).length,
      stepsTotal: (checkpoint.stepQueue || []).length,
      openaiCalls: usage.calls,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      estimatedCostUsd: costUsd,
      elapsedMs,
      completedAt: new Date().toISOString(),
    });
    return { run: updated || run, done: true, result, tickOpenAiCalls };
  }

  const updated = await persist({
    status: 'partial',
    checkpoint,
    currentStep: pending,
    stepsCompleted: (checkpoint.completedSteps || []).length,
    stepsTotal: (checkpoint.stepQueue || []).length,
    openaiCalls: usage.calls,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    estimatedCostUsd: costUsd,
    elapsedMs,
  });
  return {
    run: updated || run,
    done: false,
    tickOpenAiCalls,
    nextStep: pending,
    progress: buildRunProgress(updated || run),
  };
}

export function buildRunProgress(run) {
  const cp = run.checkpoint || {};
  const queue = cp.stepQueue || [];
  const completed = cp.completedSteps || [];
  const sectionSteps = queue.filter((s) => s.startsWith('section:'));
  const sectionsDone = sectionSteps.filter((s) => completed.includes(s)).length;
  const usage = totalUsageFromCheckpoint(cp);
  return {
    runId: run.id,
    status: run.status,
    runType: run.runType,
    currentStep: run.currentStep,
    stepsCompleted: completed.length,
    stepsTotal: queue.length,
    sectionsCompleted: sectionsDone,
    sectionsTotal: sectionSteps.length,
    packageFingerprint: run.packageFingerprint,
    plannerVersion: cp.plannerVersion,
    packageStale: !!cp.packageStale,
    openAiUsage: usage,
    estimatedCostUsd: run.estimatedCostUsd,
    elapsedMs: run.elapsedMs,
    completedStepIds: completed,
  };
}

export function publicRunStatus(run) {
  if (!run) return null;
  return {
    ...buildRunProgress(run),
    seasonId: run.seasonId,
    raceNumber: run.raceNumber,
    articleDepth: run.articleDepth,
    articleType: run.articleType,
    errorMessage: run.errorMessage,
    hasResult: run.status === 'complete' && !!run.result,
    estimateSectionCount: countOutlineSections(run.checkpoint?.planResult?.outline),
  };
}

export async function initializeAndPersistRun({
  runType,
  seasonId,
  raceNumber,
  articleType,
  articleDepth,
  manualNotes,
  estimatedCostUsd,
  createRun,
  updateRun,
}) {
  const ctx = await loadRunPackageContext({
    seasonId,
    raceNumber,
    articleType,
    articleDepth,
  });
  const stepQueue =
    runType === 'shadow_compare'
      ? buildShadowStepQueue(ctx.planResult.outline)
      : buildMultipassStepQueue(ctx.planResult.outline);
  const checkpoint = createInitialCheckpoint({
    planResult: ctx.planResult,
    runType,
    manualNotes,
    stepQueue,
  });
  const run = await createRun({
    runType,
    seasonId,
    raceNumber,
    articleType,
    articleDepth,
    packageFingerprint: ctx.fingerprint,
    currentStep: stepQueue[0] || 'init',
    stepsTotal: stepQueue.length,
    checkpoint,
    estimatedCostUsd,
  });
  return { run, ctx };
}
