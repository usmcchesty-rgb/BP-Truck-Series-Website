/**
 * iRaceControl parser fixture regression suite.
 * Run: npm run test:race-control-parser
 *
 * Drop new fixture JSON files into fixtures/race-control/ to extend coverage.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractPdfText,
  parseRaceControlPdfText,
} from '../api/_race-control-pdf-parser.js';
import { validateRaceControlReport } from '../api/_race-control-validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FIXTURES_DIR = path.join(ROOT, 'fixtures', 'race-control');

function resolvePath(relativePath) {
  return path.join(ROOT, relativePath);
}

async function loadFixtureText(fixture) {
  const textFile = fixture.source?.textFile
    ? resolvePath(fixture.source.textFile)
    : null;

  if (textFile && fs.existsSync(textFile) && fs.statSync(textFile).size > 1000) {
    return { text: fs.readFileSync(textFile, 'utf8'), source: textFile };
  }

  const url = fixture.source?.url;
  if (!url) {
    throw new Error('Fixture requires source.url or a cached source.textFile');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF (${response.status}): ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const { text } = await extractPdfText(buffer);

  if (textFile) {
    const dir = path.dirname(textFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(textFile, text, 'utf8');
  }

  return { text, source: url };
}

function countDriversWithPitStops(drivers) {
  return drivers.filter(
    (driver) =>
      (Array.isArray(driver.pitStops) && driver.pitStops.length > 0) ||
      Number(driver.pitStopCount) > 0
  ).length;
}

function countDriversWithBestLap(drivers) {
  return drivers.filter(
    (driver) => driver.bestLap || driver.fastestLap || driver.raceBestLap
  ).length;
}

function assertExpectation(label, actual, expected, failures) {
  if (expected == null) return;
  const pass = actual === expected;
  if (!pass) {
    failures.push({ check: label, expected, actual });
  }
}

function assertMin(label, actual, min, failures) {
  if (min == null) return;
  if (Number(actual) < Number(min)) {
    failures.push({ check: label, expected: `>= ${min}`, actual });
  }
}

function runFixtureChecks(fixture, parsed, validation) {
  const expect = fixture.expect || {};
  const failures = [];
  const drivers = Array.isArray(parsed.drivers) ? parsed.drivers : [];
  const stage1 = parsed.stages?.find((stage) => stage.stageNumber === 1);

  assertExpectation('results parsed', parsed.results?.length ?? 0, expect.resultsCount, failures);
  assertExpectation('winner', parsed.winner, expect.winner, failures);
  assertExpectation('SOF', parsed.sof, expect.sof, failures);
  if (expect.sof != null) {
    assertExpectation('sofFound', parsed.parserDiagnostics?.sofFound, true, failures);
    assertExpectation('parsed.sof present', parsed.sof != null, true, failures);
  }
  assertExpectation('sofFound', parsed.parserDiagnostics?.sofFound, expect.sofFound, failures);
  assertExpectation('sofSource', parsed.parserDiagnostics?.sofSource, expect.sofSource, failures);
  assertExpectation('cautionCount', parsed.cautionCount, expect.cautionCount, failures);
  assertMin('cautionCount', parsed.cautionCount, expect.cautionCountMin, failures);
  assertMin('race events', parsed.raceEvents?.length ?? 0, expect.raceEventsMin, failures);
  assertMin('stages', parsed.stages?.length ?? 0, expect.stagesMin, failures);
  assertExpectation('stage1 lap', stage1?.lap ?? null, expect.stage1Lap ?? null, failures);
  assertMin('stage1 drivers', stage1?.results?.length ?? 0, expect.stage1DriversMin, failures);
  assertMin('driver reports', drivers.length, expect.driverReportsMin, failures);
  assertMin(
    'drivers with pit stops',
    countDriversWithPitStops(drivers),
    expect.driversWithPitStopsMin,
    failures
  );
  assertMin(
    'drivers with best lap',
    countDriversWithBestLap(drivers),
    expect.driversWithBestLapMin,
    failures
  );
  assertExpectation(
    'parser confidence',
    parsed.parserDiagnostics?.resultParseConfidence,
    expect.parserConfidence,
    failures
  );
  assertExpectation('validation confidence', validation?.confidence, expect.validationConfidence, failures);
  assertExpectation(
    'layoutDetected',
    parsed.parserDiagnostics?.layoutDetected,
    expect.layoutDetected,
    failures
  );
  assertExpectation(
    'parserVersion',
    parsed.parserDiagnostics?.parserVersion,
    expect.parserVersion,
    failures
  );

  if (expect.trackNameIncludes) {
    const track = String(parsed.trackName || '').toLowerCase();
    if (!track.includes(String(expect.trackNameIncludes).toLowerCase())) {
      failures.push({
        check: 'trackNameIncludes',
        expected: expect.trackNameIncludes,
        actual: parsed.trackName,
      });
    }
  }

  if (expect.resultsCount != null && parsed.results?.length !== expect.resultsCount) {
    failures.push({
      check: 'complete results grid',
      expected: expect.resultsCount,
      actual: parsed.results?.length ?? 0,
    });
  }

  return failures;
}

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    return [];
  }

  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(FIXTURES_DIR, name);
      return { filePath, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

async function runFixture(fixture) {
  const { text, source } = await loadFixtureText(fixture);
  const parsed = parseRaceControlPdfText(text, {
    raceNumber: fixture.raceNumber,
    collectParserDebug: false,
  });

  const validation = validateRaceControlReport({
    parsedJson: parsed,
    raceNumber: fixture.raceNumber,
    officialContext: fixture.officialContext || null,
  });

  const failures = runFixtureChecks(fixture, parsed, validation);

  return {
    id: fixture.id,
    label: fixture.label,
    source,
    pass: failures.length === 0,
    failures,
    summary: {
      results: parsed.results?.length ?? 0,
      winner: parsed.winner,
      sof: parsed.sof,
      sofFound: parsed.parserDiagnostics?.sofFound,
      sofSource: parsed.parserDiagnostics?.sofSource,
      cautions: parsed.cautionCount,
      raceEvents: parsed.raceEvents?.length ?? 0,
      stages: parsed.stages?.length ?? 0,
      driverReports: parsed.drivers?.length ?? 0,
      parserConfidence: parsed.parserDiagnostics?.resultParseConfidence,
      validationConfidence: validation.confidence,
      layoutDetected: parsed.parserDiagnostics?.layoutDetected,
      parserVersion: parsed.parserDiagnostics?.parserVersion,
      anchorsMissing: parsed.parserDiagnostics?.anchorsMissing || [],
      compatibilityFixesApplied: parsed.parserDebug?.compatibilityFixesApplied || [],
    },
  };
}

async function main() {
  const fixtures = loadFixtures();
  if (!fixtures.length) {
    console.error('No fixtures found in fixtures/race-control/');
    process.exit(1);
  }

  console.log(`iRaceControl parser fixture suite (${fixtures.length} fixture(s))\n`);

  const results = [];
  for (const fixture of fixtures) {
    try {
      const result = await runFixture(fixture);
      results.push(result);
      const status = result.pass ? 'PASS' : 'FAIL';
      console.log(`${status}  ${result.label} (${result.id})`);
      if (!result.pass) {
        for (const failure of result.failures) {
          console.log(`       ✗ ${failure.check}: expected ${JSON.stringify(failure.expected)}, got ${JSON.stringify(failure.actual)}`);
        }
      } else {
        console.log(
          `       ${result.summary.results} results | ${result.summary.winner || '—'} | SOF ${result.summary.sof} | ${result.summary.cautions} cautions | layout ${result.summary.layoutDetected}`
        );
      }
    } catch (error) {
      results.push({
        id: fixture.id,
        label: fixture.label,
        pass: false,
        error: error?.message || String(error),
      });
      console.log(`FAIL  ${fixture.label} (${fixture.id})`);
      console.log(`       ✗ ${error?.message || String(error)}`);
    }
    console.log('');
  }

  const passed = results.filter((result) => result.pass).length;
  const failed = results.length - passed;

  console.log('---');
  console.log(`${passed}/${results.length} fixtures passed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
