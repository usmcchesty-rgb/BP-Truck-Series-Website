import { loadPowerRankingsGenerationContext } from './power-rankings-generate.js';
import NEWS_SYSTEM_PROMPT, {
  ARTICLE_TYPES,
  NEWS_AUTHOR,
  NEWS_PROMPT_VERSION,
} from '../server/config/news-system-prompt.js';
import { buildNewsFactualContext } from './_news-factual-grounding.js';
import {
  assertNewsPromptWithinLimits,
  buildNewsPromptContext,
  buildNewsUserPromptFromContext,
  logNewsPromptSize,
  measureNewsPromptSize,
  NewsPromptTooLargeError,
} from './_news-prompt-context.js';
import {
  validateNewsArticle,
  REPAIRABLE_NEWS_ERROR_TYPES,
  formatNewsValidationForRepair,
} from './_news-validation.js';
import {
  buildSpotlightVerifiedStatsRepairBlock,
  SPOTLIGHT_SCOPE_ERROR_TYPES,
} from './_driver-career-history.js';

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
    spotlightDriverId: generationContext.spotlightDriverId || null,
    standings: generationContext.standings || [],
    factualGrounding: generationContext.factualGrounding,
    leagueCareerStats: generationContext.leagueCareerStats || null,
    leagueCareerSummary: generationContext.leagueCareerSummary || null,
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
  const promptContext = buildNewsPromptContext(generationContext, {
    articleType,
    raceNumber: options.raceNumber ?? generationContext.raceNumber,
    headlineOverride: options.headlineOverride,
    spotlightDriverId: options.spotlightDriverId || generationContext.spotlightDriverId,
  });

  const userPrompt = buildNewsUserPromptFromContext(generationContext, promptContext, {
    typeConfig,
    raceNumber: options.raceNumber ?? generationContext.raceNumber,
    requestedRaceNumber: options.requestedRaceNumber ?? generationContext.requestedRaceNumber,
    newsTopic: options.newsTopic ?? generationContext.newsTopic,
    headlineOverride: options.headlineOverride,
    author: NEWS_AUTHOR,
  });

  return { userPrompt, promptContext };
}

async function callOpenAiNews(
  userPrompt,
  { repairReason = null, previousArticle = null, repairContext = null } = {}
) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in Vercel environment variables.');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const messages = [{ role: 'system', content: NEWS_SYSTEM_PROMPT }];

  if (repairReason && previousArticle) {
    const statsBlock = buildSpotlightVerifiedStatsRepairBlock(repairContext || {});
    messages.push({
      role: 'user',
      content: `Revise this article to fix validation errors.

Validation errors:
${repairReason}
${statsBlock ? `\n${statsBlock}\n` : ''}
Current article JSON:
${JSON.stringify(previousArticle, null, 2)}

Return corrected JSON only with headline, subheadline, summary, and body.
Rewrite ALL affected fields. Separate season stats from career stats in every field.

Historical seasons: use finishing position and season name only — never current-season points on Season 8 or other past seasons.
Never describe the in-progress current season as completed (no "best season finish came in Season N", "finished fifth in Season N", or "placed overall" for the current season). Use seasonWording.suggestedPhrasing with present-tense campaign language.

Examples when career wins=5, season wins=1, Season 8 runner-up (P2), current Season 11 in progress at P5 (career-best position so far):
- ALLOWED season: "one win this season"
- ALLOWED career: "five career wins across his Blazing Pedals career"
- ALLOWED history: "His best championship finish came in Season 8, when he finished second in the championship standings"
- ALLOWED current campaign: "He's currently enjoying the best season of his career while sitting fifth in the standings"
- REJECTED: "five wins this season"
- REJECTED: "Season 8 runner-up with 595 points"
- REJECTED: "His best season finish came in Season 11, where he placed fifth overall"`,
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
  const articleType = normalizeArticleType(options.articleType ?? options.article_type);
  const rawRace = options.raceNumber ?? options.race_number;
  const hasRequestedRace =
    rawRace != null &&
    rawRace !== '' &&
    Number.isInteger(Number(rawRace)) &&
    Number(rawRace) >= 1;
  let raceNumber;
  const manualNotes = String(
    options.manualNotes ?? options.manualRaceNotes ?? options.manual_race_notes ?? ''
  ).trim();
  const newsTopic = String(options.newsTopic ?? options.news_topic ?? '').trim();

  if (articleType === 'driver-spotlight') {
    if (hasRequestedRace) {
      raceNumber = Number(rawRace);
    } else {
      const bootstrap = await loadPowerRankingsGenerationContext(1, '', {
        supplementalManualNotes: manualNotes,
      });
      raceNumber = bootstrap.raceNumberDebug?.latestCompletedRaceNumber ?? 1;
    }
  } else if (hasRequestedRace) {
    raceNumber = Number(rawRace);
  } else {
    const bootstrap = await loadPowerRankingsGenerationContext(1, '', {
      supplementalManualNotes: manualNotes,
    });
    raceNumber = bootstrap.raceNumberDebug?.latestCompletedRaceNumber ?? 1;
  }

  const generationContext = await loadPowerRankingsGenerationContext(raceNumber, '', {
    supplementalManualNotes: manualNotes,
  });
  generationContext.resolvedRaceNumber = raceNumber;
  generationContext.requestedRaceNumber = hasRequestedRace ? Number(rawRace) : null;
  generationContext.articleType = articleType;
  generationContext.newsTopic = newsTopic;

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
  const repairContext = {
    ...validationContext,
    spotlightDriverId: generationContext.spotlightDriverId,
    allowedSeasonStats:
      generationContext.factualGrounding?.drivers?.[String(generationContext.spotlightDriverId)]
        ?.allowedSeasonStats || null,
    leagueCareerSummary:
      generationContext.factualGrounding?.drivers?.[String(generationContext.spotlightDriverId)]
        ?.leagueCareerSummary || generationContext.leagueCareerSummary || null,
    currentSeasonBpNumber: (() => {
      const catalog = generationContext.factualGrounding?.careerHistoryAudit;
      const currentSeasonId = catalog?.currentSeasonId;
      const season = catalog?.seasons?.find(
        (entry) => String(entry.seasonId) === String(currentSeasonId)
      );
      if (Number.isFinite(season?.bpSeasonNumber)) return season.bpSeasonNumber;
      const match = String(catalog?.currentSeasonName || '').match(/season\s*#?\s*(\d+)/i);
      return match ? Number(match[1]) : null;
    })(),
  };
  let validation = validateNewsArticle(current, validationContext);
  const mixedScopeFieldsBeforeRepair = new Set(
    validation.errors
      .filter((err) => SPOTLIGHT_SCOPE_ERROR_TYPES.has(err.type) && err.articleField)
      .map((err) => err.articleField)
  );

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
      repairReason: formatNewsValidationForRepair(validation, repairContext),
      previousArticle: current,
      repairContext,
    });

    validation = validateNewsArticle(current, validationContext);
  }

  const repairedMixedScopeFields = [...mixedScopeFieldsBeforeRepair].filter(
    (field) =>
      !validation.errors.some(
        (err) => SPOTLIGHT_SCOPE_ERROR_TYPES.has(err.type) && err.articleField === field
      )
  );

  return {
    article: current,
    validation,
    repairAttempted,
    repairAttempts,
    repairReasons: [...new Set(repairReasons)],
    repairedMixedScopeFields,
  };
}

export async function generateNewsArticle(options = {}) {
  const articleType = normalizeArticleType(options.articleType ?? options.article_type);
  const isDriverSpotlight = articleType === 'driver-spotlight';
  const rawRace = options.raceNumber ?? options.race_number;
  const hasRequestedRace =
    rawRace != null &&
    rawRace !== '' &&
    Number.isInteger(Number(rawRace)) &&
    Number(rawRace) >= 1;

  const generationContext = await loadNewsGenerationContext({
    articleType,
    raceNumber: isDriverSpotlight
      ? hasRequestedRace
        ? Number(rawRace)
        : null
      : hasRequestedRace
        ? Number(rawRace)
        : null,
    manualNotes: options.manualNotes ?? options.manualRaceNotes,
    newsTopic: options.newsTopic ?? options.news_topic,
    spotlightDriverId: options.spotlightDriverId ?? options.spotlight_driver_id,
  });

  const resolvedRaceNumber = generationContext.resolvedRaceNumber ?? 1;

  const { userPrompt, promptContext } = buildNewsUserPrompt(generationContext, {
    articleType,
    raceNumber: resolvedRaceNumber,
    requestedRaceNumber: generationContext.requestedRaceNumber,
    newsTopic: options.newsTopic ?? options.news_topic ?? generationContext.newsTopic,
    headlineOverride: options.headlineOverride ?? options.headline_override,
    spotlightDriverId: options.spotlightDriverId ?? options.spotlight_driver_id,
  });

  const promptSize = measureNewsPromptSize(NEWS_SYSTEM_PROMPT, userPrompt, promptContext);
  logNewsPromptSize(promptSize);
  assertNewsPromptWithinLimits(promptSize);

  let draft = await callOpenAiNews(userPrompt);
  const repaired = await repairNewsArticle(draft, generationContext, articleType);

  const generationSources = buildGenerationSources(
    generationContext,
    articleType,
    repaired,
    promptSize
  );

  return {
    promptVersion: NEWS_PROMPT_VERSION,
    author: NEWS_AUTHOR,
    articleType,
    raceNumber: isDriverSpotlight ? null : generationContext.requestedRaceNumber,
    newsTopic: generationContext.newsTopic || null,
    article: repaired.article,
    validation: repaired.validation,
    repairAttempted: repaired.repairAttempted,
    repairAttempts: repaired.repairAttempts,
    repairReasons: repaired.repairReasons,
    generationSources,
    promptSize,
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
    savedTranscriptUsed: meta.savedTranscriptUsed === true,
    savedTranscriptRaceNumber: meta.savedTranscriptRaceNumber ?? null,
    savedTranscriptLength: meta.savedTranscriptLength ?? 0,
    transcriptSource: meta.transcriptSource || 'none',
    broadcastSource: meta.broadcastContext?.source || null,
    youtubeDiagnostics: meta.youtubeDiagnostics || null,
  };
}

function buildGenerationSources(generationContext, articleType, repaired, promptSize = null) {
  const grounding = generationContext.factualGrounding || {};
  const meta = generationContext.contextMeta || {};
  const manualNotes = Boolean(String(generationContext.manualRaceNotes || '').trim());
  const savedTranscriptUsed = meta.savedTranscriptUsed === true;
  const transcriptUsed = meta.transcriptUsed === true;
  const spotlightDriverId = generationContext.spotlightDriverId || null;
  const spotlightGrounding = spotlightDriverId
    ? grounding.drivers?.[String(spotlightDriverId)] || null
    : null;
  const careerStatsDiagnostics = generationContext.careerStatsDiagnostics || null;
  const mixedScopeClaims = repaired.validation?.mixedScopeClaims || [];
  const unsupportedCareerSummaryClaims =
    repaired.validation?.unsupportedFacts?.filter((fact) =>
      [
        'unsupported-career-summary',
        'unsupported-career-stat',
        'unsupported-career-scope',
        'unsupported-career-tenure',
        'unsupported-mixed-scope',
        'unsupported-mixed-scope-season-career',
        'career-stat-labeled-as-season',
        'season-stat-labeled-as-career',
        'historical-season-points-mismatch',
        'unsupported-best-points-claim',
        'cross-season-points-comparison',
      ].includes(fact.type)
    ) || [];

  let dataQualityScore = 40;
  if ((generationContext.standings || []).length) dataQualityScore += 25;
  if ((generationContext.recentResultsForGrounding || []).length) dataQualityScore += 15;
  if (grounding.diagnostics?.recentRaceFinishesUsed) dataQualityScore += 10;
  if (savedTranscriptUsed) dataQualityScore += 25;
  else if (manualNotes) dataQualityScore += 25;
  else if (transcriptUsed && meta.transcriptSource === 'youtube') dataQualityScore += 20;

  const confidenceScore =
    savedTranscriptUsed && (generationContext.standings || []).length
      ? 'HIGH'
      : manualNotes && (generationContext.standings || []).length
        ? 'HIGH'
        : transcriptUsed || (generationContext.standings || []).length
          ? 'MEDIUM'
          : 'LOW';

  return {
    articleType,
    spotlightDriverId,
    leagueCareerStatsUsed: careerStatsDiagnostics?.leagueCareerStatsUsed === true,
    currentSeasonStatsUsed: Boolean(spotlightGrounding?.allowedSeasonStats),
    mixedScopeClaims,
    repairedMixedScopeFields: repaired.repairedMixedScopeFields || [],
    recentResultsUsed: Boolean(
      spotlightGrounding?.recentRaceFinishes?.length ||
        spotlightGrounding?.verifiedRaceFinishes?.length
    ),
    transcriptSource: meta.transcriptSource || 'none',
    factsUsed: repaired.validation?.mentionedDrivers || [],
    resultsUsed: generationContext.recentResultsForGrounding || [],
    standingsSnapshot: (generationContext.standings || []).slice(0, 10).map((row) => ({
      position: row.position,
      driverName: row.driverName,
      points: row.points,
      wins: row.wins,
    })),
    transcriptUsed,
    transcriptMode: meta.transcriptMode || 'none',
    manualNotesUsed: manualNotes,
    savedTranscriptUsed,
    savedTranscriptRaceNumber: meta.savedTranscriptRaceNumber ?? null,
    savedTranscriptLength: meta.savedTranscriptLength ?? 0,
    transcriptSource: meta.transcriptSource || 'none',
    validationWarnings: repaired.validation?.warnings || [],
    validationErrors: repaired.validation?.errors || [],
    headlineValidationErrors: repaired.validation?.headlineValidationErrors || [],
    subheadlineValidationErrors: repaired.validation?.subheadlineValidationErrors || [],
    summaryValidationErrors: repaired.validation?.summaryValidationErrors || [],
    bodyValidationErrors: repaired.validation?.bodyValidationErrors || [],
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
    careerHistoryDiagnostics: grounding.careerHistoryAudit
      ? {
          seasonsScanned: grounding.careerHistoryAudit.seasonsScanned,
          seriesScanned: grounding.careerHistoryAudit.seriesScanned,
          firstTruckSeason: grounding.careerHistoryAudit.firstTruckSeason,
          firstBpSeasonOverall: grounding.careerHistoryAudit.firstBpSeasonOverall,
          classificationReliable: grounding.careerHistoryAudit.classificationReliable,
          classificationIssues: grounding.careerHistoryAudit.classificationIssues || [],
        }
      : null,
    careerStatsDiagnostics: careerStatsDiagnostics
      ? {
          ...careerStatsDiagnostics,
          unsupportedCareerSummaryClaims,
          rejectedUnsupportedClaims:
            repaired.validation?.unsupportedFacts?.map((fact) => ({
              type: fact.type,
              claim: fact.claim,
              message: fact.message,
            })) || [],
        }
      : null,
    promptSize,
  };
}

export { parseBody, normalizeArticleType, ARTICLE_TYPES, NewsPromptTooLargeError };
