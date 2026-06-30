/**
 * Dump exact parseDriverReports() inputs for one driver (Miguel Gomez-Gaudet).
 * Does NOT modify parser logic. Writes data/debug-driver-report.txt
 *
 * Run: node scripts/debug-driver-report.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeWhitespace, parseRaceControlPdfBuffer } from '../api/_race-control-pdf-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'data', 'debug-driver-report.txt');
const TARGET_DRIVER = 'Miguel Gomez-Gaudet';
const LIVE_PDF_URL =
  'https://oxwgzeyvbjdqveaxzoxs.supabase.co/storage/v1/object/public/race-control-pdfs/season-27987/race-14/race-control.pdf';

// --- Mirror parser constants/patterns (read-only copy, no parser edits) ---
const LAPS_SECTION_HEADER_PATTERN = /\bLAPS\b\s+(?:PRACTICE|QUALIFY|RACE)\b/i;
const RACE_SESSION_START_PATTERN =
  /\bRACE\b(?:\s+L(?:-?\d+|0\b)|\s+\d{2}:\d{2}:\d{2})/i;
const PIT_STOP_PATTERN =
  /(\d{2}:\d{2}:\d{2})\s+L(-?\d+)\s+PIT STOP TIME:\s*([\d.]+)/gi;
const EVENT_PATTERN =
  /(\d{2}:\d{2}:\d{2})\s+L(-?\d+)\s+([^]+?)(?=\d{2}:\d{2}:\d{2}\s+L|$)/gi;

function extractDriverRaceEventsSection(body) {
  const eventsIdx = body.search(/\bEVENTS\b/i);
  const searchFrom = eventsIdx >= 0 ? body.slice(eventsIdx) : body;
  const raceMatch = searchFrom.match(RACE_SESSION_START_PATTERN);
  if (!raceMatch || raceMatch.index == null) return { text: '', meta: { eventsIdx, raceMatch: null } };

  const raceStart = (eventsIdx >= 0 ? eventsIdx : 0) + raceMatch.index;
  const raceContentStart = raceStart + raceMatch[0].length;
  const afterRaceContent = body.slice(raceContentStart);

  const lapsHeader = afterRaceContent.search(LAPS_SECTION_HEADER_PATTERN);
  const nextDriver = afterRaceContent.search(/\d+\s*-\s*[^:]+\s+CLASS:/i);

  let end = afterRaceContent.length;
  if (lapsHeader >= 0) end = Math.min(end, lapsHeader);
  if (nextDriver >= 0) end = Math.min(end, nextDriver);

  return {
    text: afterRaceContent.slice(0, end).trim(),
    meta: {
      eventsIdx,
      raceMatchText: raceMatch[0],
      raceStart,
      raceContentStart,
      lapsHeaderIndex: lapsHeader,
      nextDriverIndex: nextDriver,
      end,
      afterRaceContentLength: afterRaceContent.length,
    },
  };
}

function extractDriverBlock(section, driverName) {
  const blockPattern =
    /(\d+)\s*-\s*([^:]+?)\s+CLASS:\s*([\s\S]*?)(?=\d+\s*-\s*[^:]+\s+CLASS:|$)/gi;

  let match;
  while ((match = blockPattern.exec(section)) !== null) {
    const name = match[2].trim();
    if (!name.includes(driverName)) continue;
    if (/\(cont\.\)/i.test(name)) continue;
    return {
      reportCarNumber: match[1].trim(),
      driverName: name,
      body: match[3] || '',
      blockStartInSection: match.index,
    };
  }
  return null;
}

function findPitStopLiteralOccurrences(text) {
  const needles = ['PIT STOP TIME', 'Pitted in', 'Left the pits', 'PIT STOP', 'Pit stop'];
  const hits = [];
  for (const needle of needles) {
    let idx = 0;
    while ((idx = text.indexOf(needle, idx)) !== -1) {
      hits.push({
        needle,
        index: idx,
        context: text.slice(Math.max(0, idx - 40), idx + needle.length + 60),
      });
      idx += needle.length;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

function collectPitStopRegexMatches(raceSectionText) {
  const matches = [];
  const pattern = new RegExp(PIT_STOP_PATTERN.source, PIT_STOP_PATTERN.flags);
  let match;
  while ((match = pattern.exec(raceSectionText)) !== null) {
    matches.push({
      matchText: match[0],
      groups: [match[1], match[2], match[3]],
      index: match.index,
    });
  }
  return matches;
}

function collectEvents(raceSectionText) {
  const events = [];
  const pattern = new RegExp(EVENT_PATTERN.source, EVENT_PATTERN.flags);
  let match;
  while ((match = pattern.exec(raceSectionText)) !== null) {
    events.push({
      time: match[1],
      lap: match[2],
      text: match[3].trim(),
      index: match.index,
    });
  }
  return events;
}

async function loadNormalizedText() {
  try {
    const res = await fetch(LIVE_PDF_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const { parsedText } = await parseRaceControlPdfBuffer(buf, {
      raceNumber: 14,
      trackName: 'Talladega',
      collectParserDebug: false,
    });
    return { source: LIVE_PDF_URL, text: normalizeWhitespace(parsedText) };
  } catch (error) {
    const fallback = path.join(ROOT, 'data', 'race-control-debug-full.txt');
    return {
      source: fallback,
      text: normalizeWhitespace(fs.readFileSync(fallback, 'utf8')),
      fallbackReason: error.message,
    };
  }
}

function explainNoMatch({ rawBlock, raceSection, raceMeta, literalHits, regexMatches }) {
  const lines = [];
  if (!raceSection.text) {
    lines.push('RACE section extraction returned empty string.');
    if (raceMeta.raceMatch == null) {
      lines.push(`No RACE session marker matched ${RACE_SESSION_START_PATTERN} after EVENTS.`);
    }
    return lines.join('\n');
  }

  if (regexMatches.length) {
    return 'Regex DID match in RACE section — see PIT STOP REGEX MATCHES above.';
  }

  const rawPitHits = literalHits.filter((h) => h.needle.includes('PIT'));
  const racePitHits = rawPitHits.filter(
    (h) => h.index >= raceMeta.raceContentStart - (rawBlock.body.length - raceSection.text.length)
  );

  if (!rawPitHits.length) {
    lines.push('No literal "PIT STOP" / "PIT STOP TIME" substring found anywhere in RAW DRIVER BLOCK.');
  } else {
    lines.push(`Found ${rawPitHits.length} literal PIT-related substring(s) in RAW DRIVER BLOCK.`);
    for (const hit of rawPitHits.slice(0, 8)) {
      lines.push(`  [${hit.index}] ${hit.needle}: ...${hit.context}...`);
    }
    const inRaceSection = rawPitHits.filter((h) => {
      const raceStart = raceMeta.raceContentStart ?? 0;
      const raceEnd = raceStart + raceSection.text.length;
      const absoluteIndex = rawBlock.blockStartInSection + h.index;
      return absoluteIndex >= raceStart && absoluteIndex <= raceEnd;
    });
    if (!inRaceSection.length) {
      lines.push(
        'All PIT STOP TIME occurrences appear OUTSIDE the extracted RACE section — race section likely ends too early or pit stops are in PRACTICE/QUALIFY only.'
      );
    } else {
      lines.push(`${inRaceSection.length} PIT literal(s) appear inside RACE section bounds but regex did not match.`);
      lines.push('Likely cause: text format differs from expected "HH:MM:SS L{lap} PIT STOP TIME: {seconds}".');
      for (const hit of inRaceSection) {
        lines.push(`  mismatch context: ...${hit.context}...`);
      }
    }
  }

  if (raceMeta.lapsHeaderIndex >= 0) {
    lines.push(
      `RACE section truncated at LAPS header (relative index ${raceMeta.lapsHeaderIndex} in post-RACE content).`
    );
  }

  return lines.join('\n');
}

async function main() {
  const loaded = await loadNormalizedText();
  const startIdx = loaded.text.indexOf('INCIDENT REPORTS');
  if (startIdx === -1) {
    throw new Error('INCIDENT REPORTS section not found in source text.');
  }

  const section = loaded.text.slice(startIdx + 'INCIDENT REPORTS'.length);
  const block = extractDriverBlock(section, TARGET_DRIVER);
  if (!block) {
    throw new Error(`Driver block not found for ${TARGET_DRIVER}`);
  }

  const raceSection = extractDriverRaceEventsSection(block.body);
  const literalHits = findPitStopLiteralOccurrences(block.body);
  const regexMatches = collectPitStopRegexMatches(raceSection.text);
  const events = collectEvents(raceSection.text);

  const pitEvents = events.filter((e) => /pit|PIT/i.test(e.text));
  const noMatchExplanation =
    regexMatches.length === 0
      ? explainNoMatch({
          rawBlock: block,
          raceSection,
          raceMeta: raceSection.meta,
          literalHits,
          regexMatches,
        })
      : null;

  const lines = [];
  lines.push(`Source: ${loaded.source}`);
  if (loaded.fallbackReason) {
    lines.push(`Fallback reason: ${loaded.fallbackReason}`);
  }
  lines.push(`Driver: ${block.driverName}`);
  lines.push(`Report header car number: ${block.reportCarNumber}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('===================================');
  lines.push('RAW DRIVER BLOCK');
  lines.push('===================================');
  lines.push('');
  lines.push(block.body);
  lines.push('');
  lines.push('===================================');
  lines.push('RACE SECTION USED');
  lines.push('===================================');
  lines.push('');
  lines.push(`Extraction meta: ${JSON.stringify(raceSection.meta, null, 2)}`);
  lines.push('');
  lines.push(raceSection.text || '(empty)');
  lines.push('');
  lines.push('===================================');
  lines.push('EVENTS FOUND');
  lines.push('===================================');
  lines.push('');
  if (!events.length) {
    lines.push('(no events parsed from RACE section)');
  } else {
    for (const [i, event] of events.entries()) {
      lines.push(`[${i + 1}] index=${event.index} ${event.time} L${event.lap} ${event.text}`);
    }
  }
  lines.push('');
  lines.push(`Pit-related events (${pitEvents.length}):`);
  if (!pitEvents.length) {
    lines.push('(none)');
  } else {
    for (const event of pitEvents) {
      lines.push(`  ${event.time} L${event.lap} ${event.text}`);
    }
  }
  lines.push('');
  lines.push('===================================');
  lines.push('PIT STOP REGEX MATCHES');
  lines.push('===================================');
  lines.push('');
  lines.push(`Pattern: ${PIT_STOP_PATTERN}`);
  lines.push('');
  if (!regexMatches.length) {
    lines.push('(no regex matches in RACE section)');
  } else {
    for (const [i, m] of regexMatches.entries()) {
      lines.push(`Match ${i + 1}:`);
      lines.push(`  match text: ${m.matchText}`);
      lines.push(`  groups: time=${m.groups[0]}, lap=${m.groups[1]}, seconds=${m.groups[2]}`);
      lines.push(`  character index: ${m.index}`);
      lines.push('');
    }
  }
  lines.push('');
  lines.push('===================================');
  lines.push('LITERAL PIT SUBSTRINGS IN RAW BLOCK');
  lines.push('===================================');
  lines.push('');
  if (!literalHits.length) {
    lines.push('(none)');
  } else {
    for (const hit of literalHits) {
      lines.push(`[${hit.index}] "${hit.needle}"`);
      lines.push(`  ...${hit.context}...`);
      lines.push('');
    }
  }
  lines.push('');
  lines.push('===================================');
  lines.push('NO MATCH FOUND');
  lines.push('===================================');
  lines.push('');
  lines.push(noMatchExplanation || 'Regex matched — pit stops should be extractable from RACE section text above.');

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`RAW block length: ${block.body.length}`);
  console.log(`RACE section length: ${raceSection.text.length}`);
  console.log(`Regex matches: ${regexMatches.length}`);
  console.log(`Literal PIT hits in raw block: ${literalHits.filter((h) => h.needle.includes('PIT')).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
