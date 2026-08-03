import { NEWS_AUTHOR, NEWS_PROMPT_VERSION } from '../server/config/news-system-prompt.js';
import {
  isNewsWriterMultipassEnabled,
  NEWS_WRITER_MULTIPASS_VERSION,
  SECTION_WRITE_ORDER,
} from '../server/config/news-writer-multipass-config.js';
import { buildRaceIntelligencePackage } from './_race-research-package.js';
import { loadRaceResearchBootstrapContext } from './_race-research-sync.js';
import { getSettings } from './_lib.js';
import { buildDeterministicArticlePlan } from './_news-writer-deterministic-plan.js';
import { prepareFactsForPlanning } from './_news-writer-fact-quality.js';
import { writeArticleSection } from './_news-writer-section-writer.js';
import { editArticle, rewriteOneSection } from './_news-writer-editor.js';
import { buildHeadlinePack } from './_news-writer-headline.js';
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

export { isNewsWriterMultipassEnabled };

async function resolveSeasonId(seasonId) {
  if (seasonId) return String(seasonId);
  const settings = await getSettings();
  return String(settings.seasonId || '27987');
}

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

/**
 * Phase 3b multi-pass writer — draft only, no publish.
 */
export async function runMultipassWriterPipeline({
  seasonId,
  raceNumber,
  articleType = 'race-recap',
  articleDepth = 'medium',
  driverLookup = null,
  callOpenAi,
  writeArticleSectionFn = writeArticleSection,
  previewOnly = true,
  racePackageOverride = null,
  forceRun = false,
}) {
  if (!isNewsWriterMultipassEnabled() && !callOpenAi && !forceRun) {
    throw new Error('NEWS_WRITER_MULTIPASS_ENABLED is false.');
  }

  const started = Date.now();
  const resolvedSeason = await resolveSeasonId(seasonId);
  let racePackage = racePackageOverride;
  if (!racePackage) {
    racePackage = await buildRaceIntelligencePackage({
      seasonId: resolvedSeason,
      raceNumber: Number(raceNumber),
      includeRawExcerpts: true,
    });
  }

  let previewDriverLookup = driverLookup;
  if (!previewDriverLookup) {
    try {
      const ctx = await loadRaceResearchBootstrapContext(resolvedSeason, raceNumber);
      previewDriverLookup = ctx.driverLookup;
    } catch {
      previewDriverLookup = null;
    }
  }

  const planResult = buildDeterministicArticlePlan({
    racePackage,
    seasonId: resolvedSeason,
    raceNumber: Number(raceNumber),
    articleType,
    articleDepth,
    driverLookup: previewDriverLookup,
  });

  const preparedFacts = prepareFactsForPlanning(racePackage, previewDriverLookup);
  const storyPlan = planResult.storyPlan;
  const outline = planResult.outline;
  let ledger = cloneLedger(planResult.factUsageLedger);
  const sectionMemory = createEmptySectionMemory();
  const sectionDrafts = [];
  const openAiUsages = [];

  const outlineById = Object.fromEntries((outline.sections || []).map((s) => [s.sectionId, s]));

  for (const sectionId of SECTION_WRITE_ORDER) {
    const section = outlineById[sectionId];
    if (!section) continue;

    const draft = await writeArticleSectionFn({
      storyPlan,
      section,
      factUsageLedger: ledger,
      preparedFacts,
      racePackage,
      sectionMemory,
      callOpenAi,
    });
    sectionDrafts.push(draft);
    appendSectionMemory(sectionMemory, draft);
    applySectionDraftToLedger(ledger, draft);
    openAiUsages.push(draft.writerDiagnostics?.usage || {});
  }

  let edited = await editArticle({
    sectionDrafts,
    storyPlan,
    outline,
    requiredRecap: planResult.requiredRecap,
    callOpenAi,
  });
  openAiUsages.push(edited.editorDiagnostics?.usage || {});

  let headlinePack = await buildHeadlinePack({
    editedArticle: edited,
    storyPlan,
    callOpenAi,
  });
  openAiUsages.push(headlinePack.headlineDiagnostics?.usage || {});

  edited = {
    ...edited,
    headline: headlinePack.headline || edited.headline,
    subheadline: headlinePack.subheadline || edited.subheadline,
  };

  let validation = validateMultipassDraft({
    editedArticle: edited,
    headlinePack,
    storyPlan,
    requiredRecap: planResult.requiredRecap,
    ledgerSnapshot: ledgerCoverageSnapshot(ledger),
    coverageTargets: planResult.coverageTargets,
    allowedDriverNames: allowedDriverNames(storyPlan, preparedFacts),
  });

  let repairAttempted = false;
  if (!validation.ok) {
    repairAttempted = true;
    const hints = buildRepairHints(validation);
    const rewriteId = edited.rewriteSectionId || sectionDrafts[0]?.sectionId;
    const section = outlineById[rewriteId];
    if (section) {
      const idx = sectionDrafts.findIndex((s) => s.sectionId === rewriteId);
      const redraft = await rewriteOneSection({
        sectionDraft: sectionDrafts[idx],
        storyPlan,
        section,
        preparedFacts,
        racePackage,
        sectionMemory,
        repairReason: JSON.stringify(hints),
        writeArticleSectionFn,
        callOpenAi,
      });
      if (idx >= 0) sectionDrafts[idx] = redraft;
      applySectionDraftToLedger(ledger, redraft);
      openAiUsages.push(redraft.writerDiagnostics?.usage || {});
    }

    edited = await editArticle({
      sectionDrafts,
      storyPlan,
      outline,
      requiredRecap: planResult.requiredRecap,
      callOpenAi,
      repairHints: hints,
    });
    openAiUsages.push(edited.editorDiagnostics?.usage || {});

    headlinePack = await buildHeadlinePack({ editedArticle: edited, storyPlan, callOpenAi });
    openAiUsages.push(headlinePack.headlineDiagnostics?.usage || {});

    validation = validateMultipassDraft({
      editedArticle: edited,
      headlinePack,
      storyPlan,
      requiredRecap: planResult.requiredRecap,
      ledgerSnapshot: ledgerCoverageSnapshot(ledger),
      coverageTargets: planResult.coverageTargets,
      allowedDriverNames: allowedDriverNames(storyPlan, preparedFacts),
    });
  }

  const usage = aggregateUsage(openAiUsages);
  const elapsedMs = Date.now() - started;

  const draft = {
    headline: headlinePack.headline,
    subheadline: headlinePack.subheadline,
    summary: edited.summary,
    body: edited.body,
  };

  return {
    phase: previewOnly ? '3b-multipass-preview' : '3b-multipass-draft',
    multipassVersion: NEWS_WRITER_MULTIPASS_VERSION,
    plannerVersion: storyPlan.plannerVersion,
    previewOnly,
    deterministicPlan: planResult,
    generatedSections: sectionDrafts,
    editorialDraft: edited,
    headlinePack,
    validation,
    repairAttempted,
    factUsageLedgerAfterWrite: ledger,
    ledgerCoverageAfterWrite: ledgerCoverageSnapshot(ledger),
    openAiUsage: { ...usage, elapsedMs },
    article: draft,
    author: NEWS_AUTHOR,
    promptVersion: NEWS_PROMPT_VERSION,
    articleType,
    articleDepth: storyPlan.articleDepth,
    raceNumber: Number(raceNumber),
    seasonId: resolvedSeason,
  };
}

export async function generateNewsArticleMultipass(options = {}) {
  const raceNumber = Number(options.raceNumber ?? options.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    throw new Error('Multi-pass writer requires a valid raceNumber for race-recap.');
  }
  return runMultipassWriterPipeline({
    seasonId: options.seasonId,
    raceNumber,
    articleType: options.articleType || 'race-recap',
    articleDepth: options.articleDepth ?? options.article_depth ?? 'medium',
    previewOnly: options.previewOnly !== false,
    callOpenAi: options.callOpenAi,
    writeArticleSectionFn: options.writeArticleSectionFn,
  });
}
