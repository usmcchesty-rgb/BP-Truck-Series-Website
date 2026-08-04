/**
 * Phase 4a pipeline diagnostics — structured audits (no new OpenAI stages).
 */
import { getMultipassDepthProfile } from './_news-writer-depth-enforcement.js';

export function isWriterPipelineDebugEnabled() {
  if (String(process.env.NEWS_WRITER_PIPELINE_DEBUG || '').trim().toLowerCase() === 'true') {
    return true;
  }
  return false;
}

export function logWriterPipelineDebug(label, payload) {
  if (!isWriterPipelineDebugEnabled()) return;
  console.info('[news-writer-pipeline]', label, JSON.stringify(payload, null, 0));
}

export function pipelineWordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function buildSectionWriteAudit({
  section,
  depthSection,
  promptTargetWords,
  maxTokens,
  sectionText,
  completionTokens,
}) {
  const planned = section?.targetWords ?? null;
  const enforced = depthSection?.targetWords ?? null;
  const actual = pipelineWordCount(sectionText);
  return {
    sectionId: depthSection?.sectionId || section?.sectionId,
    sectionName: depthSection?.title || section?.title,
    outlineTargetWords: planned,
    depthEnforcedTargetWords: enforced,
    promptTargetWords,
    completionMaxTokens: maxTokens,
    completionTokensUsed: completionTokens ?? null,
    actualWords: actual,
    depthWordMin: depthSection?.writingBrief?.depthEnforcement?.wordMin ?? null,
    depthWordMax: depthSection?.writingBrief?.depthEnforcement?.wordMax ?? null,
    evidenceFactsInPrompt: depthSection?.writingBrief?.depthEnforcement?.factTarget ?? null,
    metDepthMin:
      depthSection?.writingBrief?.depthEnforcement?.wordMin != null
        ? actual >= Math.round(depthSection.writingBrief.depthEnforcement.wordMin * 0.55)
        : null,
  };
}

export function buildEditorPreAudit(sectionDrafts) {
  const perSection = (sectionDrafts || []).map((s) => ({
    sectionId: s.sectionId,
    title: s.title,
    words: s.wordCount ?? pipelineWordCount(s.sectionText),
  }));
  const totalWords = perSection.reduce((sum, row) => sum + (row.words || 0), 0);
  return { perSection, totalWords };
}

export function buildEditorPostAudit(preAudit, body) {
  const afterWords = pipelineWordCount(body);
  const beforeWords = preAudit?.totalWords || 0;
  const reductionPct =
    beforeWords > 0 ? Math.round(((beforeWords - afterWords) / beforeWords) * 1000) / 10 : 0;
  return {
    beforeWords,
    afterWords,
    reductionPercent: reductionPct,
    overCompressed: beforeWords >= 400 && afterWords < beforeWords * 0.72,
  };
}

export function stitchSectionDraftsBody(sectionDrafts) {
  return (sectionDrafts || [])
    .map((s) => String(s.sectionText || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

export function shouldUseDeterministicEditorStitch({
  articleDepth,
  sectionDrafts,
  editedBody,
}) {
  const profile = getMultipassDepthProfile(articleDepth);
  const pre = buildEditorPreAudit(sectionDrafts);
  const editedWords = pipelineWordCount(editedBody);
  const minArticle = profile.wordRange.min;
  if (pre.totalWords < 120) return false;
  if (editedWords >= minArticle) return false;
  if (pre.totalWords >= minArticle * 0.45 && editedWords < pre.totalWords * 0.72) {
    return true;
  }
  if (pre.totalWords >= minArticle * 0.35 && editedWords < minArticle) {
    return true;
  }
  return false;
}

export function validationRequiresDepthRepair(validation) {
  if (!validation?.depthValidation) return false;
  const dc = validation.depthCompliance || validation.depthValidation?.depthCompliance;
  const depth = dc?.depth || validation.depthCompliance?.depth;
  const profile = getMultipassDepthProfile(depth);
  const words = dc?.actual?.words ?? validation.wordCount ?? 0;
  const facts = dc?.actual?.facts ?? 0;
  if (profile.validationWordFloor != null && words < profile.validationWordFloor) return true;
  if (profile.validationFactFloor != null && facts < profile.validationFactFloor) return true;
  return validation.depthValidation.checks?.some(
    (c) => (c.id === 'depth_words_low' || c.id === 'depth_facts_low') && !c.ok
  );
}

export function thinSectionIdsForDepthRepair(validation, limit = 4) {
  const checks = validation?.depthCompliance?.sectionChecks || [];
  return checks.filter((c) => !c.ok).map((c) => c.sectionId).slice(0, limit);
}

export function buildDepthRepairHints(validation) {
  const base = {
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
    depthCompliance: validation.depthCompliance,
    instruction:
      'Depth repair: expand thin sections using additional verified evidence already in the bundle. Do not remove unique facts in the editor merge.',
  };
  const thin = thinSectionIdsForDepthRepair(validation);
  if (thin.length) {
    base.rewriteSectionIds = thin;
    base.instruction += ` Priority sections to rewrite: ${thin.join(', ')}.`;
  }
  if (validationRequiresDepthRepair(validation)) {
    base.instruction += ` Final body must meet ${validation.depthCompliance?.display?.wordsLine || 'depth word target'}.`;
  }
  return base;
}
