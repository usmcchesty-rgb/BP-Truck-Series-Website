import { NEWS_WRITER_PLANNER_VERSION } from './_news-writer-config.js';
import { estimateOpenAiCostUsd, SECTION_WRITE_ORDER } from '../server/config/news-writer-multipass-config.js';
import { buildDeterministicArticlePlan } from './_news-writer-deterministic-plan.js';
import { prepareFactsForPlanning } from './_news-writer-fact-quality.js';
import { computePackageFingerprint } from './_news-writer-fingerprint.js';
import { buildRaceIntelligencePackage } from './_race-research-package.js';
import { loadRaceResearchBootstrapContext } from './_race-research-sync.js';

/** Rough per-call token averages for admin pre-run estimate (not billing). */
const TOKEN_PROFILE = {
  section: { prompt: 3400, completion: 480 },
  editor: { prompt: 7800, completion: 2400 },
  headline: { prompt: 2100, completion: 220 },
  legacy: { prompt: 12500, completion: 2600 },
  repairSection: { prompt: 3600, completion: 520 },
  repairEditor: { prompt: 8200, completion: 2400 },
  repairHeadline: { prompt: 2200, completion: 220 },
};

export const WRITER_RUN_MAX_OPENAI_CALLS_PER_REQUEST = 2;

export function countOutlineSections(outline) {
  const byId = Object.fromEntries((outline?.sections || []).map((s) => [s.sectionId, s]));
  return SECTION_WRITE_ORDER.filter((id) => byId[id]).length;
}

export function estimateWriterRunFromPlan({
  outline,
  articleDepth,
  runType = 'multipass_preview',
  includeRepairReserve = true,
}) {
  const sectionCount = countOutlineSections(outline);
  let openAiCalls =
    sectionCount +
    1 + // editor
    1; // headline
  if (runType === 'shadow_compare') {
    openAiCalls += 1; // legacy single-pass
  }
  if (includeRepairReserve) {
    openAiCalls += 3; // one section rewrite + re-edit + re-headline cap
  }

  let promptTokens = 0;
  let completionTokens = 0;
  for (let i = 0; i < sectionCount; i += 1) {
    promptTokens += TOKEN_PROFILE.section.prompt;
    completionTokens += TOKEN_PROFILE.section.completion;
  }
  promptTokens += TOKEN_PROFILE.editor.prompt;
  completionTokens += TOKEN_PROFILE.editor.completion;
  promptTokens += TOKEN_PROFILE.headline.prompt;
  completionTokens += TOKEN_PROFILE.headline.completion;
  if (runType === 'shadow_compare') {
    promptTokens += TOKEN_PROFILE.legacy.prompt;
    completionTokens += TOKEN_PROFILE.legacy.completion;
  }
  if (includeRepairReserve) {
    promptTokens +=
      TOKEN_PROFILE.repairSection.prompt +
      TOKEN_PROFILE.repairEditor.prompt +
      TOKEN_PROFILE.repairHeadline.prompt;
    completionTokens +=
      TOKEN_PROFILE.repairSection.completion +
      TOKEN_PROFILE.repairEditor.completion +
      TOKEN_PROFILE.repairHeadline.completion;
  }

  const totalTokens = promptTokens + completionTokens;
  const estimatedCostUsd = estimateOpenAiCostUsd({ promptTokens, completionTokens });
  const continuationRequests = Math.max(1, Math.ceil(openAiCalls / WRITER_RUN_MAX_OPENAI_CALLS_PER_REQUEST));
  const estimatedRuntimeSeconds = Math.round(openAiCalls * 4.5 + sectionCount * 0.5);

  return {
    articleDepth,
    sectionCount,
    expectedOpenAiCalls: openAiCalls,
    estimatedPromptTokens: promptTokens,
    estimatedCompletionTokens: completionTokens,
    estimatedTotalTokens: totalTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    estimatedContinuationRequests: continuationRequests,
    estimatedRuntimeSeconds,
    maxOpenAiCallsPerRequest: WRITER_RUN_MAX_OPENAI_CALLS_PER_REQUEST,
    plannerVersion: NEWS_WRITER_PLANNER_VERSION,
  };
}

export async function buildWriterRunEstimate({
  seasonId,
  raceNumber,
  articleType = 'race-recap',
  articleDepth = 'medium',
  runType = 'multipass_preview',
  racePackageOverride = null,
  driverLookup = null,
}) {
  let racePackage = racePackageOverride;
  if (!racePackage) {
    racePackage = await buildRaceIntelligencePackage({
      seasonId: String(seasonId),
      raceNumber: Number(raceNumber),
      includeRawExcerpts: true,
    });
  }
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
  const estimate = estimateWriterRunFromPlan({
    outline: planResult.outline,
    articleDepth,
    runType,
  });
  return {
    ...estimate,
    packageFingerprint: fingerprint,
    operationId: planResult.storyPlan?.operationId,
    factCount: racePackage.facts?.length ?? 0,
    outlineSectionIds: (planResult.outline?.sections || []).map((s) => s.sectionId),
  };
}
