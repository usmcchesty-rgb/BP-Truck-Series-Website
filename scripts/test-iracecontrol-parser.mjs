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

const TALLADEGA_DRIVERS = [
  'Chris Berg',
  'Hunter Lagunes',
  'Levi Allen',
  'Ty Marasco',
  'Dalton Kilroe',
  'Mike Massengill',
  'Cody Gibson',
  'Larry Bell',
  'Justin Levine',
  'Brad Lawson',
  'Chris Carroll',
  'Kevin Coburn',
  'Aaron Bockover',
];

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
  gap = null,
  interval = null,
  bestLap = '00:51.906',
  bestLapOn = '55',
  status = 'Running',
}) {
  const parts = [
    position,
    classPosition,
    carNumber,
    driverName,
    nationality,
    car,
    licenseClass,
    safetyRating,
    iRating,
    grid,
    incidents,
    laps,
    finishTime,
  ];
  if (gap != null && gap !== '-') parts.push(gap);
  if (interval != null && interval !== '-') parts.push(interval);
  parts.push(bestLap, bestLapOn, status);
  return parts.join(' ');
}

function resolveDriverName(position) {
  if (position === 1) return 'Chris Berg';
  if (position === 2) return 'Hunter Lagunes';
  if (position === 3) return 'Levi Allen';
  if (position === 18) return 'Mark Arthur';
  if (position === 35) return 'Aaron Bockover';
  return TALLADEGA_DRIVERS[(position - 1) % TALLADEGA_DRIVERS.length] || `Driver ${position}`;
}

function resolveCarNumber(position) {
  if (position === 1) return 66;
  if (position === 2) return 27;
  if (position === 3) return 79;
  if (position === 18) return 12;
  if (position === 35) return 44;
  return 60 + position;
}

function buildTalladegaSample() {
  const header =
    'This document was generated: 06/28/2026 21:44:31 RACE - Talladega - (4.2734 km, 4 corners) - 2424 SOF Caution Laps 14 Lead Changes 12 Average Lap Time 1:08.412 Laps Completed 101';
  const columns =
    'Pos Cls Car Driver Nat Car Lic SR iR Grid Inc Laps Time Gap Int Best BestLap Status';

  const rows = [];
  for (let position = 1; position <= 35; position += 1) {
    const rowDefaults = {
      position,
      classPosition: position,
      carNumber: resolveCarNumber(position),
      driverName: resolveDriverName(position),
      car:
        position % 3 === 0
          ? 'Ford F150'
          : position % 3 === 1
            ? 'Toyota Tundra TRD Pro'
            : 'Chevrolet Silverado',
    };

    if (position === 1) {
      rows.push(
        buildSampleRow({
          ...rowDefaults,
          car: 'Chevrolet Silverado',
          finishTime: '1:55:20.209',
          bestLap: '00:51.906',
          bestLapOn: '55',
        })
      );
      continue;
    }

    if (position === 2) {
      rows.push(
        buildSampleRow({
          ...rowDefaults,
          car: 'Ford F150',
          safetyRating: '4.46',
          iRating: '4825',
          grid: '12',
          incidents: '0',
          finishTime: '1:55:20.212',
          gap: '0:00.003',
          interval: '0.003',
          bestLap: '00:51.857',
          bestLapOn: '92',
        })
      );
      continue;
    }

    rows.push(
      buildSampleRow({
        ...rowDefaults,
        finishTime: '1:56:12.115',
        gap: '00:51.906',
        interval: '00:02.100',
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
    '00:55:00 L60 FULL COURSE YELLOW',
    '01:10:00 L72 FULL COURSE YELLOW',
    '01:53:35 L100 ALL PENALTIES CLEARED',
    'INCIDENT REPORTS',
    '99 - Chris Carroll CLASS: Hosted All Cars CAR: Chevrolet Silverado DRIVERS Chris Carroll 4613 A 3.13',
    '12 - Mark Arthur CLASS: Hosted All Cars CAR: Ford F150 DRIVERS Mark Arthur 3200 A 2.80',
    '44 - Aaron Bockover CLASS: Hosted All Cars CAR: RAM DRIVERS Aaron Bockover 3100 A 2.55',
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
const aaron = parsed.results.find((row) => row.position === 35);
const firstIterationWarning = parsed.parseWarnings.some((warning) =>
  warning.includes('Only the first finishing position was parsed')
);

const checks = {
  source: inputPath || (fs.existsSync('data/race-control-debug.txt') && fs.statSync('data/race-control-debug.txt').size > 10000
    ? 'data/race-control-debug.txt'
    : 'synthetic sample'),
  sof: parsed.sof,
  winner: parsed.winner,
  cautionCount: parsed.cautionCount,
  resultsLength: parsed.results.length,
  secondDriver: parsed.results[1]?.driverName,
  markArthurPosition: markArthur?.position,
  markArthurCar: String(markArthur?.carNumber ?? ''),
  aaronPosition: aaron?.position,
  aaronCar: String(aaron?.carNumber ?? ''),
  aaronDriver: aaron?.driverName,
  parserDiagnostics: parsed.parserDiagnostics,
  summary: parsed.summary,
  hasFirstIterationWarning: firstIterationWarning,
  parseWarnings: parsed.parseWarnings,
};

console.log(JSON.stringify({ checks, sampleResults: parsed.results.slice(0, 3) }, null, 2));

const pass =
  checks.sof === 2424 &&
  checks.winner === 'Chris Berg' &&
  checks.cautionCount === 7 &&
  checks.resultsLength === 35 &&
  parsed.results[0]?.driverName === 'Chris Berg' &&
  parsed.results[0]?.gap == null &&
  parsed.results[0]?.interval == null &&
  parsed.results[1]?.driverName === 'Hunter Lagunes' &&
  parsed.results[1]?.carNumber === 27 &&
  parsed.results[1]?.grid === 12 &&
  parsed.results[1]?.gap === '0:00.003' &&
  parsed.results[1]?.interval === '0.003' &&
  checks.markArthurPosition === 18 &&
  checks.markArthurCar === '12' &&
  checks.aaronDriver === 'Aaron Bockover' &&
  checks.aaronCar === '44' &&
  checks.aaronPosition === 35 &&
  checks.parserDiagnostics?.resultsDetected === 35 &&
  checks.parserDiagnostics?.resultParseConfidence === 'high' &&
  parsed.parserDebug?.sequentialAnchorsAccepted === 35 &&
  !checks.hasFirstIterationWarning;

console.log(pass ? '\nACCEPTANCE: PASS' : '\nACCEPTANCE: CHECK OUTPUT');
