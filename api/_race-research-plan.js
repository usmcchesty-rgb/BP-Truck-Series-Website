import {
  ARTICLE_DEPTH_WORD_RANGES,
  normalizeArticleDepth,
} from '../server/config/race-research-config.js';

export function buildNewsArticlePlan({ articleType, articleDepth, evidenceSelection }) {
  const depth = normalizeArticleDepth(articleDepth);
  const wordRange = ARTICLE_DEPTH_WORD_RANGES[depth];
  const facts = evidenceSelection.selectedFacts || [];
  const quotes = evidenceSelection.selectedQuotes || [];

  const winnerFacts = facts.filter(
    (f) => f.category === 'winner' || f.structuredData?.finishPosition === 1
  );
  const incidentFacts = facts.filter((f) =>
    ['caution', 'incident', 'penalty'].includes(f.factType)
  );
  const championshipFacts = facts.filter((f) => f.factType === 'championship');

  const primaryStory =
    winnerFacts[0]?.summary ||
    facts[0]?.summary ||
    'Summarize the race outcome using verified facts only.';

  const secondaryStories = [
    ...incidentFacts.slice(0, depth === 'short' ? 1 : 4).map((f) => f.summary),
    ...championshipFacts.slice(0, depth === 'short' ? 1 : 3).map((f) => f.summary),
  ].filter(Boolean);

  const sectionCount = depth === 'short' ? 3 : depth === 'medium' ? 5 : 8;
  const sections = [];
  const factIds = facts.map((f) => f.id);
  const perSection = Math.max(1, Math.ceil(factIds.length / sectionCount));

  for (let i = 0; i < sectionCount; i += 1) {
    const slice = factIds.slice(i * perSection, (i + 1) * perSection);
    sections.push({
      heading: i === 0 ? 'Opening' : undefined,
      purpose:
        i === 0
          ? 'Set the scene with verified race outcome context.'
          : i === sectionCount - 1
            ? 'Championship implications and look ahead.'
            : 'Develop race story using linked evidence facts.',
      evidenceFactIds: slice,
      featuredDriverIds: [],
      targetWords: Math.round((wordRange.minimum + wordRange.maximum) / 2 / sectionCount),
    });
  }

  return {
    articleType,
    articleDepth: depth,
    targetWordRange: wordRange,
    primaryStory,
    secondaryStories,
    sections,
    selectedQuoteIds: quotes.map((q) => q.id),
    historicalFactIds: (evidenceSelection.selectedHistory || []).map((f) => f.id),
    requiredFactIds: factIds.slice(0, Math.min(5, factIds.length)),
  };
}
