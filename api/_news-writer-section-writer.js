import {
  callOpenAiWriterJson,
  milesApexSectionSystemPrompt,
} from './_news-writer-openai.js';
import { buildSectionEvidenceBundle } from './_news-writer-section-evidence.js';
import { compactMemoryForPrompt } from './_news-writer-section-memory.js';
import { filterUsedFactIdsToEvidence } from './_news-writer-ledger-writer.js';
import { applyVerificationToSectionEvidence, sanitizeWriterText } from './_news-writer-fact-verification.js';
import { compactNewsroomGuidanceForPrompt } from './_news-writer-newsworthiness.js';
import {
  prepareSectionForDepthWrite,
  resolveSectionMaxTokens,
} from './_news-writer-depth-enforcement.js';
import {
  buildSectionWriteAudit,
  logWriterPipelineDebug,
} from './_news-writer-pipeline-diagnostics.js';

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export async function writeArticleSection({
  storyPlan,
  section,
  factUsageLedger,
  preparedFacts,
  racePackage,
  sectionMemory,
  callOpenAi = callOpenAiWriterJson,
  factVerification = null,
  newsworthinessReport = null,
}) {
  const depthSection = prepareSectionForDepthWrite(section, storyPlan.articleDepth, preparedFacts, {
    suppressedFactIds: factVerification?.suppressedFactIds || [],
  });
  let evidence = buildSectionEvidenceBundle({
    section: depthSection,
    preparedFacts,
    racePackage,
    storyPlan,
    maxFacts: depthSection.depthMaxFacts || 14,
  });
  evidence = applyVerificationToSectionEvidence(evidence, factVerification);

  const memoryCompact = compactMemoryForPrompt(sectionMemory);

  const userPayload = {
    section: {
      sectionId: depthSection.sectionId,
      title: depthSection.title,
      purpose: depthSection.purpose,
      targetWords: depthSection.targetWords,
      writingBrief: depthSection.writingBrief,
    },
    storyPlan: {
      leadStoryId: storyPlan.leadStoryId,
      raceTemperature: storyPlan.raceTemperature,
      readerTakeaways: storyPlan.readerTakeaways,
    },
    priorSectionMemory: memoryCompact,
    evidence,
    ledgerHint: {
      sectionFactIds: evidence.facts.map((f) => f.factId),
    },
    factVerificationGuidance: evidence.factVerificationGuidance || null,
    newsroomGuidance: compactNewsroomGuidanceForPrompt(newsworthinessReport),
  };

  const promptTargetWords = depthSection.targetWords;
  const wordMin = depthSection.writingBrief?.depthEnforcement?.wordMin || promptTargetWords;
  const maxTokens = resolveSectionMaxTokens(depthSection, storyPlan.articleDepth);

  const { parsed, usage, model, elapsedMs } = await callOpenAi({
    messages: [
      { role: 'system', content: milesApexSectionSystemPrompt() },
      {
        role: 'user',
        content: `Write this section only. Target ~${promptTargetWords} words (required minimum ~${wordMin} when evidence includes 3+ facts).\n\n${JSON.stringify(userPayload, null, 2)}`,
      },
    ],
    maxTokens,
    logLabel: `section-${section.sectionId}`,
  });

  const sectionText = sanitizeWriterText(
    String(parsed.sectionText || parsed.text || '').trim(),
    factVerification
  );
  const rawUsedFactIds = parsed.usedFactIds || parsed.used_fact_ids || [];
  const rawUsedCanonicalIds = parsed.usedCanonicalIds || parsed.used_canonical_ids || [];
  const { usedFactIds, usedCanonicalIds } = filterUsedFactIdsToEvidence(
    { usedFactIds: rawUsedFactIds, usedCanonicalIds: rawUsedCanonicalIds },
    evidence.facts.map((f) => f.factId)
  );

  const sectionAudit = buildSectionWriteAudit({
    section,
    depthSection,
    promptTargetWords,
    maxTokens,
    sectionText,
    completionTokens: usage?.completionTokens,
  });
  logWriterPipelineDebug('section-write', sectionAudit);

  return {
    sectionId: depthSection.sectionId,
    sectionType: depthSection.sectionType,
    title: depthSection.title,
    sectionText,
    sectionSummary: String(parsed.sectionSummary || parsed.summary || '').slice(0, 400),
    entitiesIntroduced: parsed.entitiesIntroduced || parsed.entities || [],
    tone: parsed.tone || 'newsroom',
    usedFactIds,
    usedCanonicalIds,
    wordCount: wordCount(sectionText),
    writerDiagnostics: {
      model,
      usage,
      elapsedMs,
      evidenceFactCount: evidence.facts.length,
      transcriptExcerptCount: evidence.transcriptExcerpts.length,
      raceControlExcerptCount: evidence.raceControlExcerpts.length,
      depthAudit: sectionAudit,
      outlineTargetWords: section.targetWords,
      depthEnforcedTargetWords: depthSection.targetWords,
    },
    evidenceBundleSize: evidence.facts.length,
  };
}
