import { loadPowerRankingsGenerationContext } from './power-rankings-generate.js';
import NEWS_SYSTEM_PROMPT, {
  ARTICLE_TYPES,
  NEWS_AUTHOR,
  NEWS_PROMPT_VERSION,
} from '../server/config/news-system-prompt.js';
import { buildNewsFactualContext } from './_news-factual-grounding.js';
import {
  validateNewsArticle,
  REPAIRABLE_NEWS_ERROR_TYPES,
  formatNewsValidationForRepair,
} from './_news-validation.js';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function normalizeArticleType(value) {
  const raw = String(value || 'race-recap').trim().toLowerCase();
  return ARTICLE_TYPES[raw] ? raw : 'race-recap';
}

function parseJsonContent(content) {
  const trimmed = String(content || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

function buildValidationContext(generationContext, articleType) {
  return {
    articleType,
    standings: generationContext.standings || [],
    factualGrounding: generationContext.factualGrounding,
    alignedRaces: generationContext.alignedRaces || [],
    recentResultsForGrounding: generationContext.recentResultsForGrounding || [],
    driverLookup: generationContext.driverLookup,
    manualRaceNotes: generationContext.manualRaceNotes || '',
    broadcastContext: generationContext.contextMeta?.broadcastContext,
    transcriptSummary: generationContext.contextMeta?.broadcastContext?.summary || '',
  };
}

function buildNewsUserPrompt(generationContext, options = {}) {
  const articleType = normalizeArticleType(options.articleType);
  const typeConfig = ARTICLE_TYPES[articleType];
  const raceNumber = Number(options.raceNumber ?? generationContext.raceNumber);
  const headlineOverride = String(options.headlineOverride || '').trim();
  const spotlightDriverId = options.spotlightDriverId || null;
  const spotlight = generationContext.standings?.find(
    (row) => String(row.driverId) === String(spotlightDriverId)
  );

  const standingsLines = (generationContext.standings || [])
    .slice(0, 16)
    .map(
      (row) =>
        `${row.position}. ${row.driverName} (#${row.carNumber || '—'}) — ${row.points} pts, ${row.wins} wins, ${row.top5} top 5s, ${row.top10} top 10s`
    )
    .join('\n');

  const recentResults = (generationContext.recentResultsForGrounding || [])
    .map(
      (race) =>
        `Race ${race.raceNumber}: ${race.track} — Winner: ${race.winner || 'TBD'} (${race.date || ''})`
    )
    .join('\n');

  const raceRow = generationContext.scheduleRaces?.find(
    (race) => race.officialPointsRaceNumber === raceNumber
  );

  return `Write a ${typeConfig.label} article for the Blazing Pedals Truck Series.

Article type: ${typeConfig.label}
Target length: ${typeConfig.minWords}-${typeConfig.maxWords} words
Structure: ${typeConfig.structure}
Race number: ${raceNumber}
Track: ${raceRow?.track || 'See schedule context'}
Race date: ${raceRow?.date || 'TBD'}
Winner (if completed): ${raceRow?.winner || 'TBD'}
Author byline: ${NEWS_AUTHOR}
${headlineOverride ? `Suggested headline direction: ${headlineOverride}` : ''}
${spotlight ? `Spotlight driver: ${spotlight.driverName} (P${spotlight.position}, ${spotlight.points} pts)` : ''}

Standings snapshot:
${standingsLines || '(none)'}

Recent results:
${recentResults || '(none)'}

Factual grounding (verified facts only):
${JSON.stringify(generationContext.factualGrounding, null, 2)}

Manual race notes:
${generationContext.manualRaceNotes || '(none)'}

Transcript / broadcast summary:
${generationContext.contextMeta?.broadcastContext?.summary || '(none)'}

Return JSON only with headline, subheadline, summary, and body.`;
}

async function callOpenAiNews(userPrompt, { repairReason = null, previousArticle = null } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in Vercel environment variables.');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const messages = [{ role: 'system', content: NEWS_SYSTEM_PROMPT }];

  if (repairReason && previousArticle) {
    messages.push({
      role: 'user',
      content: `Revise this article to fix validation errors.

Validation errors:
${repairReason}

Current article JSON:
${JSON.stringify(previousArticle, null, 2)}

Return corrected JSON only with headline, subheadline, summary, and body.`,
    });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.65,
      max_tokens: 2200,
      messages,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI news generation failed (${response.status})`);
  }

  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    throw new Error('OpenAI news generation returned an empty response.');
  }

  return parseJsonContent(content);
}

export async function loadNewsGenerationContext(options = {}) {
  const raceNumber = Number(options.raceNumber ?? options.race_number ?? 1);
  const manualNotes = String(
    options.manualNotes ?? options.manualRaceNotes ?? options.manual_race_notes ?? ''
  ).trim();
  const transcript = String(options.transcript ?? options.transcriptText ?? '').trim();
  const combinedNotes = [manualNotes, transcript].filter(Boolean).join('\n\n');

  const generationContext = await loadPowerRankingsGenerationContext(
    raceNumber,
    combinedNotes
  );

  return buildNewsFactualContext(generationContext, {
    spotlightDriverId: options.spotlightDriverId || options.spotlight_driver_id || null,
  });
}

export async function repairNewsArticle(article, generationContext, articleType) {
  let current = { ...article };
  let repairAttempts = 0;
  let repairAttempted = false;
  const repairReasons = [];
  const validationContext = buildValidationContext(generationContext, articleType);
  let validation = validateNewsArticle(current, validationContext);

  while (
    !validation.valid &&
    validation.errors.some((err) => REPAIRABLE_NEWS_ERROR_TYPES.has(err.type)) &&
    repairAttempts < 2
  ) {
    repairAttempted = true;
    repairAttempts += 1;
    repairReasons.push(
      ...validation.errors
        .filter((err) => REPAIRABLE_NEWS_ERROR_TYPES.has(err.type))
        .map((err) => err.type)
    );

    current = await callOpenAiNews(null, {
      repairReason: formatNewsValidationForRepair(validation),
      previousArticle: current,
    });

    validation = validateNewsArticle(current, validationContext);
  }

  return {
    article: current,
    validation,
    repairAttempted,
    repairAttempts,
    repairReasons: [...new Set(repairReasons)],
  };
}

export async function generateNewsArticle(options = {}) {
  const articleType = normalizeArticleType(options.articleType ?? options.article_type);
  const raceNumber = Number(options.raceNumber ?? options.race_number ?? 1);

  const generationContext = await loadNewsGenerationContext({
    raceNumber,
    manualNotes: options.manualNotes ?? options.manualRaceNotes,
    transcript: options.transcript,
    spotlightDriverId: options.spotlightDriverId ?? options.spotlight_driver_id,
  });

  const userPrompt = buildNewsUserPrompt(generationContext, {
    articleType,
    raceNumber,
    headlineOverride: options.headlineOverride ?? options.headline_override,
    spotlightDriverId: options.spotlightDriverId ?? options.spotlight_driver_id,
  });

  let draft = await callOpenAiNews(userPrompt);
  const repaired = await repairNewsArticle(draft, generationContext, articleType);

  const generationSources = buildGenerationSources(
    generationContext,
    articleType,
    repaired
  );

  return {
    promptVersion: NEWS_PROMPT_VERSION,
    author: NEWS_AUTHOR,
    articleType,
    raceNumber,
    article: repaired.article,
    validation: repaired.validation,
    repairAttempted: repaired.repairAttempted,
    repairAttempts: repaired.repairAttempts,
    repairReasons: repaired.repairReasons,
    generationSources,
    transcriptDiagnostics: buildTranscriptDiagnostics(generationContext),
  };
}

function buildTranscriptDiagnostics(generationContext) {
  const meta = generationContext.contextMeta || {};
  return {
    promptVersion: NEWS_PROMPT_VERSION,
    transcriptUsed: meta.transcriptUsed === true,
    transcriptMode: meta.transcriptMode || 'none',
    manualRaceNotesUsed: meta.manualRaceNotesUsed === true,
    manualRaceNotesLength: String(generationContext.manualRaceNotes || '').length,
    broadcastSource: meta.broadcastContext?.source || null,
    youtubeDiagnostics: meta.youtubeDiagnostics || null,
  };
}

function buildGenerationSources(generationContext, articleType, repaired) {
  const grounding = generationContext.factualGrounding || {};
  const manualNotes = Boolean(String(generationContext.manualRaceNotes || '').trim());
  const transcriptUsed = generationContext.contextMeta?.transcriptUsed === true;

  let dataQualityScore = 40;
  if ((generationContext.standings || []).length) dataQualityScore += 25;
  if ((generationContext.recentResultsForGrounding || []).length) dataQualityScore += 15;
  if (grounding.diagnostics?.recentRaceFinishesUsed) dataQualityScore += 10;
  if (manualNotes) dataQualityScore += 25;
  else if (transcriptUsed) dataQualityScore += 20;

  const confidenceScore =
    manualNotes && (generationContext.standings || []).length
      ? 'HIGH'
      : transcriptUsed || (generationContext.standings || []).length
        ? 'MEDIUM'
        : 'LOW';

  return {
    articleType,
    factsUsed: repaired.validation?.mentionedDrivers || [],
    resultsUsed: generationContext.recentResultsForGrounding || [],
    standingsSnapshot: (generationContext.standings || []).slice(0, 16).map((row) => ({
      position: row.position,
      driverName: row.driverName,
      points: row.points,
      wins: row.wins,
    })),
    transcriptUsed,
    transcriptMode: generationContext.contextMeta?.transcriptMode || 'none',
    manualNotesUsed: manualNotes,
    validationWarnings: repaired.validation?.warnings || [],
    validationErrors: repaired.validation?.errors || [],
    unsupportedFacts: repaired.validation?.unsupportedFacts || [],
    repairAttempted: repaired.repairAttempted,
    repairAttempts: repaired.repairAttempts,
    repairReasons: repaired.repairReasons,
    wordCount: repaired.validation?.wordCount,
    dataQualityScore: Math.min(dataQualityScore, 100),
    confidenceScore,
    raceNumberDebug: generationContext.raceNumberDebug,
    alignedRaces: generationContext.alignedRaces,
    factualGroundingDiagnostics: grounding.diagnostics || null,
  };
}

export { parseBody, normalizeArticleType, ARTICLE_TYPES };
