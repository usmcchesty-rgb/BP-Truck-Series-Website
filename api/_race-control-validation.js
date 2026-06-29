import { fetchHtml, getSettings } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getPointsRaceByNumber,
} from './_schedule-points-races.js';
import { fetchStandingsRows } from './power-rankings-generate.js';
import {
  countOfficialRaceStarters,
  extractOfficialRaceFinishes,
  findScheduleEntryByScheduleId,
} from './_simracerhub-schedule-results.js';
import { IRACECONTROL_PARSER_VERSION as RACE_CONTROL_PARSER_VERSION } from './_iracecontrol-compatibility.js';

export { RACE_CONTROL_PARSER_VERSION };

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTrackName(value) {
  return normalizeName(value)
    .replace(/\bsuperspeedway\b/g, '')
    .replace(/\binternational\b/g, '')
    .replace(/\bmotor\b/g, '')
    .replace(/\bspeedway\b/g, '')
    .replace(/\boval\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tracksMatch(pdfTrack, officialTrack) {
  const left = normalizeTrackName(pdfTrack);
  const right = normalizeTrackName(officialTrack);
  if (!left || !right) return null;
  return left === right || left.includes(right) || right.includes(left);
}

function buildCheck({ id, label, passed, severity = 'error', message = null, detail = null }) {
  return { id, label, passed: Boolean(passed), severity, message, detail };
}

function deriveConfidence(checks, warnings) {
  const failedErrors = checks.filter((check) => !check.passed && check.severity === 'error');
  if (failedErrors.length) return 'low';
  const failedWarnings = checks.filter(
    (check) => !check.passed && check.severity !== 'info'
  );
  if (warnings.length || failedWarnings.length) return 'medium';
  return 'high';
}

function resolveExpectedFieldSize({
  officialContext,
  pdfDriverCount,
  analysis,
}) {
  const parsedCount = pdfDriverCount;
  const positionsComplete = analysis.positionsComplete;
  const officialStarters = officialContext?.officialStarters ?? null;
  const officialFinishers = officialContext?.officialFieldSize ?? null;

  if (officialStarters != null && officialStarters === parsedCount) {
    return {
      expected: parsedCount,
      source: 'official_race_bucket',
      confident: true,
      infoMessage: null,
    };
  }

  if (officialFinishers != null && officialFinishers === parsedCount) {
    return {
      expected: parsedCount,
      source: 'official_finish_count',
      confident: true,
      infoMessage: null,
    };
  }

  if (positionsComplete && parsedCount > 0) {
    const officialHint =
      officialStarters != null && officialFinishers != null
        ? `${officialFinishers} classified / ${officialStarters} in race bucket`
        : officialFinishers != null
          ? `${officialFinishers} classified`
          : officialStarters != null
            ? `${officialStarters} in race bucket`
            : null;

    return {
      expected: parsedCount,
      source: 'race_control_fallback',
      confident: false,
      infoMessage: officialHint
        ? `Official starter count unavailable or incomplete (${officialHint} vs ${parsedCount} parsed). Using parsed Race Control report count.`
        : 'Official starter count unavailable. Using parsed Race Control report count.',
    };
  }

  if (officialStarters != null) {
    return {
      expected: officialStarters,
      source: 'official_race_bucket',
      confident: officialStarters === parsedCount,
      infoMessage: null,
    };
  }

  if (officialFinishers != null) {
    return {
      expected: officialFinishers,
      source: 'official_finish_count',
      confident: officialFinishers === parsedCount,
      infoMessage: null,
    };
  }

  if (parsedCount > 0) {
    return {
      expected: parsedCount,
      source: 'race_control_only',
      confident: false,
      infoMessage:
        'Official starter count unavailable. Using parsed Race Control report count.',
    };
  }

  return {
    expected: null,
    source: 'none',
    confident: false,
    infoMessage: null,
  };
}

function analyzeParsedResults(results = []) {
  const positions = results.map((row) => Number(row.position)).filter(Number.isFinite);
  const carNumbers = results.map((row) => String(row.carNumber ?? '').trim()).filter(Boolean);

  const duplicatePositions = positions.filter(
    (position, index) => positions.indexOf(position) !== index
  );
  const duplicateCarNumbers = carNumbers.filter(
    (carNumber, index) => carNumbers.indexOf(carNumber) !== index
  );

  const uniquePositions = [...new Set(positions)].sort((a, b) => a - b);
  const missingPositions = [];
  const expectedCount = uniquePositions.length
    ? uniquePositions[uniquePositions.length - 1]
    : 0;

  for (let position = 1; position <= expectedCount; position += 1) {
    if (!uniquePositions.includes(position)) missingPositions.push(position);
  }

  return {
    parsedCount: results.length,
    expectedSequentialCount: expectedCount,
    missingPositions,
    duplicatePositions: [...new Set(duplicatePositions)],
    duplicateCarNumbers: [...new Set(duplicateCarNumbers)],
    positionsComplete:
      expectedCount > 0 &&
      missingPositions.length === 0 &&
      duplicatePositions.length === 0 &&
      uniquePositions[0] === 1 &&
      uniquePositions[uniquePositions.length - 1] === expectedCount,
  };
}

export async function loadOfficialRaceContext(settings, raceNumber) {
  const resolvedSettings = settings || (await getSettings());
  const targetRace = Number(raceNumber);
  const html = await fetchHtml(resolvedSettings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(html));
  const scheduleRace = getPointsRaceByNumber(scheduleRaces, targetRace);
  const raceDebug = buildRaceNumberDebug(scheduleRaces, targetRace, {
    settings: resolvedSettings,
  });

  let officialFieldSize = null;
  let officialStarters = null;
  let officialWinner = scheduleRace?.winner || null;

  if (raceDebug.standingsScheduleId) {
    try {
      const standings = await fetchStandingsRows(
        resolvedSettings,
        raceDebug.standingsScheduleId
      );
      const entry = findScheduleEntryByScheduleId(
        standings.schedules,
        raceDebug.standingsScheduleId
      );
      const starterCounts = countOfficialRaceStarters(entry);
      officialStarters = starterCounts.starterCount ?? null;
      officialFieldSize = starterCounts.finisherCount ?? null;

      const { finishes, meta } = extractOfficialRaceFinishes(entry);
      if (officialFieldSize == null) {
        officialFieldSize = meta?.driverCount ?? null;
      }

      const winnerDriverId = meta?.winnerDriverId;
      if (winnerDriverId && finishes[String(winnerDriverId)]) {
        const winnerRow = standings.rows.find(
          (row) => String(row.driverId) === String(winnerDriverId)
        );
        if (winnerRow?.driverName) {
          officialWinner = winnerRow.driverName;
        }
      }
    } catch {
      // Official standings unavailable — schedule page remains primary source.
    }
  }

  return {
    raceNumber: targetRace,
    scheduleRace,
    officialWinner,
    officialTrack: scheduleRace?.track || raceDebug.currentRaceName || null,
    officialFieldSize,
    officialStarters,
    hasOfficialResults: Boolean(scheduleRace?.winner || officialFieldSize || officialStarters),
    standingsScheduleId: raceDebug.standingsScheduleId || null,
  };
}

export function validateRaceControlReport({
  parsedJson,
  raceNumber,
  officialContext = null,
}) {
  const warnings = [];
  const results = Array.isArray(parsedJson?.results) ? parsedJson.results : [];
  const parsed = parsedJson || {};
  const summary = parsed.summary || {};
  const analysis = analyzeParsedResults(results);

  const pdfWinner = parsed.winner || summary.winner || null;
  const pdfTrack = parsed.trackName || summary.trackName || null;
  const pdfRaceNumber = parsed.raceNumber != null ? Number(parsed.raceNumber) : Number(raceNumber);
  const pdfSof = parsed.sof ?? summary.sof ?? null;
  const pdfCautions = parsed.cautionCount ?? summary.cautionCount ?? null;
  const pdfDriverCount =
    summary.totalDrivers ?? summary.resultCount ?? results.length ?? 0;

  const officialWinner = officialContext?.officialWinner || null;
  const officialTrack = officialContext?.officialTrack || null;
  const officialFieldSize = officialContext?.officialFieldSize ?? null;
  const targetRaceNumber = Number(raceNumber);
  const fieldSizeResolution = resolveExpectedFieldSize({
    officialContext,
    pdfDriverCount,
    analysis,
  });
  const expectedFieldSize = fieldSizeResolution.expected;
  const infoMessages = fieldSizeResolution.infoMessage ? [fieldSizeResolution.infoMessage] : [];

  const checks = [];

  if (officialWinner && pdfWinner) {
    const passed = normalizeName(pdfWinner) === normalizeName(officialWinner);
    checks.push(
      buildCheck({
        id: 'winner_match',
        label: 'Winner matches official results',
        passed,
        severity: 'error',
        message: passed
          ? null
          : `PDF winner (${pdfWinner}) differs from official winner (${officialWinner}). Official results take precedence.`,
      })
    );
    if (!passed) warnings.push(checks[checks.length - 1].message);
  } else if (officialContext?.hasOfficialResults && !pdfWinner) {
    checks.push(
      buildCheck({
        id: 'winner_match',
        label: 'Winner matches official results',
        passed: false,
        severity: 'warning',
        message: 'Official winner exists but PDF winner was not parsed.',
      })
    );
    warnings.push(checks[checks.length - 1].message);
  } else {
    checks.push(
      buildCheck({
        id: 'winner_match',
        label: 'Winner matches official results',
        passed: Boolean(pdfWinner),
        severity: 'warning',
        message: officialWinner
          ? null
          : 'Official winner not available for comparison.',
      })
    );
  }

  if (officialTrack && pdfTrack) {
    const passed = tracksMatch(pdfTrack, officialTrack);
    checks.push(
      buildCheck({
        id: 'track_match',
        label: 'Track matches schedule',
        passed,
        severity: 'error',
        message: passed
          ? null
          : `PDF track (${pdfTrack}) differs from scheduled track (${officialTrack}).`,
      })
    );
    if (!passed) warnings.push(checks[checks.length - 1].message);
  } else {
    checks.push(
      buildCheck({
        id: 'track_match',
        label: 'Track matches schedule',
        passed: Boolean(pdfTrack),
        severity: 'warning',
        message: !pdfTrack ? 'PDF track not parsed.' : 'Scheduled track not available for comparison.',
      })
    );
  }

  if (Number.isInteger(targetRaceNumber) && targetRaceNumber > 0) {
    const passed = pdfRaceNumber === targetRaceNumber;
    checks.push(
      buildCheck({
        id: 'race_number_match',
        label: 'Race number matches selected race',
        passed,
        severity: 'error',
        message: passed
          ? null
          : `PDF race number (${pdfRaceNumber}) does not match selected race (${targetRaceNumber}).`,
      })
    );
    if (!passed) warnings.push(checks[checks.length - 1].message);
  }

  if (expectedFieldSize != null && pdfDriverCount > 0) {
    const passed = pdfDriverCount === expectedFieldSize;
    const usingFallback = fieldSizeResolution.source.startsWith('race_control');
    checks.push(
      buildCheck({
        id: 'driver_count_match',
        label: 'Driver count matches official field size',
        passed: passed || (usingFallback && analysis.positionsComplete),
        severity: usingFallback ? 'info' : 'error',
        message: passed
          ? fieldSizeResolution.infoMessage
          : usingFallback
            ? fieldSizeResolution.infoMessage
            : `PDF driver count (${pdfDriverCount}) differs from expected field size (${expectedFieldSize}).`,
      })
    );
    if (!passed && !usingFallback && checks[checks.length - 1].message) {
      warnings.push(checks[checks.length - 1].message);
    }
  } else {
    checks.push(
      buildCheck({
        id: 'driver_count_match',
        label: 'Driver count matches official field size',
        passed: pdfDriverCount > 0,
        severity: 'warning',
        message:
          officialFieldSize == null
            ? 'Official field size not available for comparison.'
            : 'No parsed driver results available.',
      })
    );
  }

  checks.push(
    buildCheck({
      id: 'positions_complete',
      label: `Positions complete (${analysis.expectedSequentialCount || pdfDriverCount || 0})`,
      passed: analysis.positionsComplete && pdfDriverCount > 0,
      severity: 'error',
      message: analysis.missingPositions.length
        ? `Missing finishing positions: ${analysis.missingPositions.join(', ')}`
        : null,
    })
  );
  if (!checks[checks.length - 1].passed && checks[checks.length - 1].message) {
    warnings.push(checks[checks.length - 1].message);
  }

  checks.push(
    buildCheck({
      id: 'no_duplicate_positions',
      label: 'No duplicate finishing positions',
      passed: analysis.duplicatePositions.length === 0,
      severity: 'error',
      message: analysis.duplicatePositions.length
        ? `Duplicate positions: ${analysis.duplicatePositions.join(', ')}`
        : null,
    })
  );
  if (!checks[checks.length - 1].passed && checks[checks.length - 1].message) {
    warnings.push(checks[checks.length - 1].message);
  }

  checks.push(
    buildCheck({
      id: 'no_duplicate_car_numbers',
      label: 'No duplicate car numbers',
      passed: analysis.duplicateCarNumbers.length === 0,
      severity: 'error',
      message: analysis.duplicateCarNumbers.length
        ? `Duplicate car numbers: ${analysis.duplicateCarNumbers.join(', ')}`
        : null,
    })
  );
  if (!checks[checks.length - 1].passed && checks[checks.length - 1].message) {
    warnings.push(checks[checks.length - 1].message);
  }

  checks.push(
    buildCheck({
      id: 'sof_present',
      label: 'SOF present',
      passed: pdfSof != null && Number.isFinite(Number(pdfSof)),
      severity: 'warning',
      message: pdfSof == null ? 'SOF was not parsed from the PDF.' : null,
    })
  );
  if (!checks[checks.length - 1].passed && checks[checks.length - 1].message) {
    warnings.push(checks[checks.length - 1].message);
  }

  checks.push(
    buildCheck({
      id: 'cautions_reasonable',
      label: 'Caution count is reasonable',
      passed: pdfCautions != null && Number(pdfCautions) >= 0,
      severity: 'warning',
      message:
        pdfCautions == null
          ? 'Caution count was not parsed from the PDF.'
          : Number(pdfCautions) < 0
            ? 'Caution count is negative.'
            : null,
    })
  );
  if (!checks[checks.length - 1].passed && checks[checks.length - 1].message) {
    warnings.push(checks[checks.length - 1].message);
  }

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.filter((check) => !check.passed).length;
  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
  const uniqueInfoMessages = [...new Set(infoMessages.filter(Boolean))];
  const confidence = deriveConfidence(checks, uniqueWarnings);

  return {
    confidence,
    passed,
    failed,
    warnings: uniqueWarnings,
    infoMessages: uniqueInfoMessages,
    checks,
    officialPrecedence: true,
    supplementalOnly: true,
    parsedDriverCount: pdfDriverCount,
    officialFieldSize,
    officialStarters: officialContext?.officialStarters ?? null,
    fieldSizeSource: fieldSizeResolution.source,
    fieldSizeConfident: fieldSizeResolution.confident,
    rowsExpected: expectedFieldSize ?? analysis.expectedSequentialCount ?? pdfDriverCount,
    rowsParsed: pdfDriverCount,
    analysis,
  };
}

export function buildParserHealth(parsedJson, validation = null) {
  const diagnostics = parsedJson?.parserDiagnostics || {};
  const rowsParsed = validation?.rowsParsed ?? diagnostics.resultsDetected ?? 0;
  const rowsExpected =
    validation?.rowsExpected ??
    (rowsParsed > 0 ? rowsParsed : null) ??
    diagnostics.expectedResultRows ??
    null;

  return {
    parserVersion: RACE_CONTROL_PARSER_VERSION,
    confidence: validation?.confidence || diagnostics.resultParseConfidence || 'unknown',
    rowsParsed,
    rowsExpected,
    parseTimeMs: parsedJson?.parseTimingMs ?? null,
    compatibilityFixesApplied: parsedJson?.parserDebug?.compatibilityFixesApplied || [],
    layoutNotes: parsedJson?.parserDebug?.layoutNotes || [],
    warnings: [
      ...(Array.isArray(parsedJson?.parseWarnings) ? parsedJson.parseWarnings : []),
      ...(validation?.infoMessages || []),
      ...(validation?.warnings || []),
    ].filter((value, index, list) => list.indexOf(value) === index),
  };
}

export async function enrichRaceControlReport(report, options = {}) {
  if (!report) return null;

  const settings = options.settings || (await getSettings());
  const raceNumber = Number(report.raceNumber);
  const parsedJson = report.parsedJson || null;

  if (!parsedJson || report.parseStatus !== 'parsed') {
    return {
      ...report,
      validation: null,
      parserHealth: null,
    };
  }

  let officialContext = null;
  try {
    officialContext = await loadOfficialRaceContext(settings, raceNumber);
  } catch {
    officialContext = null;
  }

  const validation = validateRaceControlReport({
    parsedJson,
    raceNumber,
    officialContext,
  });

  return {
    ...report,
    validation,
    parserHealth: buildParserHealth(parsedJson, validation),
    officialContext: officialContext
      ? {
          winner: officialContext.officialWinner,
          track: officialContext.officialTrack,
          fieldSize: officialContext.officialFieldSize,
          starters: officialContext.officialStarters,
          hasOfficialResults: officialContext.hasOfficialResults,
        }
      : null,
  };
}
