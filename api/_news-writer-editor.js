import { callOpenAiWriterJson, milesApexEditorSystemPrompt } from './_news-writer-openai.js';
import { compactNewsroomGuidanceForPrompt } from './_news-writer-newsworthiness.js';
import {
  compactDepthGuidanceForEditor,
  resolveEditorMaxTokens,
} from './_news-writer-depth-enforcement.js';

export async function editArticle({
  sectionDrafts,
  storyPlan,
  outline,
  requiredRecap,
  callOpenAi = callOpenAiWriterJson,
  repairHints = null,
  factVerification = null,
  newsworthinessReport = null,
}) {
  const payload = {
    sections: sectionDrafts.map((s) => ({
      sectionId: s.sectionId,
      title: s.title,
      text: s.sectionText,
      usedFactIds: s.usedFactIds,
    })),
    storyPlan: {
      leadStoryId: storyPlan.leadStoryId,
      raceTemperature: storyPlan.raceTemperature,
      readerTakeaways: storyPlan.readerTakeaways,
    },
    outline: {
      totalTargetWords: outline.totalTargetWords,
      targetWordRange: outline.targetWordRange,
    },
    requiredRecap: requiredRecap?.items || [],
    repairHints,
    factVerificationGuidance: factVerification
      ? {
          suppressedNumericTokens: factVerification.suppressedNumericTokens,
          safePhrasingHints: factVerification.safePhrasingHints,
          writerRules: factVerification.writerRules,
        }
      : null,
    newsroomGuidance: compactNewsroomGuidanceForPrompt(newsworthinessReport),
    depthGuidance: compactDepthGuidanceForEditor(storyPlan, outline),
  };

  const { parsed, usage, model, elapsedMs } = await callOpenAi({
    messages: [
      { role: 'system', content: milesApexEditorSystemPrompt() },
      {
        role: 'user',
        content: `Merge these sections into one article body with summary.\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
    maxTokens: resolveEditorMaxTokens(storyPlan.articleDepth),
    logLabel: 'editorial-pass',
  });

  return {
    headline: String(parsed.headline || '').trim(),
    subheadline: String(parsed.subheadline || '').trim(),
    summary: String(parsed.summary || '').trim(),
    body: String(parsed.body || '').trim(),
    rewriteSectionId: parsed.rewriteSectionId || parsed.rewrite_section_id || null,
    editorNotes: parsed.editorNotes || parsed.notes || '',
    editorDiagnostics: { model, usage, elapsedMs },
  };
}

export async function rewriteOneSection({
  sectionDraft,
  storyPlan,
  section,
  preparedFacts,
  racePackage,
  sectionMemory,
  repairReason,
  writeArticleSectionFn,
  callOpenAi,
}) {
  const augmentedSection = {
    ...section,
    writingBrief: {
      ...(section.writingBrief || {}),
      mustAvoid: [],
      repairReason,
    },
  };
  return writeArticleSectionFn({
    storyPlan,
    section: augmentedSection,
    factUsageLedger: null,
    preparedFacts,
    racePackage,
    sectionMemory,
    callOpenAi,
  });
}
