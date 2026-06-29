import { supabase } from './_lib.js';
import { IRACECONTROL_PARSER_VERSION } from './_iracecontrol-compatibility.js';
import {
  buildExtendedParserDiagnostics,
  compareConfidence,
  evaluateLiveParserStatus,
  normalizeName,
} from './_race-control-parser-diagnostics.js';
import {
  getRaceControlReport,
  listRaceControlReports,
  reparseRaceControlReport,
} from './_race-control-reports.js';

const KNOWN_REFERENCE_RACES = [
  { raceNumber: 1, label: 'Daytona 2026' },
  { raceNumber: 14, label: 'Talladega 2026' },
  { raceNumber: 5, label: 'Bristol 2026' },
  { raceNumber: 7, label: 'Phoenix 2026' },
];

function normalizeFixtureRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reportId: row.report_id,
    seasonId: row.season_id,
    raceNumber: row.race_number,
    trackName: row.track_name,
    expectedWinner: row.expected_winner,
    expectedSof: row.expected_sof,
    expectedDriverCount: row.expected_driver_count,
    expectedCautionCount: row.expected_caution_count,
    expectedStageCount: row.expected_stage_count,
    expectedParserVersion: row.expected_parser_version,
    expectedMinConfidence: row.expected_min_confidence,
    notes: row.notes,
    isReference: row.is_reference !== false,
    lastRegressionAt: row.last_regression_at,
    lastRegressionStatus: row.last_regression_status,
    lastRegressionResult: row.last_regression_result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildCheck({ id, label, passed, severity = 'error', expected = null, actual = null, message = null }) {
  return {
    id,
    label,
    passed: Boolean(passed),
    severity,
    expected,
    actual,
    message,
  };
}

export function runFixtureRegressionChecks(parsed, fixture) {
  const checks = [];
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const diagnostics = parsed?.parserDiagnostics || {};
  const extended = buildExtendedParserDiagnostics(parsed);
  const positions = results.map((row) => Number(row.position)).filter((value) => value > 0);
  const carNumbers = results.map((row) => Number(row.carNumber)).filter((value) => value > 0);
  const duplicatePositions = extended.rowParseSummary.duplicatePositions || [];
  const duplicateCarNumbers = extended.rowParseSummary.duplicateCarNumbers || [];

  checks.push(
    buildCheck({
      id: 'results_parsed',
      label: 'Results parsed',
      passed: results.length > 0,
      actual: results.length,
    })
  );

  checks.push(
    buildCheck({
      id: 'positions_complete',
      label: 'Positions complete',
      passed: extended.rowParseSummary.positionsComplete && duplicatePositions.length === 0,
      actual: extended.rowParseSummary.missingPositions,
      message:
        duplicatePositions.length > 0
          ? `Duplicate positions: ${duplicatePositions.join(', ')}`
          : extended.rowParseSummary.missingPositions.length
            ? `Missing positions: ${extended.rowParseSummary.missingPositions.join(', ')}`
            : null,
    })
  );

  checks.push(
    buildCheck({
      id: 'no_duplicate_car_numbers',
      label: 'No duplicate car numbers',
      passed: duplicateCarNumbers.length === 0,
      actual: duplicateCarNumbers,
    })
  );

  if (fixture.expectedWinner) {
    checks.push(
      buildCheck({
        id: 'winner',
        label: 'Winner matches expected',
        passed: normalizeName(parsed?.winner) === normalizeName(fixture.expectedWinner),
        expected: fixture.expectedWinner,
        actual: parsed?.winner || null,
      })
    );
  }

  if (fixture.expectedSof != null) {
    checks.push(
      buildCheck({
        id: 'sof',
        label: 'SOF matches expected',
        passed: Number(parsed?.sof) === Number(fixture.expectedSof),
        expected: fixture.expectedSof,
        actual: parsed?.sof ?? null,
      })
    );
  }

  if (fixture.expectedCautionCount != null) {
    checks.push(
      buildCheck({
        id: 'cautions',
        label: 'Caution count matches expected',
        passed: Number(parsed?.cautionCount) === Number(fixture.expectedCautionCount),
        expected: fixture.expectedCautionCount,
        actual: parsed?.cautionCount ?? null,
      })
    );
  }

  if (fixture.expectedDriverCount != null) {
    checks.push(
      buildCheck({
        id: 'driver_count',
        label: 'Driver count matches expected',
        passed: results.length === Number(fixture.expectedDriverCount),
        expected: fixture.expectedDriverCount,
        actual: results.length,
      })
    );
  }

  if (fixture.expectedStageCount != null) {
    const stageCount = Array.isArray(parsed?.stages) ? parsed.stages.length : 0;
    checks.push(
      buildCheck({
        id: 'stage_count',
        label: 'Stage count matches expected',
        passed: stageCount === Number(fixture.expectedStageCount),
        expected: fixture.expectedStageCount,
        actual: stageCount,
      })
    );
  }

  if (fixture.expectedParserVersion) {
    checks.push(
      buildCheck({
        id: 'parser_version',
        label: 'Parser version matches expected',
        passed: String(diagnostics.parserVersion || IRACECONTROL_PARSER_VERSION) === fixture.expectedParserVersion,
        expected: fixture.expectedParserVersion,
        actual: diagnostics.parserVersion || IRACECONTROL_PARSER_VERSION,
        severity: 'warn',
      })
    );
  }

  if (fixture.expectedMinConfidence) {
    checks.push(
      buildCheck({
        id: 'parser_confidence',
        label: 'Parser confidence meets minimum',
        passed: compareConfidence(diagnostics.resultParseConfidence, fixture.expectedMinConfidence),
        expected: fixture.expectedMinConfidence,
        actual: diagnostics.resultParseConfidence || 'unknown',
        severity: 'warn',
      })
    );
  }

  for (const field of ['winner', 'sof', 'results', 'raceEvents']) {
    if (extended.missingRequiredFields.includes(field)) {
      checks.push(
        buildCheck({
          id: `required_${field}`,
          label: `Required field present: ${field}`,
          passed: false,
          message: `${field} missing from parsed output`,
        })
      );
    }
  }

  const failedErrors = checks.filter((check) => !check.passed && check.severity === 'error');
  const failedWarnings = checks.filter((check) => !check.passed && check.severity === 'warn');

  let status = 'pass';
  if (failedErrors.length) status = 'fail';
  else if (failedWarnings.length) status = 'warn';

  return {
    status,
    checks,
    passed: checks.filter((check) => check.passed).length,
    failed: checks.filter((check) => !check.passed).length,
    parserVersion: diagnostics.parserVersion || IRACECONTROL_PARSER_VERSION,
    extendedDiagnostics: extended,
  };
}

async function updateRegressionState(summary) {
  const sb = supabase();
  if (!sb) return null;

  const payload = {
    id: 1,
    last_run_at: new Date().toISOString(),
    last_parser_version: summary.parserVersion || IRACECONTROL_PARSER_VERSION,
    last_summary: summary,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await sb
    .from('race_control_parser_regression_state')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function getRegressionState() {
  const sb = supabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from('race_control_parser_regression_state')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function listRaceControlParserFixtures(seasonId) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const { data, error } = await sb
    .from('race_control_parser_fixtures')
    .select('*')
    .eq('season_id', String(seasonId))
    .order('race_number', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []).map(normalizeFixtureRow);
}

function deriveExpectedValuesFromReport(report, overrides = {}) {
  const parsed = report?.parsedJson || {};
  const diagnostics = parsed?.parserDiagnostics || {};
  const confidence = diagnostics.resultParseConfidence || 'medium';

  return {
    reportId: report?.id || null,
    seasonId: report?.seasonId,
    raceNumber: report?.raceNumber,
    trackName: overrides.trackName || report?.trackName || parsed?.trackName || null,
    expectedWinner: overrides.expectedWinner || parsed?.winner || null,
    expectedSof: overrides.expectedSof ?? parsed?.sof ?? null,
    expectedDriverCount: overrides.expectedDriverCount ?? (parsed?.results?.length || null),
    expectedCautionCount: overrides.expectedCautionCount ?? parsed?.cautionCount ?? null,
    expectedStageCount: overrides.expectedStageCount ?? (parsed?.stages?.length || 0),
    expectedParserVersion:
      overrides.expectedParserVersion || diagnostics.parserVersion || IRACECONTROL_PARSER_VERSION,
    expectedMinConfidence: overrides.expectedMinConfidence || confidence,
    notes: overrides.notes || null,
  };
}

export async function markRaceControlParserFixture(body, options = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const seasonId = String(body.seasonId || options.settings?.seasonId || '27987');
  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    throw Object.assign(new Error('Valid raceNumber is required.'), { status: 400 });
  }

  const report = await getRaceControlReport(seasonId, raceNumber);
  if (!report?.parsedJson || report.parseStatus !== 'parsed') {
    throw Object.assign(new Error('Report must be parsed before marking as reference fixture.'), {
      status: 400,
    });
  }

  const expected = deriveExpectedValuesFromReport(report, body);
  const now = new Date().toISOString();

  const row = {
    report_id: expected.reportId,
    season_id: seasonId,
    race_number: raceNumber,
    track_name: expected.trackName,
    expected_winner: expected.expectedWinner,
    expected_sof: expected.expectedSof,
    expected_driver_count: expected.expectedDriverCount,
    expected_caution_count: expected.expectedCautionCount,
    expected_stage_count: expected.expectedStageCount,
    expected_parser_version: expected.expectedParserVersion,
    expected_min_confidence: expected.expectedMinConfidence,
    notes: expected.notes,
    is_reference: body.isReference !== false,
    updated_at: now,
  };

  const { data, error } = await sb
    .from('race_control_parser_fixtures')
    .upsert(row, { onConflict: 'season_id,race_number' })
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return normalizeFixtureRow(data);
}

export async function unmarkRaceControlParserFixture(body) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const seasonId = String(body.seasonId || '27987');
  const raceNumber = Number(body.raceNumber ?? body.race_number);

  const { error } = await sb
    .from('race_control_parser_fixtures')
    .delete()
    .eq('season_id', seasonId)
    .eq('race_number', raceNumber);

  if (error) throw new Error(error.message);
  return { ok: true, deleted: true, seasonId, raceNumber };
}

async function reparseFixtureReport(seasonId, raceNumber, settings) {
  return reparseRaceControlReport({ seasonId, raceNumber }, { settings });
}

export async function runRaceControlParserRegressionForRace(body, options = {}) {
  const settings = options.settings || null;
  const seasonId = String(body.seasonId || settings?.seasonId || '27987');
  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    throw Object.assign(new Error('Valid raceNumber is required.'), { status: 400 });
  }

  const fixtures = await listRaceControlParserFixtures(seasonId);
  const fixture = fixtures.find((entry) => entry.raceNumber === raceNumber);
  if (!fixture) {
    throw Object.assign(new Error('No reference fixture found for this race.'), { status: 404 });
  }

  const report = await reparseFixtureReport(seasonId, raceNumber, settings);
  const result = runFixtureRegressionChecks(report.parsedJson, fixture);

  const sb = supabase();
  if (sb) {
    await sb
      .from('race_control_parser_fixtures')
      .update({
        last_regression_at: new Date().toISOString(),
        last_regression_status: result.status,
        last_regression_result: result,
        updated_at: new Date().toISOString(),
      })
      .eq('season_id', seasonId)
      .eq('race_number', raceNumber);
  }

  return {
    fixture,
    report,
    result,
    parserVersion: result.parserVersion,
  };
}

export async function runRaceControlParserRegression(body, options = {}) {
  const settings = options.settings || null;
  const seasonId = String(body.seasonId || settings?.seasonId || '27987');
  const fixtures = (await listRaceControlParserFixtures(seasonId)).filter(
    (fixture) => fixture.isReference !== false
  );

  const results = [];
  for (const fixture of fixtures) {
    try {
      const report = await reparseFixtureReport(seasonId, fixture.raceNumber, settings);
      const result = runFixtureRegressionChecks(report.parsedJson, fixture);
      results.push({
        fixture,
        report: {
          raceNumber: report.raceNumber,
          trackName: report.trackName,
          parseStatus: report.parseStatus,
          summary: report.summary,
        },
        result,
      });

      const sb = supabase();
      if (sb) {
        await sb
          .from('race_control_parser_fixtures')
          .update({
            last_regression_at: new Date().toISOString(),
            last_regression_status: result.status,
            last_regression_result: result,
            updated_at: new Date().toISOString(),
          })
          .eq('id', fixture.id);
      }
    } catch (error) {
      results.push({
        fixture,
        error: error.message || String(error),
        result: { status: 'fail', checks: [], passed: 0, failed: 1 },
      });
    }
  }

  const summary = {
    parserVersion: IRACECONTROL_PARSER_VERSION,
    totalReferenceReports: fixtures.length,
    passed: results.filter((entry) => entry.result?.status === 'pass').length,
    warnings: results.filter((entry) => entry.result?.status === 'warn').length,
    failed: results.filter(
      (entry) => entry.result?.status === 'fail' || entry.error
    ).length,
    lastRunAt: new Date().toISOString(),
    results,
  };

  await updateRegressionState(summary);

  return summary;
}

export async function getRaceControlParserRegressionSummary(seasonId) {
  const [fixtures, state, reports] = await Promise.all([
    listRaceControlParserFixtures(seasonId),
    getRegressionState(),
    listRaceControlReports(seasonId),
  ]);

  const referenceFixtures = fixtures.filter((fixture) => fixture.isReference !== false);
  const lastSummary = state?.last_summary || null;

  return {
    parserVersion: IRACECONTROL_PARSER_VERSION,
    totalReferenceReports: referenceFixtures.length,
    totalUploadedReports: reports.length,
    passed: lastSummary?.passed ?? referenceFixtures.filter((f) => f.lastRegressionStatus === 'pass').length,
    warnings: lastSummary?.warnings ?? referenceFixtures.filter((f) => f.lastRegressionStatus === 'warn').length,
    failed: lastSummary?.failed ?? referenceFixtures.filter((f) => f.lastRegressionStatus === 'fail').length,
    lastRunAt: state?.last_run_at || lastSummary?.lastRunAt || null,
    fixtures: referenceFixtures,
    lastSummary,
  };
}

export function buildParserTestBoardRow(report, fixture = null) {
  const parsed = report?.parsedJson || null;
  const extended = parsed ? buildExtendedParserDiagnostics(parsed) : null;
  const liveStatus = evaluateLiveParserStatus(parsed, report?.parseStatus);
  const regressionStatus = fixture?.lastRegressionStatus || null;

  return {
    id: report?.id,
    seasonId: report?.seasonId,
    raceNumber: report?.raceNumber,
    trackName: report?.trackName || parsed?.trackName || null,
    uploadedAt: report?.uploadedAt || null,
    parseStatus: report?.parseStatus,
    parserVersion: parsed?.parserDiagnostics?.parserVersion || IRACECONTROL_PARSER_VERSION,
    driversParsed: report?.summary?.resultCount ?? parsed?.results?.length ?? 0,
    expectedDrivers: fixture?.expectedDriverCount ?? null,
    winner: report?.summary?.winner ?? parsed?.winner ?? null,
    sof: report?.summary?.sof ?? parsed?.sof ?? null,
    cautions: report?.summary?.cautionCount ?? parsed?.cautionCount ?? null,
    confidence: parsed?.parserDiagnostics?.resultParseConfidence || extended?.confidence || null,
    compatibilityFixes: parsed?.parserDebug?.compatibilityFixesApplied || [],
    missingFields: extended?.missingRequiredFields || [],
    guidance: extended?.guidance || [],
    status: fixture?.isReference ? regressionStatus || liveStatus.label.toLowerCase() : liveStatus.status,
    statusLabel: fixture?.isReference
      ? (regressionStatus || liveStatus.label).toUpperCase()
      : liveStatus.label,
    isReference: Boolean(fixture?.isReference),
    fixture,
    liveStatus,
    diagnostics: extended,
    parserDebug: parsed?.parserDebug || null,
    parserDiagnostics: parsed?.parserDiagnostics || null,
  };
}

export async function getRaceControlParserTestBoard(seasonId) {
  const [reports, fixtures, summary] = await Promise.all([
    listRaceControlReports(seasonId),
    listRaceControlParserFixtures(seasonId),
    getRaceControlParserRegressionSummary(seasonId),
  ]);

  const fixtureByRace = new Map(fixtures.map((fixture) => [fixture.raceNumber, fixture]));
  const rows = reports
    .map((report) => buildParserTestBoardRow(report, fixtureByRace.get(report.raceNumber) || null))
    .sort((a, b) => Number(b.raceNumber) - Number(a.raceNumber));

  return {
    summary,
    rows,
    fixtures,
  };
}

export async function seedKnownRaceControlParserFixtures(body, options = {}) {
  const settings = options.settings || null;
  const seasonId = String(body.seasonId || settings?.seasonId || '27987');
  const seeded = [];
  const skipped = [];

  for (const known of KNOWN_REFERENCE_RACES) {
    const report = await getRaceControlReport(seasonId, known.raceNumber, { enrich: false });
    if (!report?.parsedJson || report.parseStatus !== 'parsed') {
      skipped.push({ raceNumber: known.raceNumber, label: known.label, reason: 'not parsed' });
      continue;
    }

    const fixture = await markRaceControlParserFixture(
      {
        seasonId,
        raceNumber: known.raceNumber,
        notes: known.label,
      },
      { settings }
    );
    seeded.push(fixture);
  }

  return { seeded, skipped, count: seeded.length };
}

export {
  buildExtendedParserDiagnostics,
  evaluateLiveParserStatus,
};
