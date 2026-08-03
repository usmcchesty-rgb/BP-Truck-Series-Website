function factById(preparedFacts, id) {
  return preparedFacts.find((f) => f.id === id);
}

function excerptFromSources(sources, keywords, maxChars = 700) {
  const hits = [];
  for (const s of sources || []) {
    const text = String(s.excerpt || s.rawText || '').trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (keywords.some((k) => lower.includes(String(k).toLowerCase()))) {
      hits.push(text.slice(0, maxChars));
    }
    if (hits.length >= 2) break;
  }
  return hits;
}

export function buildSectionEvidenceBundle({
  section,
  preparedFacts,
  racePackage,
  storyPlan,
  maxFacts = 14,
}) {
  const factIds = [...new Set(section.evidence?.factIds || [])].slice(0, maxFacts);
  const facts = factIds.map((id) => factById(preparedFacts, id)).filter(Boolean);

  const canonicalIds = [...new Set(facts.map((f) => f.canonicalFactId).filter(Boolean))];
  const driverNames = [
    ...new Set(
      facts.flatMap((f) => f.driverNames || []).filter(Boolean)
    ),
  ];

  const keywords = [
    ...driverNames.slice(0, 4),
    section.sectionType,
    section.title,
  ].filter(Boolean);

  const transcriptExcerpts = excerptFromSources(
    (racePackage?.sources || []).filter((s) =>
      ['youtube_transcript', 'saved_transcript'].includes(s.sourceType)
    ),
    keywords
  );

  const raceControlExcerpts = excerptFromSources(
    (racePackage?.sources || []).filter((s) => s.sourceType === 'race_control'),
    keywords,
    500
  );

  const standings = (racePackage?.standings || racePackage?.facts || [])
    .filter((f) => f.factType === 'championship')
    .slice(0, 6)
    .map((f) => ({
      factId: f.id,
      summary: f.summary,
      confidence: f.confidence,
    }));

  const takeaways = (storyPlan.readerTakeaways || [])
    .filter((t) => (section.writingBrief?.mustMention || []).includes(t.takeawayId))
    .map((t) => ({ takeawayId: t.takeawayId, label: t.label, factIds: t.factIds }));

  return {
    sectionId: section.sectionId,
    sectionType: section.sectionType,
    title: section.title,
    targetWords: section.targetWords,
    facts: facts.map((f) => ({
      factId: f.id,
      factType: f.factType,
      category: f.category,
      summary: f.summary,
      confidence: f.confidence,
      canonicalFactId: f.canonicalFactId || null,
      driverNames: f.driverNames || [],
      structuredData: f.structuredData || null,
    })),
    canonicalFactIds: canonicalIds,
    transcriptExcerpts,
    raceControlExcerpts,
    standingsSnapshots: standings,
    readerTakeawaysForSection: takeaways,
    raceTemperature: {
      primary: storyPlan.raceTemperature?.primary,
      secondary: storyPlan.raceTemperature?.secondary,
      confidence: storyPlan.raceTemperature?.confidence,
    },
    writingBrief: section.writingBrief || {},
  };
}
