import { validateWriteupFactualGrounding } from './_power-rankings-factual-grounding.js';
import {
  validateDriverSpotlightField,
  buildSpotlightVerifiedStatsRepairBlock,
  SPOTLIGHT_SCOPE_ERROR_TYPES,
} from './_driver-career-history.js';

function resolveCurrentSeasonBpNumber(context = {}, spotlightGrounding = null) {
  if (Number.isFinite(context.currentSeasonBpNumber)) {
    return context.currentSeasonBpNumber;
  }
  const catalog = context.factualGrounding?.careerHistoryAudit;
  const currentSeasonId = catalog?.currentSeasonId;
  if (currentSeasonId && catalog?.seasons) {
    const season = catalog.seasons.find(
      (entry) => String(entry.seasonId) === String(currentSeasonId)
    );
    if (Number.isFinite(season?.bpSeasonNumber)) return season.bpSeasonNumber;
  }
  const name = catalog?.currentSeasonName || '';
  const match = String(name).match(/season\s*#?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}
import { ARTICLE_TYPES } from '../server/config/news-system-prompt.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function claimSupportedInNotes(claimText, manualRaceNotes, transcriptSummary) {
  const claim = normalizeText(claimText);
  if (!claim) return false;
  const sources = [manualRaceNotes, transcriptSummary]
    .filter(Boolean)
    .map(normalizeText);
  return sources.some(
    (source) =>
      source.includes(claim) ||
      claim
        .split(' ')
        .filter((word) => word.length > 3 && source.includes(word)).length >= 2
  );
}

const FORBIDDEN_CLAIM_PATTERNS = [
  {
    type: 'unsupported-caution',
    pattern: /\b(\d+\s+)?cautions?\b|\byellow flags?\b|\bunder caution\b/i,
    message: 'Mentions cautions without verified support in notes/transcript.',
  },
  {
    type: 'unsupported-crash',
    pattern: /\b(wreck|crashed|crash(ed)?|spun out|t-boned|collected)\b/i,
    message: 'Mentions crashes/wrecks without verified support in notes/transcript.',
  },
  {
    type: 'unsupported-incident',
    pattern: /\b(incident|on-track incident|trouble in turn)\b/i,
    message: 'Mentions incidents without verified support in notes/transcript.',
  },
  {
    type: 'unsupported-penalty',
    pattern: /\b(penalty|penalties|drive-through|stop-and-go|black flag)\b/i,
    message: 'Mentions penalties without verified support in notes/transcript.',
  },
  {
    type: 'unsupported-strategy',
    pattern: /\b(pit strategy|fuel mileage|fuel window|two-stop|one-stop|undercut|overcut)\b/i,
    message: 'Mentions strategy without verified support in notes/transcript.',
  },
  {
    type: 'unsupported-lead-change',
    pattern: /\b(lead changes?|took the lead|led \d+ laps)\b/i,
    message: 'Mentions lead changes/laps led without verified support in notes/transcript.',
  },
  {
    type: 'unsupported-rivalry',
    pattern: /\b(rivalry|heated exchange|argument|confrontation|bad blood)\b/i,
    message: 'Mentions rivalries/arguments without verified support in notes/transcript.',
  },
];

const QUOTE_PATTERN = /"[^"]{8,}"/g;

export function findMentionedDrivers(text, standings = []) {
  const lower = String(text || '').toLowerCase();
  const mentioned = [];

  for (const row of standings) {
    const name = String(row.driverName || '').trim();
    if (!name) continue;
    const tokens = name.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const lastName = tokens[tokens.length - 1];
    if (
      lower.includes(name.toLowerCase()) ||
      (lastName && new RegExp(`\\b${lastName}\\b`, 'i').test(text))
    ) {
      mentioned.push(row);
    }
  }

  return mentioned;
}

export function validateNewsArticle(article, context = {}) {
  const errors = [];
  const warnings = [];
  const unsupportedFacts = [];

  const body = String(article?.body || '').trim();
  const headline = String(article?.headline || '').trim();
  const subheadline = String(article?.subheadline || '').trim();
  const summary = String(article?.summary || '').trim();
  const fullText = `${headline}\n${subheadline}\n${summary}\n${body}`.trim();
  const articleType = context.articleType || 'race-recap';
  const typeConfig = ARTICLE_TYPES[articleType] || ARTICLE_TYPES['race-recap'];
  const wordCount = countWords(body);

  if (!headline) {
    errors.push({ type: 'missing-headline', message: 'Headline is required.' });
  }

  if (!body) {
    errors.push({ type: 'missing-body', message: 'Article body is required.' });
    return { valid: false, errors, warnings, unsupportedFacts, wordCount };
  }

  if (wordCount < typeConfig.minWords) {
    errors.push({
      type: 'too-short',
      message: `Article is ${wordCount} words; minimum for ${typeConfig.label} is ${typeConfig.minWords}.`,
    });
  }

  if (wordCount > typeConfig.maxWords + 80) {
    errors.push({
      type: 'too-long',
      message: `Article is ${wordCount} words; maximum for ${typeConfig.label} is ${typeConfig.maxWords}.`,
    });
  }

  if (/\b(AI|artificial intelligence|language model|generated content|automation)\b/i.test(fullText)) {
    errors.push({
      type: 'forbidden-meta',
      message: 'Article must not mention AI, automation, or generated content.',
    });
  }

  if (/\b(Pedal Prophet)\b/i.test(fullText)) {
    warnings.push({
      type: 'author-confusion',
      message: 'Pedal Prophet is reserved for Power Rankings opinion columns — use Miles Apex voice only.',
    });
  }

  const manualNotes = context.manualRaceNotes || '';
  const transcriptSummary =
    context.broadcastContext?.summary || context.transcriptSummary || '';

  function pushSpotlightFieldError(err, fieldName, driverName = null) {
    const enriched = { ...err, articleField: fieldName };
    unsupportedFacts.push({
      type: enriched.type,
      claim: enriched.claim || enriched.message,
      driverName,
      message: enriched.message,
      articleField: fieldName,
    });
    errors.push({
      type: enriched.type,
      message: driverName ? `${driverName} (${fieldName}): ${enriched.message}` : `${fieldName}: ${enriched.message}`,
      claim: enriched.claim,
      articleField: fieldName,
      field: enriched.field,
    });
  }

  const headlineValidationErrors = [];
  const subheadlineValidationErrors = [];
  const summaryValidationErrors = [];
  const bodyValidationErrors = [];

  if (articleType === 'driver-spotlight' && context.spotlightDriverId) {
    const spotlightGrounding =
      context.factualGrounding?.drivers?.[String(context.spotlightDriverId)] || null;
    const truckHistory =
      spotlightGrounding?.truckSeriesCareerHistory ||
      spotlightGrounding?.careerHistory?.truckSeriesCareerHistory ||
      spotlightGrounding?.careerHistory ||
      null;
    const spotlightValidationContext = {
      truckSeriesCareerHistory: truckHistory,
      careerHistory: spotlightGrounding?.careerHistory,
      leagueCareerStats:
        spotlightGrounding?.leagueCareerStats ||
        context.leagueCareerStats ||
        null,
      leagueCareerSummary:
        spotlightGrounding?.leagueCareerSummary ||
        context.leagueCareerSummary ||
        null,
      allowedSeasonStats: spotlightGrounding?.allowedSeasonStats || null,
      currentSeasonBpNumber: resolveCurrentSeasonBpNumber(context, spotlightGrounding),
      manualRaceNotes: manualNotes,
      transcriptSummary,
    };

    const spotlightFields = {
      headline,
      subheadline,
      summary,
      body,
    };

    const fieldErrorBuckets = {
      headline: headlineValidationErrors,
      subheadline: subheadlineValidationErrors,
      summary: summaryValidationErrors,
      body: bodyValidationErrors,
    };

    for (const [fieldName, fieldText] of Object.entries(spotlightFields)) {
      if (!fieldText) continue;
      for (const err of validateDriverSpotlightField(fieldText, spotlightValidationContext)) {
        fieldErrorBuckets[fieldName].push(err);
        pushSpotlightFieldError(err, fieldName, spotlightGrounding?.driverName || null);
      }
    }
  }

  for (const rule of FORBIDDEN_CLAIM_PATTERNS) {
    const match = fullText.match(rule.pattern);
    if (!match) continue;
    const supported = claimSupportedInNotes(match[0], manualNotes, transcriptSummary);
    if (!supported) {
      unsupportedFacts.push({
        type: rule.type,
        claim: match[0],
        message: rule.message,
      });
      errors.push({
        type: rule.type,
        message: rule.message,
        claim: match[0],
      });
    }
  }

  const quotes = fullText.match(QUOTE_PATTERN) || [];
  for (const quote of quotes) {
    const supported = claimSupportedInNotes(quote, manualNotes, transcriptSummary);
    if (!supported) {
      unsupportedFacts.push({
        type: 'unsupported-quote',
        claim: quote,
        message: 'Direct quote not found in manual notes or transcript.',
      });
      errors.push({
        type: 'unsupported-quote',
        message: 'Direct quotes require support in manual notes or transcript.',
        claim: quote,
      });
    }
  }

  const standings = context.standings || [];
  const mentionedDrivers = findMentionedDrivers(fullText, standings);
  const groundingFields =
    articleType === 'driver-spotlight'
      ? { headline, subheadline, summary, body }
      : { body };

  for (const driver of mentionedDrivers) {
    const driverGrounding =
      context.factualGrounding?.drivers?.[String(driver.driverId)] || null;

    for (const [fieldName, fieldText] of Object.entries(groundingFields)) {
      if (!fieldText) continue;
      const { unsupported = [] } = validateWriteupFactualGrounding(fieldText, {
        driverId: driver.driverId,
        driverName: driver.driverName,
        driverGrounding,
        factualGrounding: driverGrounding,
        alignedRaces: context.alignedRaces,
        recentResults: context.recentResultsForGrounding,
        driverLookup: context.driverLookup,
        manualRaceNotes: manualNotes,
        transcriptSummary,
        rank: driver.position,
      });

      for (const err of unsupported) {
        unsupportedFacts.push({
          type: err.type || 'unsupported-facts',
          claim: err.claim || err.message,
          driverName: driver.driverName,
          message: err.message,
          articleField: fieldName,
        });
        errors.push({
          type: err.type || 'unsupported-facts',
          message: `${driver.driverName} (${fieldName}): ${err.message}`,
          claim: err.claim,
          articleField: fieldName,
        });
        if (fieldName === 'headline') headlineValidationErrors.push(err);
        else if (fieldName === 'subheadline') subheadlineValidationErrors.push(err);
        else if (fieldName === 'summary') summaryValidationErrors.push(err);
        else bodyValidationErrors.push(err);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    unsupportedFacts,
    rejectedUnsupportedClaims: unsupportedFacts.map((fact) => ({
      type: fact.type,
      claim: fact.claim,
      message: fact.message,
      driverName: fact.driverName || null,
      articleField: fact.articleField || null,
    })),
    mixedScopeClaims: unsupportedFacts
      .filter((fact) => SPOTLIGHT_SCOPE_ERROR_TYPES.has(fact.type))
      .map((fact) => ({
        type: fact.type,
        claim: fact.claim,
        message: fact.message,
        articleField: fact.articleField || null,
      })),
    headlineValidationErrors,
    subheadlineValidationErrors,
    summaryValidationErrors,
    bodyValidationErrors,
    wordCount,
    mentionedDrivers: mentionedDrivers.map((d) => d.driverName),
  };
}

export const REPAIRABLE_NEWS_ERROR_TYPES = new Set([
  'too-short',
  'too-long',
  'unsupported-caution',
  'unsupported-crash',
  'unsupported-incident',
  'unsupported-penalty',
  'unsupported-strategy',
  'unsupported-lead-change',
  'unsupported-rivalry',
  'unsupported-quote',
  'unsupported-facts',
  'unsupported-career-tenure',
  'unsupported-career-stat',
  'unsupported-career-summary',
  'unsupported-career-scope',
  'unsupported-mixed-scope',
  'unsupported-mixed-scope-season-career',
  'career-stat-labeled-as-season',
  'season-stat-labeled-as-career',
  'historical-season-points-mismatch',
  'unsupported-best-points-claim',
  'cross-season-points-comparison',
  'unsupported-driver-style',
  'forbidden-meta',
]);

export function formatNewsValidationForRepair(validation, repairContext = {}) {
  if (!validation?.errors?.length) return 'No validation errors.';
  const fieldSections = [
    ['headline', validation.headlineValidationErrors],
    ['subheadline', validation.subheadlineValidationErrors],
    ['summary', validation.summaryValidationErrors],
    ['body', validation.bodyValidationErrors],
  ]
    .filter(([, errs]) => errs?.length)
    .map(
      ([field, errs]) =>
        `${field}:\n${errs.map((err) => `  - [${err.type}] ${err.message}${err.claim ? ` (claim: "${err.claim}")` : ''}`).join('\n')}`
    );

  const lines = validation.errors.map(
    (err) =>
      `- [${err.type}] (${err.articleField || 'article'}) ${err.message}${err.claim ? ` (claim: "${err.claim}")` : ''}`
  );

  const statsBlock = buildSpotlightVerifiedStatsRepairBlock(repairContext);

  return [
    'Fix ALL fields (headline, subheadline, summary, body). Rewrite every affected field so season stats, career stats, and historical-season references are internally consistent.',
    'Never label a league career total as "this season". Never label a current-season total as "career".',
    'Never attach current-season points to a historical season. For past seasons, use finishing position and season name.',
    statsBlock ? `\n${statsBlock}\n` : '',
    'Career totals in headline/subheadline/summary/body must exactly match leagueCareerStats.',
    'Current-season totals must exactly match currentSeasonStats and use this season/current season labeling.',
    '',
    ...(fieldSections.length ? ['Errors by field:', ...fieldSections, ''] : []),
    'All errors:',
    ...lines,
  ].join('\n');
}
