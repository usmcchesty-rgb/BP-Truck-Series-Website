/**
 * iRaceControl parser acceptance harness (Talladega sample).
 * Run: node scripts/test-iracecontrol-parser.mjs
 * With real extracted text: node scripts/test-iracecontrol-parser.mjs path/to/race-control-debug.txt
 */
import fs from 'fs';
import path from 'path';
import {
  normalizeWhitespace,
  parseRaceControlPdfText,
} from '../api/_race-control-pdf-parser.js';

function buildSampleRow({
  position,
  classPosition,
  carNumber,
  driverName,
  nationality = 'United States',
  car = 'Chevrolet Silverado',
  licenseClass = 'A',
  safetyRating = '2.61',
  iRating = '3271',
  grid = '4',
  incidents = '8',
  laps = '101',
  finishTime = '1:55:20.209',
  gap = '00:51.906',
  interval = '-',
  bestLap = '00:51.906',
  bestLapOn = '55',
  status = 'Running',
}) {
  const gapPart = gap === '-' ? '-' : gap;
  const intervalPart = interval === '-' ? '' : ` ${interval}`;
  return `${position} ${classPosition} ${carNumber} ${driverName} ${nationality} ${car} ${licenseClass} ${safetyRating} ${iRating} ${grid} ${incidents} ${laps} ${finishTime} ${gapPart}${intervalPart} ${bestLap} ${bestLapOn} ${status}`;
}

function buildTalladegaSample() {
  const header =
    'This document was generated: 06/28/2026 21:44:31 RACE - Talladega - (4.2734 km, 4 corners) - 2424 SOF';
  const columns =
    'Pos Cls Car Driver Nat Car Lic SR iR Grid Inc Laps Time Gap Int Best BestLap Status';

  const names = [
    'Chris Berg',
    'Ty Marasco',
    'Dalton Kilroe',
    'Mike Massengill',
    'Cody Gibson',
    'Larry Bell',
    'Mark Arthur',
    'Chris Carroll',
    'Justin Levine',
    'Brad Lawson',
  ];

  const rows = [];
  for (let i = 0; i < 35; i += 1) {
    const position = i + 1;
    const driverName =
      position === 1
        ? 'Chris Berg'
        : position === 18
          ? 'Mark Arthur'
          : `Driver ${position}`;
    const carNumber = position === 18 ? 12 : 66 + i;
    rows.push(
      buildSampleRow({
        position,
        classPosition: position,
        carNumber,
        driverName,
        car: i % 3 === 0 ? 'Ford F150' : i % 3 === 1 ? 'Toyota Tundra TRD Pro' : 'Chevrolet Silverado',
        gap: position === 1 ? '-' : '00:51.906',
        interval: position === 1 ? '-' : '00:02.100',
        finishTime: position === 1 ? '1:55:20.209' : '1:56:12.115',
      })
    );
  }

  const session = [
    'SESSION REPORTS',
    '00:00:00 L0 GREEN FLAG',
    '00:03:42 L5 FULL COURSE YELLOW',
    '00:08:12 L10 FULL COURSE YELLOW',
    '00:15:00 L18 FULL COURSE YELLOW',
    '00:30:00 L35 FULL COURSE YELLOW',
    '00:45:00 L52 FULL COURSE YELLOW',
    '00:51:24 L46 PACE CAR DEPLOYED BY RACE CONTROL',
    '01:53:35 L100 ALL PENALTIES CLEARED',
    '00:55:00 L60 FULL COURSE YELLOW',
    'INCIDENT REPORTS',
    '99 - Chris Carroll CLASS: Hosted All Cars CAR: Chevrolet Silverado DRIVERS Chris Carroll 4613 A 3.13',
    '12 - Mark Arthur CLASS: Hosted All Cars CAR: Ford F150 DRIVERS Mark Arthur 3200 A 2.80',
  ];

  return normalizeWhitespace(
    [header, columns, ...rows, 'LAP CHART - RACE', ...session].join(' ')
  );
}

function loadInputText(argvPath) {
  if (argvPath) {
    return normalizeWhitespace(fs.readFileSync(argvPath, 'utf8'));
  }
  const debugPath = path.join(process.cwd(), 'data', 'race-control-debug.txt');
  if (fs.existsSync(debugPath) && fs.statSync(debugPath).size > 10000) {
    return normalizeWhitespace(fs.readFileSync(debugPath, 'utf8'));
  }
  return buildTalladegaSample();
}

const inputPath = process.argv[2] || null;
const text = loadInputText(inputPath);
const parsed = parseRaceControlPdfText(text, { raceNumber: 14 });

const markArthur = parsed.results.find((row) => row.position === 18);
const checks = {
  source: inputPath || (fs.existsSync('data/race-control-debug.txt') ? 'data/race-control-debug.txt or sample' : 'synthetic sample'),
  trackNameIncludesTalladega: /Talladega/i.test(parsed.trackName || ''),
  sof: parsed.sof,
  winner: parsed.winner,
  cautionCount: parsed.cautionCount,
  resultsLength: parsed.results.length,
  firstDriver: parsed.results[0]?.driverName,
  markArthurPosition: markArthur?.position,
  markArthurCar: String(markArthur?.carNumber ?? ''),
  hasGreenFlag: parsed.raceEvents.some((e) => /GREEN FLAG/i.test(e.text)),
  hasFcy: parsed.raceEvents.some((e) => /FULL COURSE YELLOW/i.test(e.text)),
  debugPreviewLength: 0,
  parseWarnings: parsed.parseWarnings,
};

console.log(JSON.stringify({ checks, summary: parsed.summary, sampleResults: parsed.results.slice(0, 3) }, null, 2));

const pass =
  checks.trackNameIncludesTalladega &&
  checks.sof === 2424 &&
  checks.winner === 'Chris Berg' &&
  checks.cautionCount === 6 &&
  checks.resultsLength === 35 &&
  checks.firstDriver === 'Chris Berg' &&
  checks.markArthurPosition === 18 &&
  checks.markArthurCar === '12' &&
  checks.hasGreenFlag &&
  checks.hasFcy;

console.log(pass ? '\nACCEPTANCE: PASS (sample)' : '\nACCEPTANCE: CHECK OUTPUT');
