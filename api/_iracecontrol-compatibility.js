/**
 * iRaceControl PDF compatibility layer — anchor discovery and layout-agnostic section slicing.
 * Reference layouts: Talladega 2026, Daytona 2026.
 */

export const IRACECONTROL_PARSER_VERSION = 'iracecontrol-v3';

export const SUPPORTED_LAYOUTS = ['Talladega 2026', 'Daytona 2026'];

/** Flexible page header — tolerates generated / genereated / future typos after "This document was". */
export const DOCUMENT_HEADER_PATTERN = /This document was\s+\S+:/gi;
export const DOCUMENT_HEADER_PATTERNPlain = /This document was\s+\S+:/i;

export const RESULTS_TABLE_HEADER_PATTERN =
  /\b(?:P\s+C\s+NO\s+NAME\s+NAT\s+CAR\s+LIC\s+RAT\s+GRID\s+INC\s+LAPS\s+TIME\s+GAP\s+INT\s+BEST\s+ON\s+STATUS(?:\s+PEN)?|Pos\s+Cls\s+Car\s+Driver)\b/i;

export const IRACECONTROL_ANCHORS = [
  {
    id: 'documentHeader',
    category: 'header',
    pattern: DOCUMENT_HEADER_PATTERNPlain,
    label: 'This document was …',
    core: true,
  },
  {
    id: 'resultsTableHeader',
    category: 'results',
    pattern: RESULTS_TABLE_HEADER_PATTERN,
    label: 'Results table header',
    core: true,
  },
  {
    id: 'stage1',
    category: 'stage',
    pattern: /\bSTAGE\s+1(?:\s*\(L\d+\))?/i,
    label: 'STAGE 1',
    fix: 'stage_section_boundary',
    note: 'STAGE section found between results and lap chart.',
  },
  {
    id: 'stage2',
    category: 'stage',
    pattern: /\bSTAGE\s+2(?:\s*\(L\d+\))?/i,
    label: 'STAGE 2',
    fix: 'stage_section_boundary',
    note: 'STAGE 2 section found after results table.',
  },
  {
    id: 'stageAny',
    category: 'stage',
    pattern: /\bSTAGE\s+\d+\s*\(L\d+\)/i,
    label: 'STAGE (L#)',
  },
  {
    id: 'lapChartRace',
    category: 'lapChart',
    pattern: /\bLAP CHART\s*-\s*RACE\b/i,
    label: 'LAP CHART - RACE',
    core: true,
  },
  {
    id: 'sessionReports',
    category: 'session',
    pattern: /\bSESSION REPORTS\b/i,
    label: 'SESSION REPORTS',
    core: true,
  },
  {
    id: 'incidentReports',
    category: 'incident',
    pattern: /\bINCIDENT REPORTS\b/i,
    label: 'INCIDENT REPORTS',
    core: true,
  },
  {
    id: 'driverReportBlock',
    category: 'driverReports',
    pattern: /\d+\s*-\s*[^:]+\s+CLASS:/i,
    label: 'Driver incident report block',
  },
];

const RESULTS_END_ANCHOR_IDS = new Set([
  'stage1',
  'stage2',
  'stageAny',
  'lapChartRace',
  'sessionReports',
  'incidentReports',
  'driverReportBlock',
  'documentHeader',
]);

const ROW_END_ANCHOR_IDS = new Set([
  'stageAny',
  'lapChartRace',
  'sessionReports',
  'incidentReports',
  'documentHeader',
]);

export function createCompatibilityContext() {
  return { fixes: [], notes: [], anchors: null };
}

export function recordCompatibility(compatibility, fix, note = null) {
  if (!compatibility) return;
  if (fix && !compatibility.fixes.includes(fix)) {
    compatibility.fixes.push(fix);
  }
  if (note && !compatibility.notes.includes(note)) {
    compatibility.notes.push(note);
  }
}

export function findFirstMatchAfter(text, afterIndex, pattern) {
  const slice = text.slice(Math.max(0, afterIndex));
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const match = re.exec(slice);
  if (!match || match.index == null) return -1;
  return afterIndex + match.index;
}

export function discoverAnchors(text) {
  const found = [];

  for (const anchor of IRACECONTROL_ANCHORS) {
    const flags = anchor.pattern.flags.includes('g') ? anchor.pattern.flags : `${anchor.pattern.flags}g`;
    const re = new RegExp(anchor.pattern.source, flags);
    let match;
    while ((match = re.exec(text)) !== null) {
      found.push({
        id: anchor.id,
        category: anchor.category,
        label: anchor.label,
        index: match.index,
        matchText: match[0],
        core: Boolean(anchor.core),
        fix: anchor.fix || null,
        note: anchor.note || null,
      });
    }
  }

  found.sort((a, b) => a.index - b.index);

  const byId = new Map();
  for (const entry of found) {
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  }

  return { anchors: found, byId };
}

export function findNextSectionBoundary(text, afterIndex, options = {}) {
  const {
    anchorIds = null,
    skipDocumentHeadersBefore = afterIndex + 50,
    includeRepeatedDocumentHeader = true,
  } = options;

  const allowedIds = anchorIds
    ? new Set(anchorIds)
    : new Set(IRACECONTROL_ANCHORS.map((anchor) => anchor.id));

  let earliest = text.length;
  let boundary = null;

  for (const anchor of IRACECONTROL_ANCHORS) {
    if (!allowedIds.has(anchor.id)) continue;
    const idx = findFirstMatchAfter(text, afterIndex + 1, anchor.pattern);
    if (idx < 0 || idx >= earliest) continue;

    if (anchor.id === 'documentHeader' && idx < skipDocumentHeadersBefore) continue;

    earliest = idx;
    boundary = {
      index: idx,
      anchorId: anchor.id,
      label: anchor.label,
      fix: anchor.fix || null,
      note: anchor.note || null,
    };
  }

  if (includeRepeatedDocumentHeader) {
    const repeated = findRepeatedDocumentHeaderAfter(text, afterIndex + 1, {
      beforeIndex: earliest,
    });
    if (repeated >= 0 && repeated < earliest) {
      earliest = repeated;
      boundary = {
        index: repeated,
        anchorId: 'documentHeaderRepeated',
        label: 'Repeated document header',
        fix: 'legacy_results_boundary',
        note: 'Repeated document header found after results table (multi-page flattening).',
      };
    }
  }

  return boundary;
}

export function findRepeatedDocumentHeaderAfter(text, afterIndex, options = {}) {
  const { beforeIndex = text.length } = options;
  const re = new RegExp(DOCUMENT_HEADER_PATTERN.source, 'gi');
  let match;
  let occurrence = 0;

  while ((match = re.exec(text)) !== null) {
    occurrence += 1;
    if (occurrence === 1) continue;
    if (match.index > afterIndex && match.index < beforeIndex) {
      return match.index;
    }
  }

  return -1;
}

export function findResultsSectionStart(text) {
  const headerMatch = text.match(RESULTS_TABLE_HEADER_PATTERN);
  if (headerMatch?.index != null) {
    const afterHeader = text.slice(headerMatch.index + headerMatch[0].length);
    const rowStart = afterHeader.search(/\b\d+\s+\d+\s+\d+\s+[A-Z]/);
    if (rowStart !== -1) {
      return headerMatch.index + headerMatch[0].length + rowStart;
    }
  }

  return text.search(/\b1\s+\d+\s+\d+\s+[A-Z]/);
}

export function sliceSectionByBoundary(text, startIndex, boundaryAnchorIds, compatibility = null) {
  const boundary = findNextSectionBoundary(text, startIndex, {
    anchorIds: boundaryAnchorIds,
    skipDocumentHeadersBefore: startIndex + 50,
  });

  let endIndex = text.length;
  if (boundary) {
    endIndex = boundary.index;
    recordCompatibility(compatibility, boundary.fix, boundary.note);
  }

  return {
    section: text.slice(startIndex, endIndex).trim(),
    boundary,
    endIndex,
  };
}

export function findResultRowEndBoundary(sectionText, fromIndex) {
  const boundary = findNextSectionBoundary(sectionText, fromIndex, {
    anchorIds: [...ROW_END_ANCHOR_IDS],
    skipDocumentHeadersBefore: fromIndex + 1,
  });
  return boundary?.index ?? sectionText.length;
}

export function resolveSessionReportsSection(text, compatibility = null) {
  const discovery = discoverAnchors(text);
  const sessionHits = discovery.byId.get('sessionReports') || [];
  const incidentHits = discovery.byId.get('incidentReports') || [];

  if (!sessionHits.length) {
    return { section: '', warnings: ['SESSION REPORTS section not found.'], discovery };
  }

  const startIdx = sessionHits[0].index;
  const incidentIdx = incidentHits.length ? incidentHits[0].index : -1;

  let section;
  if (incidentIdx >= 0 && incidentIdx < startIdx) {
    recordCompatibility(
      compatibility,
      'session_reports_out_of_order',
      'SESSION REPORTS found after INCIDENT REPORTS.'
    );
    const boundary = findNextSectionBoundary(text, startIdx, {
      anchorIds: ['driverReportBlock'],
      skipDocumentHeadersBefore: text.length,
      includeRepeatedDocumentHeader: false,
    });
    const endIndex = boundary?.index ?? text.length;
    section = text.slice(startIdx + 'SESSION REPORTS'.length, endIndex);
  } else if (incidentIdx > startIdx) {
    section = text.slice(startIdx + 'SESSION REPORTS'.length, incidentIdx);
  } else {
    section = text.slice(startIdx + 'SESSION REPORTS'.length);
  }

  const driverBlockIdx = section.search(/\d+\s*-\s*[^:]+\s+CLASS:/i);
  if (driverBlockIdx >= 0) {
    section = section.slice(0, driverBlockIdx);
  }

  return { section, warnings: [], discovery, startIdx };
}

export function detectLayout(text, header, discovery) {
  const track = String(header?.trackName || header?.layoutTrackName || '');
  if (/talladega/i.test(track)) return 'Talladega 2026';
  if (/daytona/i.test(track)) return 'Daytona 2026';

  const hasStage = (discovery.byId.get('stageAny') || []).length > 0;
  const sessionHits = discovery.byId.get('sessionReports') || [];
  const incidentHits = discovery.byId.get('incidentReports') || [];
  const sessionAfterIncident =
    sessionHits.length &&
    incidentHits.length &&
    sessionHits[0].index > incidentHits[0].index;

  if (hasStage || sessionAfterIncident) return 'Daytona 2026';
  if ((discovery.byId.get('lapChartRace') || []).length) return 'Talladega 2026';

  return 'unknown';
}

export function buildExpectedCoreAnchors() {
  return IRACECONTROL_ANCHORS.filter((anchor) => anchor.core).map((anchor) => anchor.id);
}

export function buildParserLayoutDiagnostics({
  text,
  parsed,
  sections = {},
  compatibility = null,
  discovery = null,
  header = null,
}) {
  const anchorDiscovery = discovery || discoverAnchors(text);
  const anchorsFound = [...new Set(anchorDiscovery.anchors.map((entry) => entry.id))];
  const coreIds = buildExpectedCoreAnchors();
  const anchorsMissing = coreIds.filter((id) => !anchorsFound.includes(id));

  const layoutDetected = detectLayout(text, header, anchorDiscovery);

  const sectionsParsed = {
    header: Boolean(header?.generatedAt || header?.sof),
    results: (parsed?.results?.length || 0) > 0,
    stages: (parsed?.stages?.length || 0) > 0,
    sessionEvents: (parsed?.raceEvents?.length || 0) > 0,
    driverReports: (parsed?.drivers?.length || 0) > 0,
    ...sections,
  };

  return {
    parserVersion: IRACECONTROL_PARSER_VERSION,
    supportedLayouts: SUPPORTED_LAYOUTS,
    layoutDetected,
    anchorsFound,
    anchorsMissing,
    sectionsParsed,
    compatibilityFixesApplied: compatibility?.fixes ? [...compatibility.fixes] : [],
    layoutNotes: compatibility?.notes ? [...compatibility.notes] : [],
    resultsBoundaryUsed: sections.resultsBoundaryUsed || null,
    anchorPositions: anchorDiscovery.anchors.slice(0, 40),
  };
}

export function deriveParserConfidence({ parsed, layoutDiagnostics }) {
  const rowCount = parsed?.results?.length || 0;
  const diagnostics = parsed?.parserDiagnostics || {};
  let confidence = diagnostics.resultParseConfidence || 'low';

  if (rowCount >= 30) confidence = 'high';
  else if (rowCount >= 10) confidence = 'medium';
  else confidence = 'low';

  const missing = layoutDiagnostics?.anchorsMissing || [];
  const criticalMissing = missing.filter((id) =>
    ['documentHeader', 'resultsTableHeader'].includes(id)
  );

  if (criticalMissing.length && rowCount < 10) {
    confidence = 'low';
  } else if (missing.length && confidence === 'high') {
    confidence = 'medium';
  }

  if (layoutDiagnostics?.layoutDetected === 'unknown' && confidence === 'high' && missing.length) {
    confidence = 'medium';
  }

  if (parsed.sof != null && confidence === 'low' && rowCount >= 5) {
    confidence = 'medium';
  }

  return confidence;
}

const SOF_SCAN_PATTERNS = [
  { id: 'sof_label_first', re: /\bSOF\s*[:\.]?\s*(\d{3,5})\b/gi },
  { id: 'sof_number_first', re: /\b(\d{3,5})\s+SOF\b/gi },
  {
    id: 'strength_of_field',
    re: /\bStrength[\s-]*(?:of[\s-]*)?[Ff]ield[\s-]*[:\.]?\s*(\d{3,5})\b/gi,
  },
  { id: 'strength_field_short', re: /\bStrength[\s-]+field[\s-]*[:\.]?\s*(\d{3,5})\b/gi },
];

function isValidSofValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 100 && numeric <= 99999;
}

function collectSofDebugSnippets(text, maxSnippets = 20, maxLen = 200) {
  const normalized = String(text || '');
  const keywords = ['SOF', 'Strength', 'Field'];
  const snippets = [];
  const seen = new Set();

  for (const keyword of keywords) {
    let searchFrom = 0;
    const lower = normalized.toLowerCase();
    const needle = keyword.toLowerCase();

    while (snippets.length < maxSnippets) {
      const found = lower.indexOf(needle, searchFrom);
      if (found < 0) break;

      const start = Math.max(0, found - 70);
      const snippet = normalized.slice(start, start + maxLen).trim();
      if (snippet && !seen.has(snippet)) {
        seen.add(snippet);
        snippets.push(snippet.slice(0, maxLen));
      }
      searchFrom = found + needle.length;
    }
  }

  return snippets.slice(0, maxSnippets);
}

function findSofMatchesInText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const matches = [];
  const seen = new Set();

  for (const pattern of SOF_SCAN_PATTERNS) {
    const re = new RegExp(pattern.re.source, pattern.re.flags);
    let match;
    while ((match = re.exec(normalized)) !== null) {
      const value = Number(match[1]);
      if (!isValidSofValue(value)) continue;

      const key = `${match.index}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const snippetStart = Math.max(0, match.index - 80);
      const snippetEnd = Math.min(normalized.length, match.index + match[0].length + 80);
      matches.push({
        value,
        index: match.index,
        patternId: pattern.id,
        matchText: match[0],
        nearbyText: normalized.slice(snippetStart, snippetEnd).trim(),
      });
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return { normalized, matches };
}

function pickPreferredSofMatch(matches, text) {
  if (!matches.length) return null;

  const raceIdx = text.search(/\bRACE\s*-/i);
  if (raceIdx < 0) return matches[0];

  return matches.slice().sort((a, b) => {
    const distanceDelta = Math.abs(a.index - raceIdx) - Math.abs(b.index - raceIdx);
    if (distanceDelta !== 0) return distanceDelta;
    return a.index - b.index;
  })[0];
}

/**
 * Scan full extracted PDF text for Strength of Field (layout-independent).
 * Priority: existing header SOF > nearest match to RACE header > first match.
 */
export function extractStrengthOfField(text, options = {}) {
  const existingSof =
    options.existingSof != null && isValidSofValue(options.existingSof)
      ? Number(options.existingSof)
      : null;

  const { normalized, matches } = findSofMatchesInText(text);
  const sofMatches = [...new Set(matches.map((entry) => entry.value))];
  const sofNearbyText = matches.map((entry) => entry.nearbyText);

  if (existingSof != null) {
    return {
      sof: existingSof,
      sofFound: true,
      sofSource: 'race_header',
      sofMatches: sofMatches.length ? sofMatches : [existingSof],
      sofNearbyText,
      sofDebugSnippets: [],
    };
  }

  const selected = pickPreferredSofMatch(matches, normalized);
  if (selected) {
    return {
      sof: selected.value,
      sofFound: true,
      sofSource: 'global_scan',
      sofMatches,
      sofNearbyText,
      sofDebugSnippets: [],
    };
  }

  return {
    sof: null,
    sofFound: false,
    sofSource: null,
    sofMatches: [],
    sofNearbyText: [],
    sofDebugSnippets: collectSofDebugSnippets(normalized),
  };
}

export function parsePrimaryRaceHeader(text, compatibility = null) {
  const warnings = [];
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const hasTypoVariant = /This document was genereated:/i.test(normalized);

  const match = normalized.match(
    /This document was\s+\S+:\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s+RACE\s*-\s*(.+?)\s*-\s*(?:Oval\s*)?\([^)]*\)\s*-\s*(\d+)\s+SOF/i
  );

  if (match) {
    if (hasTypoVariant) {
      recordCompatibility(
        compatibility,
        'generated_typo_supported',
        'Document header spelling variant supported (genereated).'
      );
    }

    const shortTrack = match[2].trim();
    const ovalMatch = normalized.match(
      /RACE\s*-\s*(.+?)\s*-\s*Oval\s*\([^)]*\)\s*-\s*\d+\s+SOF/i
    );
    const layoutTrackName = ovalMatch ? `${ovalMatch[1].trim()} Oval` : null;

    return {
      generatedAt: match[1].trim(),
      trackName: layoutTrackName || shortTrack,
      layoutTrackName,
      sof: Number(match[3]),
      warnings,
    };
  }

  const generatedMatch = normalized.match(
    /This document was\s+\S+:\s*([\d/:\s]+?)\s+RACE\s*-\s*(.*?)\s*-\s*(?:Oval\s*)?\([^)]*\)/i
  );
  const sofMatch = normalized.match(/\b(\d{3,5})\s+SOF\b/i);

  if (generatedMatch) {
    if (hasTypoVariant) {
      recordCompatibility(
        compatibility,
        'generated_typo_supported',
        'Document header spelling variant supported (genereated).'
      );
    }
    if (sofMatch == null) warnings.push('SOF not detected in race header.');
    const shortTrack = generatedMatch[2].trim();
    const ovalMatch = normalized.match(/RACE\s*-\s*(.+?)\s*-\s*Oval\s*\([^)]*\)/i);
    const layoutTrackName = ovalMatch ? `${ovalMatch[1].trim()} Oval` : null;

    return {
      generatedAt: generatedMatch[1].trim(),
      trackName: layoutTrackName || shortTrack,
      layoutTrackName,
      sof: sofMatch ? Number(sofMatch[1]) : null,
      warnings,
    };
  }

  warnings.push('Race header not detected.');
  return {
    generatedAt: null,
    trackName: null,
    layoutTrackName: null,
    sof: null,
    warnings,
  };
}

export function getResultsSectionFromText(text, compatibility = null) {
  const warnings = [];
  const startIdx = findResultsSectionStart(text);

  if (startIdx === -1) {
    warnings.push('No finishing results rows detected.');
    return {
      section: '',
      warnings,
      boundaryUsed: null,
      boundary: null,
    };
  }

  const { section, boundary } = sliceSectionByBoundary(
    text,
    startIdx,
    [...RESULTS_END_ANCHOR_IDS],
    compatibility
  );

  if (!boundary) {
    const lapIdx = findFirstMatchAfter(text, startIdx, /\bLAP CHART\s*-\s*RACE\b/i);
    if (lapIdx >= 0) {
      return {
        section: text.slice(startIdx, lapIdx).trim(),
        warnings,
        boundaryUsed: 'LAP CHART - RACE',
        boundary: { anchorId: 'lapChartRace', index: lapIdx },
      };
    }
    warnings.push('No section boundary anchor found after results table.');
  }

  return {
    section,
    warnings,
    boundaryUsed: boundary?.label || boundary?.anchorId || null,
    boundary,
  };
}
