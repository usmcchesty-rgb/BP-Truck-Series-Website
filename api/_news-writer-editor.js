import { callOpenAiWriterJson, milesApexEditorSystemPrompt } from './_news-writer-openai.js';
import { compactNewsroomGuidanceForPrompt } from './_news-writer-newsworthiness.js';
import {
  compactDepthGuidanceForEditor,
  resolveEditorMaxTokens,
  getMultipassDepthProfile,
} from './_news-writer-depth-enforcement.js';
import {
  buildEditorPreAudit,
  buildEditorPostAudit,
  stitchSectionDraftsBody,
  shouldUseDeterministicEditorStitch,
  logWriterPipelineDebug,
  pipelineWordCount,
} from './_news-writer-pipeline-diagnostics.js';

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
  const preAudit = buildEditorPreAudit(sectionDrafts);
  logWriterPipelineDebug('editor-before', preAudit);

  const depthProfile = getMultipassDepthProfile(storyPlan.articleDepth);
  const payload = {
    sections: sectionDrafts.map((s) => ({
      sectionId: s.sectionId,
      title: s.title,
      text: s.sectionText,
      usedFactIds: s.usedFactIds,
      wordCount: s.wordCount ?? pipelineWordCount(s.sectionText),
    })),
    storyPlan: {
      leadStoryId: storyPlan.leadStoryId,
      raceTemperature: storyPlan.raceTemperature,
      readerTakeaways: storyPlan.readerTakeaways,
      articleDepth: storyPlan.articleDepth,
    },
    outline: {
      totalTargetWords: depthProfile.wordRange.target,
      targetWordRange: depthProfile.wordRange,
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
    depthGuidance: compactDepthGuidanceForEditor(storyPlan, outline, sectionDrafts),
  };

  const editorMaxTokens = resolveEditorMaxTokens(storyPlan.articleDepth);
  logWriterPipelineDebug('editor-config', {
    editorMaxTokens,
    sectionDraftWordTotal: preAudit.totalWords,
    requiredMinimumBodyWords: depthProfile.wordRange.min,
  });

  const { parsed, usage, model, elapsedMs } = await callOpenAi({
    messages: [
      { role: 'system', content: milesApexEditorSystemPrompt() },
      {
        role: 'user',
        content: `Combine these sections into one article body with summary. Preserve section-level detail; do not summarize away verified facts.\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
    maxTokens: editorMaxTokens,
    logLabel: 'editorial-pass',
  });

  let body = String(parsed.body || '').trim();
  let editorNotes = String(parsed.editorNotes || parsed.notes || '').trim();
  let usedStitchFallback = false;
  if (
    shouldUseDeterministicEditorStitch({
      articleDepth: storyPlan.articleDepth,
      sectionDrafts,
      editedBody: body,
    })
  ) {
    body = stitchSectionDraftsBody(sectionDrafts);
    usedStitchFallback = true;
    editorNotes = `${editorNotes} [depth: deterministic stitch — editor over-compressed]`.trim();
  }

  const postAudit = buildEditorPostAudit(preAudit, body);
  logWriterPipelineDebug('editor-after', postAudit);

  return {
    headline: String(parsed.headline || '').trim(),
    subheadline: String(parsed.subheadline || '').trim(),
    summary: String(parsed.summary || '').trim(),
    body,
    rewriteSectionId: parsed.rewriteSectionId || parsed.rewrite_section_id || null,
    editorNotes,
    editorDiagnostics: {
      model,
      usage,
      elapsedMs,
      editorMaxTokens,
      depthAudit: { pre: preAudit, post: postAudit, usedStitchFallback },
    },
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
  factVerification = null,
  newsworthinessReport = null,
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
    factVerification,
    newsworthinessReport,
  });
}
