import NEWS_SYSTEM_PROMPT from '../server/config/news-system-prompt.js';
import { loadNewsGenerationContext } from '../api/_news-generator.js';
import {
  buildNewsPromptContext,
  buildNewsUserPromptFromContext,
  measureNewsPromptSize,
} from '../api/_news-prompt-context.js';
import { ARTICLE_TYPES, NEWS_AUTHOR } from '../server/config/news-system-prompt.js';

const raceNumber = Number(process.argv[2] || 12);
const articleType = process.argv[3] || 'race-recap';
const spotlightDriverId = process.argv[4] || null;

const generationContext = await loadNewsGenerationContext({
  raceNumber,
  spotlightDriverId,
});
const promptContext = buildNewsPromptContext(generationContext, {
  articleType,
  raceNumber,
  spotlightDriverId: spotlightDriverId || generationContext.spotlightDriverId,
});
const userPrompt = buildNewsUserPromptFromContext(generationContext, promptContext, {
  typeConfig: ARTICLE_TYPES[articleType],
  raceNumber,
  author: NEWS_AUTHOR,
});

const fullOldEstimate = estimateOldPrompt(generationContext);
const promptSize = measureNewsPromptSize(NEWS_SYSTEM_PROMPT, userPrompt, promptContext);

console.log(JSON.stringify({ articleType, raceNumber, promptSize, fullOldEstimate }, null, 2));

function estimateOldPrompt(context) {
  const old = JSON.stringify(context.factualGrounding, null, 2);
  const notes = String(context.manualRaceNotes || '');
  const summary = String(context.contextMeta?.broadcastContext?.summary || '');
  return {
    factualGroundingChars: old.length,
    estimatedTokens: Math.ceil((old.length + notes.length + summary.length + 4000) / 4),
  };
}
