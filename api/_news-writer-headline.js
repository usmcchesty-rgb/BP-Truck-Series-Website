import { MULTIPASS_OPENAI_HEADLINE_MAX_TOKENS } from '../server/config/news-writer-multipass-config.js';
import { callOpenAiWriterJson, milesApexHeadlineSystemPrompt } from './_news-writer-openai.js';
import { compactNewsroomGuidanceForPrompt } from './_news-writer-newsworthiness.js';

export async function buildHeadlinePack({
  editedArticle,
  storyPlan,
  callOpenAi = callOpenAiWriterJson,
  factVerification = null,
  newsworthinessReport = null,
}) {
  const payload = {
    bodyPreview: String(editedArticle.body || '').slice(0, 3500),
    summary: editedArticle.summary,
    leadStoryId: storyPlan.leadStoryId,
    raceTemperature: storyPlan.raceTemperature,
    readerTakeaways: storyPlan.readerTakeaways,
    headlineRules: factVerification
      ? {
          doNotUseNumericTokens: factVerification.suppressedNumericTokens || [],
          verifiedCategories: factVerification.verifiedCategories || {},
        }
      : null,
    newsroomGuidance: compactNewsroomGuidanceForPrompt(newsworthinessReport),
  };

  const { parsed, usage, model, elapsedMs } = await callOpenAi({
    messages: [
      { role: 'system', content: milesApexHeadlineSystemPrompt() },
      { role: 'user', content: JSON.stringify(payload, null, 2) },
    ],
    maxTokens: MULTIPASS_OPENAI_HEADLINE_MAX_TOKENS,
    logLabel: 'headline-pack',
  });

  return {
    headline: String(parsed.headline || '').trim(),
    subheadline: String(parsed.subheadline || '').trim(),
    seoDescription: String(parsed.seoDescription || parsed.seo_description || '').trim(),
    socialTeaser: String(parsed.socialTeaser || parsed.social_teaser || '').trim(),
    headlineDiagnostics: { model, usage, elapsedMs },
  };
}
