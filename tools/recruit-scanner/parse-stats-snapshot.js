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
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    if (!/^Oval$/i.test(lines[i])) continue;

    const values = lines[i + 1]?.split(/\s+/).filter(Boolean);
    if (!values || values.length < 10) {
      const inline = lines[i].match(
        /^Oval\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)\s+([\d.]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i
      );
      if (!inline) return null;
      return {
        category: 'Oval',
        starts: parseInteger(inline[1]),
        wins: parseInteger(inline[2]),
        top5: parseInteger(inline[3]),
        poles: parseInteger(inline[4]),
        avgStart: parseDecimal(inline[5]),
        avgFinish: parseDecimal(inline[6]),
        totalLaps: parseInteger(inline[7]),
        lapsLed: parseInteger(inline[8]),
        incidentsPerRace: parseDecimal(inline[9]),
        pointsPerRace: parseDecimal(inline[10]),
        winPercentage: parseDecimal(inline[11]),
        top5Percentage: parseDecimal(inline[12]),
      };
    }

    return {
      category: 'Oval',
      starts: parseInteger(values[0]),
      wins: parseInteger(values[1]),
      top5: parseInteger(values[2]),
      poles: parseInteger(values[3]),
      avgStart: parseDecimal(values[4]),
      avgFinish: parseDecimal(values[5]),
      totalLaps: parseInteger(values[6]),
      lapsLed: parseInteger(values[7]),
      incidentsPerRace: parseDecimal(values[8]),
      pointsPerRace: parseDecimal(values[9]),
      winPercentage: parseDecimal(values[10]),
      top5Percentage: parseDecimal(values[11]),
    };
  }

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

function mergeStatsWithTextFallback(domResult) {
  const data = { ...(domResult?.data || {}) };
  const fallbackUsed = [];

  const missingBefore = getMissingRequiredStatsFields(data);
  if (missingBefore.length === 0) {
    return { data, fallbackUsed, rawText: domResult?.rawText || '' };
  }

  const fromText = extractOvalRowFromText(domResult?.rawText || '');
  if (!fromText) {
    return { data, fallbackUsed, rawText: domResult?.rawText || '' };
  }

  for (const field of getMissingRequiredStatsFields(data)) {
    if (fromText[field] != null && String(fromText[field]).trim() !== '') {
      data[field] = fromText[field];
      fallbackUsed.push(`${field}:text`);
    }
  }

  if (!data.category && fromText.category) {
    data.category = fromText.category;
    fallbackUsed.push('category:text');
  }

  return { data, fallbackUsed, rawText: domResult?.rawText || '' };
}

export function parseStatsDomSnapshot(domExtraction) {
  const merged = mergeStatsWithTextFallback(domExtraction);
  const completion = evaluateStatsCompletion(merged.data);

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
    statsJson: merged.data,
    raw_json: merged.data,
    discoveredSelectors: domExtraction?.discovered || {},
    selectorFailures: domExtraction?.failures || [],
    textFallbacksUsed: merged.fallbackUsed,
    selectorCatalog: domExtraction?.selectorCatalog || {},
  };
}

export function parseStatsTextSnapshot(rawText) {
  const data = extractOvalRowFromText(rawText) || {
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
    statsJson: data,
    raw_json: data,
  };
}

export function logStatsParseResult(logger, parsed) {
  logMissingRequiredStatsFields(logger, parsed.missingFields);
  for (const field of parsed.textFallbacksUsed || []) {
    logger(`Stats text fallback used: ${field}`);
  }
}
