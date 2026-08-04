import { NEWS_AUTHOR } from '../server/config/news-system-prompt.js';

export function parseOpenAiJsonContent(content) {
  const trimmed = String(content || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

/**
 * Injectable OpenAI chat helper for production and tests.
 */
export async function callOpenAiWriterJson({
  messages,
  temperature = 0.55,
  maxTokens = 1200,
  fetchImpl = globalThis.fetch,
  logLabel = 'news-writer',
} = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in Vercel environment variables.');
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const started = Date.now();
  const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages,
    }),
  });
  const elapsedMs = Date.now() - started;
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI ${logLabel} failed (${response.status}): ${errText.slice(0, 400)}`);
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || '{}';
  const usage = payload.usage || {};
  return {
    parsed: parseOpenAiJsonContent(content),
    usage: {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    },
    model,
    elapsedMs,
  };
}

export function milesApexSectionSystemPrompt() {
  return `# Miles Apex — Section Writer (${NEWS_AUTHOR})

Write ONE section of a Blazing Pedals Truck Series race article in third-person NASCAR broadcast journalism style.
Use ONLY facts in the evidence bundle. Do not invent drivers, results, cautions, or quotes.
Return JSON only with keys: sectionText, usedFactIds, usedCanonicalIds, sectionSummary, entitiesIntroduced, tone.
If factVerificationGuidance lists suppressedNumericTokens, never use those numbers. Prefer racecraft and verified quotes over generic adjectives.
When newsroomGuidance is present, lead with primaryNarrative and follow editorialGuidance (emphasis and de-emphasize lists). Do not bury the primary story.
When depthEnforcement is present in writingBrief, sectionText MUST reach at least depthEnforcement.wordMin words when evidence includes 3+ facts. Use each verified fact in the bundle with race-specific detail.`;
}

export function milesApexEditorSystemPrompt() {
  return `# Miles Apex — Editorial Pass (${NEWS_AUTHOR})

Combine section drafts into one cohesive article with smooth transitions. Preserve verified facts and section-level detail.
Avoid generic AI adjectives (stunning, incredible, epic). Prefer motorsports broadcast voice and racecraft detail.
Never use numeric tokens listed in factVerificationGuidance.suppressedNumericTokens.
When newsroomGuidance is present, preserve its lead emphasis and driver spotlight order in the opening paragraphs.
When depthGuidance.mergeMode is preserve_length, do NOT shorten the combined draft: meet depthGuidance.requiredMinimumBodyWords and keep unique verified facts from every section.
When depthGuidance is present for medium or in-depth depth, preserve information density: do not shorten by removing unique verified facts. Remove duplicate phrasing only.
If rewriteSectionId is set, you may replace ONLY that section's portion in the merged body.
Return JSON: headline (placeholder ok), subheadline, summary, body, rewriteSectionId (or null), editorNotes.`;
}

export function milesApexHeadlineSystemPrompt() {
  return `# Miles Apex — Headline Pack (${NEWS_AUTHOR})

Write headline assets from the edited article and story plan cues. No hype beyond evidence.
Do not use disputed numeric statistics from headlineRules.doNotUseNumericTokens.
When newsroomGuidance is present, headline and subheadline should reflect primaryNarrative and highest news value.
Return JSON: headline, subheadline, seoDescription, socialTeaser.`;
}

export function createMockOpenAiFetch(responses) {
  const queue = [...responses];
  return async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error('Mock OpenAI queue exhausted');
    }
    const body =
      typeof next === 'function'
        ? next()
        : {
            choices: [{ message: { content: JSON.stringify(next) } }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          };
    return {
      ok: true,
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
    };
  };
}
