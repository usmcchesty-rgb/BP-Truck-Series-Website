/**
 * Inspect live Talladega PDF parse failures.
 * Run: node scripts/inspect-failed-rows.mjs
 */
import fs from 'fs';
import {
  parseRaceControlPdfBuffer,
  getResultsSectionText,
  normalizeWhitespace,
  parseResults,
  collectFailedRowDiagnostics,
} from '../api/_race-control-pdf-parser.js';

const PDF_URL =
  'https://oxwgzeyvbjdqveaxzoxs.supabase.co/storage/v1/object/public/race-control-pdfs/season-27987/race-14/race-control.pdf';

function findCandidates(sectionText) {
  const candidates = [];
  const pattern = /\b(\d{1,2}) (\d{1,2}) (\d{1,3}) ([A-Z])/g;
  let match;
  while ((match = pattern.exec(sectionText)) !== null) {
    candidates.push({
      index: match.index,
      position: Number(match[1]),
      classPosition: Number(match[2]),
      carNumber: Number(match[3]),
    });
  }
  return candidates;
}

function sliceRow(sectionText, candidate, candidates) {
  const next = candidates.find(
    (item) => item.index > candidate.index && item.position === candidate.position + 1
  );
  const end = next?.index ?? sectionText.length;
  return sectionText.slice(candidate.index, end).trim();
}

const buf = Buffer.from(await (await fetch(PDF_URL)).arrayBuffer());
const { parsedJson, parsedText } = await parseRaceControlPdfBuffer(buf, { raceNumber: 14 });
const section = getResultsSectionText(normalizeWhitespace(parsedText)).section;
const candidates = findCandidates(section);
const failed = collectFailedRowDiagnostics(section, candidates);
const parsed = parseResults(section);

const missingFromResults = [];
for (let position = 1; position <= 35; position += 1) {
  if (!parsed.results.some((row) => row.position === position)) missingFromResults.push(position);
}

console.log(
  JSON.stringify(
    {
      resultsLength: parsedJson.results.length,
      parseResultsLength: parsed.results.length,
      missingFromResults,
      parserDebug: {
        failedRowCount: parsedJson.parserDebug?.failedRowCount,
        failedPositions: parsedJson.parserDebug?.failedPositions,
        successfulPositions: parsedJson.parserDebug?.successfulPositions,
        sequentialAnchorsAccepted: parsedJson.parserDebug?.sequentialAnchorsAccepted,
      },
      rowStartPositions: parsed.rowStarts.map((row) => row.position),
    },
    null,
    2
  )
);

if (fs.existsSync('data/race-control-failed-rows.json')) {
  console.log('\n--- race-control-failed-rows.json ---');
  console.log(fs.readFileSync('data/race-control-failed-rows.json', 'utf8'));
}

for (const row of failed.failedRows) {
  const prevText = sliceRow(
    section,
    candidates.find((item) => item.position === row.position - 1),
    candidates
  );
  console.log(`\n=== FAILED P${row.position} vs P${row.position - 1} ===`);
  console.log(JSON.stringify(row, null, 2));
  console.log('\nPrevious row (P' + (row.position - 1) + '):');
  console.log(prevText);
  console.log('\nDiff vs previous tail:');
  console.log(
    'prev suffix:',
    prevText.split(/\s+/).slice(-10).join(' ')
  );
  console.log(
    'failed suffix:',
    row.tokens.slice(-10).join(' ')
  );
}

if (missingFromResults.includes(34) && !failed.failedPositions.includes(34)) {
  const rowText = sliceRow(section, candidates.find((item) => item.position === 34), candidates);
  console.log('\n=== P34 ANOMALY: successful in diagnostics but missing from results ===');
  console.log(rowText);
  console.log('tokens', rowText.split(/\s+/));
}
