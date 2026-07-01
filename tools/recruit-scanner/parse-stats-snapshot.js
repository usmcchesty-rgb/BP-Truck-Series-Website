import {
  evaluateStatsCompletion,
  getMissingRequiredStatsFields,
  logMissingRequiredStatsFields,
} from './dom-stats-extractor.js';

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseInteger(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw) return null;
  const num = Number.parseInt(raw, 10);
  return Number.isFinite(num) ? num : null;
}

function parseDecimal(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  if (!raw) return null;
  const num = Number.parseFloat(raw);
  return Number.isFinite(num) ? num : null;
}

function extractOvalRowFromText(rawText) {
  const text = normalizeWhitespace(rawText);
  const tableMatch = text.match(
    /Oval[\s,]+([\d,]+)[\s,]+([\d,]+)[\s,]+([\d,]+)[\s,]+([\d,]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d,]+)[\s,]+([\d,]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i
  );
  if (!tableMatch) return null;

  return {
    category: 'Oval',
    starts: parseInteger(tableMatch[1]),
    wins: parseInteger(tableMatch[2]),
    top5: parseInteger(tableMatch[3]),
    poles: parseInteger(tableMatch[4]),
    avgStart: parseDecimal(tableMatch[5]),
    avgFinish: parseDecimal(tableMatch[6]),
    totalLaps: parseInteger(tableMatch[7]),
    lapsLed: parseInteger(tableMatch[8]),
    incidentsPerRace: parseDecimal(tableMatch[9]),
    pointsPerRace: parseDecimal(tableMatch[10]),
    winPercentage: parseDecimal(tableMatch[11]),
    top5Percentage: parseDecimal(tableMatch[12]),
  };
}

function buildStatsJsonFromDom(data) {
  if (data?.statsByCategory && Object.keys(data.statsByCategory).length) {
    return data.statsByCategory;
  }
  if (data?.category) {
    return { [data.category]: data };
  }
  return {};
}

function buildFlatOvalFields(data, statsJson) {
  const oval = data?.statsByCategory?.Oval || statsJson?.Oval || data || {};
  return {
    category: oval.category || 'Oval',
    starts: oval.starts ?? null,
    wins: oval.wins ?? null,
    top5: oval.top5 ?? null,
    poles: oval.poles ?? null,
    avgStart: oval.avgStart ?? null,
    avgFinish: oval.avgFinish ?? null,
    totalLaps: oval.totalLaps ?? null,
    lapsLed: oval.lapsLed ?? null,
    incidentsPerRace: oval.incidentsPerRace ?? null,
    pointsPerRace: oval.pointsPerRace ?? null,
    winPercentage: oval.winPercentage ?? null,
    top5Percentage: oval.top5Percentage ?? null,
  };
}

function mergeStatsWithTextFallback(domResult) {
  const data = { ...(domResult?.data || {}) };
  const fallbackUsed = [];

  if (!data.statsByCategory || !Object.keys(data.statsByCategory).length) {
    const fromText = extractOvalRowFromText(domResult?.rawText || '');
    if (fromText) {
      data.statsByCategory = { Oval: fromText };
      fallbackUsed.push('statsByCategory:text');
    }
  }

  const flat = buildFlatOvalFields(data, data.statsByCategory);
  Object.assign(data, flat);

  const missingBefore = getMissingRequiredStatsFields(data);
  if (missingBefore.length) {
    const fromText = extractOvalRowFromText(domResult?.rawText || '');
    if (fromText) {
      for (const field of missingBefore) {
        if (fromText[field] != null && String(fromText[field]).trim() !== '') {
          data[field] = fromText[field];
          fallbackUsed.push(`${field}:text`);
        }
      }
      if (!data.category && fromText.category) {
        data.category = fromText.category;
        fallbackUsed.push('category:text');
      }
    }
  }

  if (!Array.isArray(data.yearlyStats)) {
    data.yearlyStats = [];
  }
  if (!data.yearlyParseStatus) {
    data.yearlyParseStatus = data.yearlyStats.length ? 'completed' : 'needs_manual_review';
  }

  return { data, fallbackUsed, rawText: domResult?.rawText || '' };
}

export function parseStatsDomSnapshot(domExtraction) {
  const merged = mergeStatsWithTextFallback(domExtraction);
  const completion = evaluateStatsCompletion(merged.data);
  const statsJson = buildStatsJsonFromDom(merged.data);

  return {
    ...completion,
    category: merged.data.category,
    starts: merged.data.starts,
    wins: merged.data.wins,
    top5: merged.data.top5,
    poles: merged.data.poles,
    avg_start: merged.data.avgStart,
    avg_finish: merged.data.avgFinish,
    total_laps: merged.data.totalLaps,
    laps_led: merged.data.lapsLed,
    incidents_per_race: merged.data.incidentsPerRace,
    points_per_race: merged.data.pointsPerRace,
    win_percentage: merged.data.winPercentage,
    top5_percentage: merged.data.top5Percentage,
    statsJson,
    stats_json: statsJson,
    raw_json: statsJson,
    yearly_stats_json: merged.data.yearlyStats || [],
    yearly_parse_status: merged.data.yearlyParseStatus || 'needs_manual_review',
    yearly_parse_error: merged.data.yearlyParseError || null,
    careerCategories: Object.keys(statsJson),
    discoveredSelectors: domExtraction?.discovered || {},
    selectorFailures: domExtraction?.failures || [],
    textFallbacksUsed: merged.fallbackUsed,
    selectorCatalog: domExtraction?.selectorCatalog || {},
  };
}

export function parseStatsTextSnapshot(rawText) {
  const fromText = extractOvalRowFromText(rawText);
  const data = fromText || {
    category: null,
    starts: null,
    wins: null,
    top5: null,
    poles: null,
    avgStart: null,
    avgFinish: null,
    totalLaps: null,
    lapsLed: null,
    incidentsPerRace: null,
    pointsPerRace: null,
    winPercentage: null,
    top5Percentage: null,
  };
  const completion = evaluateStatsCompletion(data);
  const statsJson = fromText ? { Oval: fromText } : {};

  return {
    ...completion,
    category: data.category,
    starts: data.starts,
    wins: data.wins,
    top5: data.top5,
    poles: data.poles,
    avg_start: data.avgStart,
    avg_finish: data.avgFinish,
    total_laps: data.totalLaps,
    laps_led: data.lapsLed,
    incidents_per_race: data.incidentsPerRace,
    points_per_race: data.pointsPerRace,
    win_percentage: data.winPercentage,
    top5_percentage: data.top5Percentage,
    statsJson,
    stats_json: statsJson,
    raw_json: statsJson,
    yearly_stats_json: [],
    yearly_parse_status: 'needs_manual_review',
    yearly_parse_error: 'Yearly stats not available from text fallback',
    careerCategories: Object.keys(statsJson),
  };
}

export function logStatsParseResult(logger, parsed) {
  logMissingRequiredStatsFields(logger, parsed.missingFields);
  if (parsed.careerCategories?.length) {
    logger(`Stats categories parsed: ${parsed.careerCategories.join(', ')}`);
  }
  logger(`Yearly progression: ${parsed.yearly_parse_status || 'unknown'}`);
  for (const field of parsed.textFallbacksUsed || []) {
    logger(`Stats text fallback used: ${field}`);
  }
}
