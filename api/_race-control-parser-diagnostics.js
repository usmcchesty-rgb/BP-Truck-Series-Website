import { IRACECONTROL_PARSER_VERSION } from './_iracecontrol-compatibility.js';

const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findDuplicateValues(values) {
  const seen = new Map();
  for (const value of values) {
    if (value == null || value === '') continue;
    const key = String(value);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function analyzePositionSequence(results) {
  const positions = results
    .map((row) => Number(row.position))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (!positions.length) {
    return { complete: false, expectedCount: 0, missingPositions: [], maxPosition: 0 };
  }

  const maxPosition = positions[positions.length - 1];
  const missingPositions = [];
  for (let pos = 1; pos <= maxPosition; pos += 1) {
    if (!positions.includes(pos)) missingPositions.push(pos);
  }

  return {
    complete: missingPositions.length === 0,
    expectedCount: maxPosition,
    missingPositions,
    maxPosition,
  };
}

export function buildRowParseSummary(results = [], parserDebug = null) {
  const duplicatePositions = findDuplicateValues(results.map((row) => row.position));
  const duplicateCarNumbers = findDuplicateValues(results.map((row) => row.carNumber));
  const sequence = analyzePositionSequence(results);

  return {
    parsedCount: results.length,
    failedPositions: parserDebug?.failedPositions || [],
    successfulPositions: parserDebug?.successfulPositions || [],
    duplicatePositions,
    duplicateCarNumbers,
    positionsComplete: sequence.complete,
    missingPositions: sequence.missingPositions,
    maxPosition: sequence.maxPosition,
    sequentialAnchorsAccepted: parserDebug?.sequentialAnchorsAccepted ?? null,
    failedRowCount: parserDebug?.failedRowCount ?? 0,
  };
}

export function buildDriverReportSummary(drivers = [], driverReportDiagnostics = null) {
  const list = Array.isArray(drivers) ? drivers : [];
  return {
    count: list.length,
    withPitStops: list.filter(
      (driver) =>
        (Array.isArray(driver.pitStops) && driver.pitStops.length > 0) ||
        Number(driver.pitStopCount) > 0
    ).length,
    withBestLap: list.filter((driver) => driver.bestLap || driver.fastestLap || driver.raceBestLap)
      .length,
    blocksDetected: driverReportDiagnostics?.blocksDetected ?? null,
    blocksParsed: driverReportDiagnostics?.blocksParsed ?? null,
  };
}

function buildSuggestedCompatibilityRules(parsed, missingRequiredFields) {
  const suggestions = [];
  const diagnostics = parsed?.parserDiagnostics || {};
  const parserDebug = parsed?.parserDebug || {};

  if (missingRequiredFields.includes('sof')) {
    const snippet =
      parserDebug.sofDebugSnippets?.[0] ||
      diagnostics.sofNearbyText?.[0] ||
      null;
    if (snippet) {
      const sofInSnippet = snippet.match(/\b(\d{3,5})\s+SOF\b/i);
      suggestions.push({
        field: 'sof',
        issue: 'SOF not parsed from document text',
        snippet: snippet.slice(0, 200),
        suggestedRule: sofInSnippet
          ? 'Global SOF pattern: /(\\d{3,5})\\s+SOF/i'
          : 'Strength of Field pattern: /Strength[\\s-]*(?:of[\\s-]*)?[Ff]ield[\\s-]*[:.]?\\s*(\\d{3,5})/i',
      });
    }
  }

  if (missingRequiredFields.includes('sessionEvents') || missingRequiredFields.includes('raceEvents')) {
    const anchorSnippet = (diagnostics.anchorPositions || [])
      .map((entry) => entry.matchText)
      .find((text) => /SESSION REPORTS|INCIDENT REPORTS/i.test(String(text)));
    if (anchorSnippet) {
      suggestions.push({
        field: 'sessionEvents',
        issue: 'Session report events missing or empty',
        snippet: String(anchorSnippet).slice(0, 200),
        suggestedRule: 'Anchor discovery for SESSION REPORTS / INCIDENT REPORTS section boundaries',
      });
    }
  }

  if (missingRequiredFields.includes('results')) {
    suggestions.push({
      field: 'results',
      issue: 'Results table incomplete or missing',
      snippet: parserDebug.failureReason || 'Inspect failed row positions in parser debug.',
      suggestedRule: 'Review result row end-boundary anchors (STAGE, LAP CHART, repeated headers)',
    });
  }

  if (diagnostics.layoutDetected === 'unknown') {
    suggestions.push({
      field: 'layout',
      issue: 'Unknown iRaceControl layout variant',
      snippet: `Anchors missing: ${(diagnostics.anchorsMissing || []).join(', ') || 'none listed'}`,
      suggestedRule: 'Mark as reference fixture after manual review; extend anchor registry in compatibility layer',
    });
  }

  return suggestions;
}

function buildGuidanceMessages(missingRequiredFields, parsed) {
  const guidance = [];
  if (missingRequiredFields.includes('sof')) {
    guidance.push('SOF missing — inspect SOF snippets');
  }
  if (missingRequiredFields.includes('sessionEvents') || missingRequiredFields.includes('raceEvents')) {
    guidance.push('Session reports missing — inspect section anchors');
  }
  if (missingRequiredFields.includes('results') || missingRequiredFields.includes('winner')) {
    guidance.push('Results incomplete — inspect failed rows');
  }
  if (parsed?.parserDiagnostics?.layoutDetected === 'unknown') {
    guidance.push('Unknown layout — mark as reference after review');
  }
  if (!guidance.length && missingRequiredFields.length) {
    guidance.push(`Missing required fields: ${missingRequiredFields.join(', ')}`);
  }
  return guidance;
}

export function buildConfidenceReason(parsed) {
  const diagnostics = parsed?.parserDiagnostics || {};
  const confidence = diagnostics.resultParseConfidence || diagnostics.confidence || 'unknown';
  const rowCount = parsed?.results?.length || 0;
  const reasons = [];

  if (rowCount >= 30) reasons.push(`${rowCount} result rows parsed (≥30 → high baseline)`);
  else if (rowCount >= 10) reasons.push(`${rowCount} result rows parsed (≥10 → medium baseline)`);
  else reasons.push(`${rowCount} result rows parsed (low row count)`);

  if (diagnostics.sofFound || parsed?.sof != null) {
    reasons.push(`SOF found via ${diagnostics.sofSource || 'parser'}`);
  } else {
    reasons.push('SOF not found');
  }

  if ((diagnostics.anchorsMissing || []).length) {
    reasons.push(`Missing anchors: ${diagnostics.anchorsMissing.join(', ')}`);
  }

  if (diagnostics.layoutDetected === 'unknown') {
    reasons.push('Layout not matched to a known reference layout');
  }

  return { confidence, reasons };
}

export function buildExtendedParserDiagnostics(parsed) {
  const diagnostics = parsed?.parserDiagnostics || {};
  const parserDebug = parsed?.parserDebug || {};
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const drivers = Array.isArray(parsed?.drivers) ? parsed.drivers : [];

  const requiredFieldChecks = {
    results: results.length > 0,
    winner: Boolean(parsed?.winner),
    sof: parsed?.sof != null,
    cautionCount: parsed?.cautionCount != null,
    raceEvents: Array.isArray(parsed?.raceEvents) && parsed.raceEvents.length > 0,
    sessionEvents: Boolean(diagnostics.sectionsParsed?.sessionEvents),
    driverReports: drivers.length > 0,
    parserVersion: Boolean(diagnostics.parserVersion || IRACECONTROL_PARSER_VERSION),
  };

  const requiredFieldsFound = Object.entries(requiredFieldChecks)
    .filter(([, found]) => found)
    .map(([field]) => field);
  const missingRequiredFields = Object.entries(requiredFieldChecks)
    .filter(([, found]) => !found)
    .map(([field]) => field);

  const rowParseSummary = buildRowParseSummary(results, parserDebug);
  const driverReportSummary = buildDriverReportSummary(
    drivers,
    parsed?.driverReportDiagnostics || parserDebug.driverReportDiagnostics
  );
  const guidance = buildGuidanceMessages(missingRequiredFields, parsed);
  const suggestedCompatibilityRules = buildSuggestedCompatibilityRules(parsed, missingRequiredFields);
  const confidenceReason = buildConfidenceReason(parsed);

  return {
    confidence: diagnostics.resultParseConfidence || confidenceReason.confidence,
    requiredFieldsFound,
    missingRequiredFields,
    rowParseSummary,
    driverReportSummary,
    guidance,
    suggestedCompatibilityRules,
    confidenceReason: confidenceReason.reasons,
  };
}

export function evaluateLiveParserStatus(parsed, parseStatus) {
  if (parseStatus === 'parse_failed') {
    return { status: 'fail', label: 'FAIL', reasons: ['Parse failed'] };
  }
  if (parseStatus !== 'parsed' || !parsed) {
    return { status: 'warn', label: 'WARN', reasons: ['Report not parsed yet'] };
  }

  const extended = buildExtendedParserDiagnostics(parsed);
  const confidence = extended.confidence || 'low';
  const missing = extended.missingRequiredFields || [];

  if (
    missing.includes('results') ||
    missing.includes('winner') ||
    (rowParseSummaryHasCriticalIssues(extended.rowParseSummary) && confidence === 'low')
  ) {
    return {
      status: 'fail',
      label: 'FAIL',
      reasons: extended.guidance.length ? extended.guidance : missing,
      missingRequiredFields: missing,
    };
  }

  if (missing.length || confidence === 'low') {
    return {
      status: 'warn',
      label: 'WARN',
      reasons: extended.guidance.length ? extended.guidance : missing,
      missingRequiredFields: missing,
    };
  }

  return {
    status: 'pass',
    label: 'PASS',
    reasons: [],
    missingRequiredFields: missing,
  };
}

function rowParseSummaryHasCriticalIssues(summary) {
  return (
    (summary?.duplicatePositions?.length || 0) > 0 ||
    (summary?.duplicateCarNumbers?.length || 0) > 0 ||
    summary?.failedRowCount > 0
  );
}

export function compareConfidence(actual, minimum) {
  if (!minimum) return true;
  const left = CONFIDENCE_RANK[String(actual || 'low').toLowerCase()] ?? 0;
  const right = CONFIDENCE_RANK[String(minimum || 'low').toLowerCase()] ?? 0;
  return left >= right;
}

export { normalizeName };
