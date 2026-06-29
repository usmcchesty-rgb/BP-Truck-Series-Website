import { extractText, getDocumentProxy } from 'unpdf';

const RESULT_ROW_PATTERN =
  /^(\d+)\s+(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d:.]+)\s+(\S.+)$/gm;

const EVENT_LINE_PATTERNS = [
  { type: 'green_flag', pattern: /\bgreen flag\b/i },
  { type: 'full_course_yellow', pattern: /\bfull course yellow\b|\bfcy\b/i },
  { type: 'one_lap_to_green', pattern: /\bone lap to green\b/i },
  { type: 'penalties_cleared', pattern: /\bpenalties cleared\b/i },
  { type: 'race_control', pattern: /\brace control\b/i },
];

function cleanLine(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGeneratedTimestamp(text) {
  const match = text.match(/Generated[:\s]+([^\n\r]+)/i);
  return match ? cleanLine(match[1]) : null;
}

function parseTrackName(text) {
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^race results$/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
        const candidate = lines[j];
        if (/^generated:/i.test(candidate)) continue;
        if (/^sof\b/i.test(candidate)) continue;
        if (/^pos\b/i.test(candidate)) continue;
        if (candidate.length >= 4) return candidate;
      }
    }
  }

  const trackMatch = text.match(/(?:Track|Event)[:\s]+([^\n\r]+)/i);
  if (trackMatch) return cleanLine(trackMatch[1]);

  return null;
}

function parseSof(text) {
  const match = text.match(/\bSOF[:\s]+(\d+)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseResults(text) {
  const results = [];
  const warnings = [];
  let match;

  while ((match = RESULT_ROW_PATTERN.exec(text)) !== null) {
    const position = Number(match[1]);
    const carNumber = Number(match[2]);
    const driverName = cleanLine(match[3]);
    const startPosition = Number(match[4]);
    const incidentCount = Number(match[5]);
    const lapsCompleted = Number(match[6]);
    const bestLap = cleanLine(match[7]);
    const status = cleanLine(match[8]);

    if (!Number.isFinite(position) || !driverName) continue;

    results.push({
      position,
      carNumber: Number.isFinite(carNumber) ? carNumber : null,
      driverName,
      startPosition: Number.isFinite(startPosition) ? startPosition : null,
      incidentCount: Number.isFinite(incidentCount) ? incidentCount : null,
      lapsCompleted: Number.isFinite(lapsCompleted) ? lapsCompleted : null,
      bestLap,
      status,
    });
  }

  if (!results.length) {
    warnings.push('No finishing results table detected in PDF text.');
  }

  results.sort((a, b) => a.position - b.position);
  return { results, warnings };
}

function parseRaceEvents(text) {
  const events = [];
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    for (const { type, pattern } of EVENT_LINE_PATTERNS) {
      if (!pattern.test(line)) continue;
      events.push({
        type,
        text: line,
      });
      break;
    }
  }

  return events;
}

function parseDriverEventSections(text) {
  const drivers = [];
  const sectionPattern = /Driver[:\s]+([^\n\r]+)\r?\n([\s\S]*?)(?=\nDriver[:\s]+|\nSession Report|\nRace Results|$)/gi;
  let match;

  while ((match = sectionPattern.exec(text)) !== null) {
    const driverName = cleanLine(match[1]);
    const body = match[2] || '';
    const eventLines = body
      .split(/\r?\n/)
      .map(cleanLine)
      .filter((line) => line.length > 0);

    if (!driverName || !eventLines.length) continue;

    drivers.push({
      driverName,
      events: eventLines.slice(0, 40),
    });
  }

  return drivers;
}

export async function extractPdfText(buffer) {
  if (!buffer?.length) {
    throw new Error('Empty PDF buffer.');
  }

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return {
    text: String(text || '').trim(),
    totalPages: Number(totalPages) || 0,
  };
}

export function parseRaceControlPdfText(text, options = {}) {
  const parseWarnings = [];
  const raceNumber = options.raceNumber != null ? Number(options.raceNumber) : null;
  const trackHint = options.trackName || null;

  if (!text?.trim()) {
    return {
      raceNumber,
      trackName: trackHint,
      winner: null,
      sof: null,
      cautionCount: 0,
      generatedAt: null,
      results: [],
      raceEvents: [],
      drivers: [],
      parseWarnings: ['PDF contained no extractable text.'],
    };
  }

  const generatedAt = parseGeneratedTimestamp(text);
  const trackName = parseTrackName(text) || trackHint || null;
  const sof = parseSof(text);
  const { results, warnings: resultWarnings } = parseResults(text);
  parseWarnings.push(...resultWarnings);

  const raceEvents = parseRaceEvents(text);
  const drivers = parseDriverEventSections(text);
  const cautionCount = raceEvents.filter((event) => event.type === 'full_course_yellow').length;

  const winnerRow = results.find((row) => row.position === 1) || results[0] || null;
  const winner = winnerRow?.driverName || null;

  if (!trackName) parseWarnings.push('Track name not detected in PDF text.');
  if (sof == null) parseWarnings.push('SOF not detected in PDF text.');
  if (!raceEvents.length) parseWarnings.push('No session report race events detected.');

  return {
    raceNumber,
    trackName,
    winner,
    sof,
    cautionCount,
    generatedAt,
    results,
    raceEvents,
    drivers,
    parseWarnings,
  };
}

export async function parseRaceControlPdfBuffer(buffer, options = {}) {
  const { text, totalPages } = await extractPdfText(buffer);
  const parsed = parseRaceControlPdfText(text, options);

  if (totalPages === 0) {
    parsed.parseWarnings.push('PDF parser returned zero pages.');
  }

  return {
    parsedText: text,
    parsedJson: parsed,
  };
}
