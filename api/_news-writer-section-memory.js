export function createEmptySectionMemory() {
  return { sections: [] };
}

export function appendSectionMemory(memory, sectionDraft) {
  memory.sections.push({
    sectionId: sectionDraft.sectionId,
    summary: sectionDraft.sectionSummary || '',
    entitiesIntroduced: sectionDraft.entitiesIntroduced || [],
    majorFactIds: sectionDraft.usedFactIds || [],
    canonicalFactIds: sectionDraft.usedCanonicalIds || [],
    tone: sectionDraft.tone || 'newsroom',
    wordCount: sectionDraft.wordCount || 0,
  });
  return memory;
}

/** Compact context for the next section — never full prior prose. */
export function compactMemoryForPrompt(memory, limit = 4) {
  return (memory.sections || []).slice(-limit).map((s) => ({
    sectionId: s.sectionId,
    summary: s.summary,
    entitiesIntroduced: s.entitiesIntroduced,
    majorFactIds: s.majorFactIds,
    tone: s.tone,
  }));
}
