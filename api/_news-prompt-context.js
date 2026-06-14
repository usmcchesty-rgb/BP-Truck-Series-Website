import { findMentionedDrivers } from './_news-validation.js';
import { matchDriverIdByName } from './_power-rankings-recent-form.js';

export const NEWS_TRANSCRIPT_MAX_CHARS = 15000;
export const NEWS_PROMPT_ABORT_TOKEN_LIMIT = 100000;
export const NEWS_PROMPT_TARGET_TOKEN_LIMIT = 50000;

const RACE_KEYWORD_PATTERNS = [
  /\brace\b/i,
  /\blap(?:s)?\b/i,
  /\bcaution/i,
  /\brestart/i,
  /\blead(?:er|ing)?\b/i,
  /\bpass(?:ing|ed|es)?\b/i,
  /\bwinner/i,
  /\bwin(?:s|ning)?\b/i,
  /\bfinish/i,
  /\bcheckered/i,
  /\bgreen flag/i,
  /\bpit(?:ted| stop)?\b/i,
  /\bwreck/i,
  /\bcrash/i,
  /\bincident/i,
  /\bspin/i,
  /\bdamage/i,
  /\bpoints\b/i,
  /\btop\s+(?:five|5|ten|10)/i,
  /\bstage/i,
  /\bfinal lap/i,
  /\btruck/i,
  /\bP\d+\b/,
];

const TRANSCRIPT_NOISE_PATTERNS = [
  /^(?:hey|hi|hello|what'?s up|welcome back|good evening|good afternoon|how'?s it going)[^.!?]*[.!?]$/i,
  /^(?:thanks for (?:joining|watching|tuning in)|we'?ll be right back)[^.!?]*[.!?]$/i,
  /(?:thanks to our sponsors?|brought to you by|use code|promo code|discount code)[^.!?]*[.!?]/gi,
  /(?:don'?t forget to like and subscribe|hit that subscribe|smash that like)[^.!?]*[.!?]/gi,
  /(?:shoutout to|quick shout)[^.!?]*[.!?]/gi,
];

export class NewsPromptTooLargeError extends Error {
  constructor(message, promptSize) {
    super(message);
    this.name = 'NewsPromptTooLargeError';
    this.promptSize = promptSize;
    this.status = 400;
  }
}

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12);
}

function isNoiseSentence(sentence) {
  const trimmed = String(sentence || '').trim();
  if (!trimmed) return true;
  if (trimmed.length < 20 && !RACE_KEYWORD_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true;
  }
  return TRANSCRIPT_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function scoreTranscriptSentence(sentence, drivers = []) {
  let score = 0;
  if (isNoiseSentence(sentence)) return -5;

  for (const pattern of RACE_KEYWORD_PATTERNS) {
    if (pattern.test(sentence)) score += 3;
  }

  for (const driver of drivers) {
    const name = String(driver.driverName || '').trim();
    if (!name) continue;
    if (sentence.toLowerCase().includes(name.toLowerCase())) score += 4;
    const lastName = name.split(/\s+/).pop();
    if (lastName && new RegExp(`\\b${lastName}\\b`, 'i').test(sentence)) score += 2;
  }

  return score;
}

export function truncateTranscriptForNews(text, options = {}) {
  const maxChars = Number(options.maxChars) || NEWS_TRANSCRIPT_MAX_CHARS;
  const drivers = options.drivers || [];
  const raw = String(text || '').trim();

  if (!raw) {
    return { text: '', originalLength: 0, truncatedLength: 0, sentenceCount: 0 };
  }

  if (raw.length <= maxChars) {
    return {
      text: raw,
      originalLength: raw.length,
      truncatedLength: raw.length,
      sentenceCount: splitSentences(raw).length,
    };
  }

  const sentences = splitSentences(raw);
  const scored = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: scoreTranscriptSentence(sentence, drivers),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [];
  const seen = new Set();
  let length = 0;

  const addSentence = (sentence, index = 0) => {
    const normalized = sentence.trim();
    if (!normalized || seen.has(normalized)) return false;
    const nextLength = length + normalized.length + 1;
    if (nextLength > maxChars) return false;
    seen.add(normalized);
    selected.push({ sentence: normalized, index });
    length = nextLength;
    return true;
  };

  for (const item of scored) {
    addSentence(item.sentence, item.index);
    if (length >= maxChars) break;
  }

  if (length < maxChars * 0.35) {
    sentences.forEach((sentence, index) => {
      if (isNoiseSentence(sentence)) return;
      addSentence(sentence, index);
    });
  }

  selected.sort((a, b) => a.index - b.index);

  return {
    text: selected.map((row) => row.sentence).join(' '),
    originalLength: raw.length,
    truncatedLength: length,
    sentenceCount: selected.length,
  };
}

function formatStandingsRow(row) {
  return `${row.position}. ${row.driverName} (#${row.carNumber || '—'}) — ${row.points} pts, ${row.wins} wins, ${row.top5} top 5s, ${row.top10} top 10s`;
}

export function buildPromptStandingsSnapshot(standings = [], options = {}) {
  const spotlightDriverId = options.spotlightDriverId
    ? String(options.spotlightDriverId)
    : null;
  const referencedDriverIds = new Set(
    (options.referencedDriverIds || []).map((id) => String(id))
  );

  const topTen = standings.slice(0, 10);
  const topTenIds = new Set(topTen.map((row) => String(row.driverId)));
  const extraRows = [];

  if (spotlightDriverId && !topTenIds.has(spotlightDriverId)) {
    const spotlightRow = standings.find((row) => String(row.driverId) === spotlightDriverId);
    if (spotlightRow) extraRows.push(spotlightRow);
  }

  for (const row of standings) {
    const driverId = String(row.driverId);
    if (referencedDriverIds.has(driverId) && !topTenIds.has(driverId)) {
      extraRows.push(row);
    }
  }

  const uniqueExtra = [];
  const seen = new Set(topTenIds);
  for (const row of extraRows) {
    const driverId = String(row.driverId);
    if (seen.has(driverId)) continue;
    seen.add(driverId);
    uniqueExtra.push(row);
  }

  const lines = [
    ...topTen.map(formatStandingsRow),
    ...uniqueExtra.map((row) => `[Also referenced] ${formatStandingsRow(row)}`),
  ];

  return {
    text: lines.join('\n') || '(none)',
    driverIds: [...topTenIds, ...uniqueExtra.map((row) => String(row.driverId))],
    topTenCount: topTen.length,
    extraCount: uniqueExtra.length,
  };
}

function collectReferencedDriverIds(generationContext, options = {}) {
  const standings = generationContext.standings || [];
  const ids = new Set();
  const driverLookup = generationContext.driverLookup;

  const textSources = [
    options.headlineOverride || '',
    generationContext.manualRaceNotes || '',
    generationContext.contextMeta?.broadcastContext?.summary || '',
  ].join('\n');

  for (const driver of findMentionedDrivers(textSources, standings)) {
    ids.add(String(driver.driverId));
  }

  const raceNumber = Number(options.raceNumber ?? generationContext.raceNumber);
  const raceRow = generationContext.scheduleRaces?.find(
    (race) => race.officialPointsRaceNumber === raceNumber
  );
  if (raceRow?.winner && driverLookup) {
    const winnerId = matchDriverIdByName(raceRow.winner, driverLookup);
    if (winnerId) ids.add(String(winnerId));
  }

  for (const race of generationContext.recentResultsForGrounding || []) {
    if (!race?.winner || !driverLookup) continue;
    const winnerId = matchDriverIdByName(race.winner, driverLookup);
    if (winnerId) ids.add(String(winnerId));
  }

  return ids;
}

export function collectPromptDriverIds(generationContext, options = {}) {
  const standings = generationContext.standings || [];
  const ids = new Set();

  for (const row of standings.slice(0, 10)) {
    ids.add(String(row.driverId));
  }

  if (options.spotlightDriverId) {
    ids.add(String(options.spotlightDriverId));
  }

  for (const driverId of collectReferencedDriverIds(generationContext, options)) {
    ids.add(String(driverId));
  }

  return ids;
}

function shouldIncludeCareerHistory(articleType, driverId, options = {}) {
  const id = String(driverId);
  const spotlightId = options.spotlightDriverId ? String(options.spotlightDriverId) : null;

  if (articleType === 'race-recap') return false;
  if (articleType === 'driver-spotlight') return spotlightId && id === spotlightId;
  if (articleType === 'championship-watch') {
    return options.championshipDriverIds?.has(id) === true;
  }
  return spotlightId && id === spotlightId;
}

function slimCareerHistory(history) {
  if (!history) return null;
  return {
    scope: history.scope,
    tenureClaimsAllowed: history.tenureClaimsAllowed,
    firstSeason: history.firstSeason,
    firstSeasonName: history.firstSeasonName,
    seasonsStarted: history.seasonsStarted,
    totalCareerStarts: history.totalCareerStarts,
    careerWins: history.careerWins,
    careerTop5s: history.careerTop5s,
    careerTop10s: history.careerTop10s,
    isFirstTruckSeason: history.isFirstTruckSeason,
    isTruckSeriesVeteran: history.isTruckSeriesVeteran,
    isReturningInScope: history.isReturningInScope,
    priorSeasonResults: (history.priorSeasonResults || []).map((season) => ({
      seasonId: season.seasonId,
      seasonName: season.seasonName,
      bpSeasonNumber: season.bpSeasonNumber,
      starts: season.starts,
      wins: season.wins,
      top5s: season.top5s,
      top10s: season.top10s,
    })),
  };
}

function slimDriverGrounding(grounding, { includeCareerHistory = false } = {}) {
  if (!grounding) return null;

  const slim = {
    driverName: grounding.driverName,
    allowedSeasonStats: grounding.allowedSeasonStats,
    verifiedRaceFinishes: grounding.verifiedRaceFinishes,
    verifiedRaceWins: grounding.verifiedRaceWins,
    recentRaceFinishes: grounding.recentRaceFinishes,
    last3RaceAverageFinish: grounding.last3RaceAverageFinish,
    last3RaceFinishesUsed: grounding.last3RaceFinishesUsed,
    last3TrendDirection: grounding.last3TrendDirection,
  };

  if (includeCareerHistory) {
    slim.truckSeriesCareerHistory = slimCareerHistory(grounding.truckSeriesCareerHistory);
    if (grounding.overallLeagueCareerHistory) {
      slim.overallLeagueCareerHistory = slimCareerHistory(grounding.overallLeagueCareerHistory);
    }
  }

  return slim;
}

export function buildPromptFactualGrounding(generationContext, articleType, options = {}) {
  const fullGrounding = generationContext.factualGrounding || {};
  const promptDriverIds = collectPromptDriverIds(generationContext, options);
  const championshipDriverIds = new Set(
    (generationContext.standings || []).slice(0, 10).map((row) => String(row.driverId))
  );
  if (options.spotlightDriverId) {
    championshipDriverIds.add(String(options.spotlightDriverId));
  }

  const drivers = {};
  let careerHistoryChars = 0;

  for (const driverId of promptDriverIds) {
    const grounding = fullGrounding.drivers?.[String(driverId)];
    if (!grounding) continue;

    const includeCareerHistory = shouldIncludeCareerHistory(articleType, driverId, {
      spotlightDriverId: options.spotlightDriverId,
      championshipDriverIds,
    });

    const slim = slimDriverGrounding(grounding, { includeCareerHistory });
    drivers[String(driverId)] = slim;

    if (includeCareerHistory) {
      careerHistoryChars += JSON.stringify({
        truck: slim.truckSeriesCareerHistory,
        overall: slim.overallLeagueCareerHistory,
      }).length;
    }
  }

  const payload = {
    rules:
      'Use only verified facts in this object, manual notes, or truncated transcript. Do not invent race events. Career tenure language requires truckSeriesCareerHistory when included for a driver.',
    manualNotesAvailable: fullGrounding.manualNotesAvailable === true,
    transcriptSummaryAvailable: fullGrounding.transcriptSummaryAvailable === true,
    recentResultsWinnersOnly: fullGrounding.recentResultsWinnersOnly || [],
    alignedRaces: (fullGrounding.alignedRaces || []).map((race) => ({
      pointsRaceNumber: race.pointsRaceNumber,
      track: race.track,
      winner: race.winner,
    })),
    drivers,
  };

  return {
    payload,
    promptDriverIds: [...promptDriverIds],
    careerHistoryChars,
  };
}

export function buildNewsPromptContext(generationContext, options = {}) {
  const articleType = options.articleType || 'race-recap';
  const spotlightDriverId = options.spotlightDriverId || generationContext.spotlightDriverId || null;
  const referencedDriverIds = collectReferencedDriverIds(generationContext, options);
  const promptDriverIdSet = collectPromptDriverIds(generationContext, {
    ...options,
    spotlightDriverId,
  });
  const promptDriverIds = [...promptDriverIdSet];

  const standingsSnapshot = buildPromptStandingsSnapshot(generationContext.standings || [], {
    spotlightDriverId,
    referencedDriverIds: [...referencedDriverIds],
  });

  const transcriptSources = [];
  const manualNotes = String(generationContext.manualRaceNotes || '').trim();
  const broadcastSummary = String(
    generationContext.contextMeta?.broadcastContext?.summary || ''
  ).trim();

  if (manualNotes) transcriptSources.push(manualNotes);
  if (broadcastSummary && broadcastSummary !== manualNotes) {
    transcriptSources.push(broadcastSummary);
  }

  const driversForScoring = (generationContext.standings || [])
    .filter((row) => promptDriverIds.includes(String(row.driverId)))
    .map((row) => ({ driverName: row.driverName }));

  const truncatedTranscript = truncateTranscriptForNews(transcriptSources.join('\n\n'), {
    maxChars: NEWS_TRANSCRIPT_MAX_CHARS,
    drivers: driversForScoring,
  });

  const factual = buildPromptFactualGrounding(generationContext, articleType, {
    ...options,
    spotlightDriverId,
  });

  return {
    articleType,
    spotlightDriverId,
    promptDriverIds,
    standingsSnapshot,
    truncatedTranscript,
    factualGrounding: factual.payload,
    careerHistoryChars: factual.careerHistoryChars,
  };
}

export function buildNewsUserPromptFromContext(generationContext, promptContext, options = {}) {
  const typeConfig = options.typeConfig;
  const raceNumber = Number(options.raceNumber ?? generationContext.raceNumber);
  const headlineOverride = String(options.headlineOverride || '').trim();
  const spotlight = generationContext.standings?.find(
    (row) => String(row.driverId) === String(promptContext.spotlightDriverId)
  );

  const recentResults = (generationContext.recentResultsForGrounding || [])
    .map(
      (race) =>
        `Race ${race.raceNumber}: ${race.track} — Winner: ${race.winner || 'TBD'} (${race.date || ''})`
    )
    .join('\n');

  const raceRow = generationContext.scheduleRaces?.find(
    (race) => race.officialPointsRaceNumber === raceNumber
  );

  const factualJson = JSON.stringify(promptContext.factualGrounding);

  return `Write a ${typeConfig.label} article for the Blazing Pedals Truck Series.

Article type: ${typeConfig.label}
Target length: ${typeConfig.minWords}-${typeConfig.maxWords} words
Structure: ${typeConfig.structure}
Race number: ${raceNumber}
Track: ${raceRow?.track || 'See schedule context'}
Race date: ${raceRow?.date || 'TBD'}
Winner (if completed): ${raceRow?.winner || 'TBD'}
Author byline: ${options.author || 'Miles Apex'}
${headlineOverride ? `Suggested headline direction: ${headlineOverride}` : ''}
${spotlight ? `Spotlight driver: ${spotlight.driverName} (P${spotlight.position}, ${spotlight.points} pts)` : ''}

Standings snapshot:
${promptContext.standingsSnapshot.text}

Recent results:
${recentResults || '(none)'}

Factual grounding (verified facts only):
${factualJson}

Race notes / transcript (trimmed to race-relevant content):
${promptContext.truncatedTranscript.text || '(none)'}

Return JSON only with headline, subheadline, summary, and body.`;
}

export function measureNewsPromptSize(systemPrompt, userPrompt, promptContext) {
  const transcriptTokens = estimateTokens(promptContext.truncatedTranscript.text);
  const standingsTokens = estimateTokens(promptContext.standingsSnapshot.text);
  const careerHistoryTokens = estimateTokens(
    JSON.stringify(
      Object.values(promptContext.factualGrounding.drivers || {})
        .map((driver) => ({
          truck: driver.truckSeriesCareerHistory,
          overall: driver.overallLeagueCareerHistory,
        }))
        .filter((entry) => entry.truck || entry.overall)
    )
  );
  const factualGroundingTokens = estimateTokens(JSON.stringify(promptContext.factualGrounding));
  const systemTokens = estimateTokens(systemPrompt);
  const userTokens = estimateTokens(userPrompt);
  const totalEstimatedTokens = systemTokens + userTokens;

  return {
    transcriptTokens,
    standingsTokens,
    careerHistoryTokens,
    factualGroundingTokens,
    systemTokens,
    userTokens,
    totalEstimatedTokens,
    targetTokenLimit: NEWS_PROMPT_TARGET_TOKEN_LIMIT,
    abortTokenLimit: NEWS_PROMPT_ABORT_TOKEN_LIMIT,
    transcriptOriginalLength: promptContext.truncatedTranscript.originalLength,
    transcriptTruncatedLength: promptContext.truncatedTranscript.truncatedLength,
    promptDriverCount: promptContext.promptDriverIds.length,
  };
}

export function assertNewsPromptWithinLimits(promptSize) {
  if (promptSize.totalEstimatedTokens > NEWS_PROMPT_ABORT_TOKEN_LIMIT) {
    throw new NewsPromptTooLargeError(
      `News generation aborted: estimated prompt is ${promptSize.totalEstimatedTokens.toLocaleString()} tokens (limit ${NEWS_PROMPT_ABORT_TOKEN_LIMIT.toLocaleString()}). Reduce transcript/notes length or narrow article scope.`,
      promptSize
    );
  }
}

export function logNewsPromptSize(promptSize) {
  console.log('[news-generate] prompt size', promptSize);
}
