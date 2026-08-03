import { resolveDriverEntity } from './_race-research-driver-resolve.js';
import { rankFactImportance } from './_news-writer-ledger.js';

const TIMESTAMP_PREFIX =
  /^(\[\d{1,2}:\d{2}(:\d{2})?\]|\d{1,2}:\d{2}(:\d{2})?\s|Lap\s+\d+[:\s])/i;

const OFFICIAL_CONFIDENCE = new Set(['official', 'officially_confirmed', 'manual']);

const PLACEHOLDER_DRIVER_PATTERN =
  /^(unknown driver|driver|unknown|n\/a|—|-)$/i;

/** Strip iRacing-style trailing car-number artifacts from display names (e.g. Carroll3 → Carroll). */
export function stripTrailingDriverIdArtifact(name) {
  const text = String(name || '').trim();
  if (!text) return '';
  const m = text.match(/^(.+?)(\d{1,2})$/);
  if (m && /[a-zA-Z]/.test(m[1]) && m[1].trim().length >= 3) {
    return m[1].trim();
  }
  return text;
}

export function isPlaceholderDriverName(name) {
  const text = stripTrailingDriverIdArtifact(name);
  if (!text) return true;
  return PLACEHOLDER_DRIVER_PATTERN.test(text);
}

/** Writer-safe label — never returns placeholders or digit artifacts. */
export function planningDriverDisplayName(rawName, lookupMap, driverId = null) {
  const fromId = driverId ? lookupMap.get(String(driverId))?.driverName : null;
  const resolved = resolveDriverEntity(rawName || fromId || '', lookupMap);
  let label = stripTrailingDriverIdArtifact(resolved.canonicalName || rawName || fromId || '');
  if (isPlaceholderDriverName(label)) return null;
  if (/\d{1,2}$/.test(label) && resolved.matchMethod === 'unresolved') {
    label = stripTrailingDriverIdArtifact(label);
  }
  if (isPlaceholderDriverName(label)) return null;
  return label;
}

export function isOfficialConfidence(confidence) {
  return OFFICIAL_CONFIDENCE.has(confidence);
}

export function buildPlanningDriverLookup(racePackage, driverLookup) {
  const rows = [];
  const seen = new Set();

  function addRow(driverId, driverName, carNumber) {
    const id = driverId ? String(driverId) : null;
    const cleaned = stripTrailingDriverIdArtifact(driverName);
    if (!id && !cleaned) return;
    const key = id || cleaned.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push({
      driverId: id || key,
      driverName: cleaned || null,
      carNumber: carNumber || null,
    });
  }

  if (driverLookup instanceof Map) {
    for (const row of driverLookup.values()) {
      addRow(row.driverId, row.driverName || row.display_name, row.carNumber);
    }
  } else if (Array.isArray(driverLookup)) {
    for (const row of driverLookup) {
      addRow(row.driverId, row.driverName || row.display_name, row.carNumber);
    }
  }

  for (const d of racePackage?.driverSummaries || []) {
    addRow(d.driverId, d.canonicalName, d.carNumber);
  }

  for (const f of racePackage?.facts || []) {
    for (let i = 0; i < (f.driverIds || []).length; i += 1) {
      addRow(f.driverIds[i], f.driverNames?.[i], f.structuredData?.carNumber);
    }
  }

  return new Map(rows.map((r) => [String(r.driverId), r]));
}

export function normalizeFactDrivers(fact, lookupMap) {
  const names = fact.driverNames || [];
  const ids = fact.driverIds || [];
  const normalizedNames = [];
  const normalizedIds = [];
  const unresolvedDrivers = [];
  const count = Math.max(names.length, ids.length);

  for (let i = 0; i < count; i += 1) {
    const rawName = names[i] ?? names[0] ?? '';
    const rawId = ids[i] ?? ids[0] ?? null;
    const resolved = resolveDriverEntity(rawName || lookupMap.get(String(rawId))?.driverName, lookupMap);
    const display = planningDriverDisplayName(rawName, lookupMap, rawId);
    const id = resolved.matchedDriverId || (rawId ? String(rawId) : null);

    if (!display) {
      if (rawName || rawId) {
        unresolvedDrivers.push({
          rawName: rawName || null,
          driverId: rawId ? String(rawId) : null,
          matchMethod: resolved.matchMethod,
          requiresReview: true,
        });
      }
      continue;
    }
    if (!normalizedNames.includes(display)) normalizedNames.push(display);
    if (id && !normalizedIds.includes(id)) normalizedIds.push(id);
  }

  return {
    ...fact,
    driverNames: normalizedNames,
    driverIds: normalizedIds,
    _driverResolution: {
      rawDriverNames: [...(fact.driverNames || [])],
      unresolvedDrivers,
    },
  };
}

export function collectUnresolvedDriverDiagnostics(preparedFacts) {
  const byKey = new Map();
  for (const fact of preparedFacts || []) {
    for (const row of fact._driverResolution?.unresolvedDrivers || []) {
      const key = `${row.driverId || ''}|${row.rawName || ''}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          rawName: row.rawName,
          driverId: row.driverId,
          matchMethod: row.matchMethod,
          requiresReview: true,
          factIds: [],
        });
      }
      byKey.get(key).factIds.push(fact.id);
    }
    for (const raw of fact._driverResolution?.rawDriverNames || []) {
      if (!raw) continue;
      const stripped = stripTrailingDriverIdArtifact(raw);
      if (stripped !== raw && /^\d{1,2}$/.test(raw.slice(-2))) {
        const key = `artifact|${raw}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            rawName: raw,
            driverId: null,
            matchMethod: 'trailing_digit_artifact',
            requiresReview: true,
            factIds: [],
          });
        }
        byKey.get(key).factIds.push(fact.id);
      }
    }
  }
  return [...byKey.values()];
}

function hasVerifiedOutcome(fact) {
  if (fact.category === 'winner') return true;
  if (fact.structuredData?.finishPosition != null) return isOfficialConfidence(fact.confidence);
  if (fact.structuredData?.cautionCount != null) return true;
  if (/\bwon the race\b/i.test(fact.summary || '')) return isOfficialConfidence(fact.confidence);
  if (fact.factType === 'championship' && fact.structuredData?.movement != null) {
    return isOfficialConfidence(fact.confidence);
  }
  return false;
}

function isIncompleteSentence(summary) {
  const text = String(summary || '').trim();
  if (!text || text.length < 12) return true;
  if (hasMalformedTimestampPrefix(text) && text.length < 80) return true;
  if (!/[.!?]$/.test(text) && text.split(/\s+/).length < 8) return true;
  if (/\.\.\.$|[—-]$/.test(text)) return true;
  return false;
}

export function hasMalformedTimestampPrefix(summary) {
  return TIMESTAMP_PREFIX.test(String(summary || '').trim());
}

function isSpeculation(summary) {
  return /\b(i expect|i think|might|could|maybe|try and go for|going to try|we'll see)\b/i.test(
    String(summary || '')
  );
}

function isGenericCommentary(summary) {
  const text = String(summary || '');
  return (
    text.length < 70 &&
    /\b(great race|good battle|hard fought|tough day|driver storyline)\b/i.test(text)
  );
}

function hasResolvedDrivers(fact) {
  const names = fact.driverNames || [];
  if (!names.length) return fact.structuredData?.finishPosition != null;
  return names.every((n) => {
    const s = String(n || '').trim();
    if (!s) return false;
    if (/^\d+$/.test(s)) return false;
    if (/^[A-Z][a-z]+ [A-Z][a-z]+\d{1,2}$/.test(s)) return false;
    return true;
  });
}

export function buildCanonicalPreferenceIndex(facts) {
  const byCanonical = new Map();
  for (const fact of facts) {
    const cid = fact.canonicalFactId;
    if (!cid) continue;
    if (!byCanonical.has(cid)) byCanonical.set(cid, []);
    byCanonical.get(cid).push(fact);
  }

  const preferredByCanonical = new Map();
  const officialEquivalentFactIds = new Set();

  for (const [cid, members] of byCanonical) {
    const sorted = [...members].sort((a, b) => {
      const offA = isOfficialConfidence(a.confidence) ? 1 : 0;
      const offB = isOfficialConfidence(b.confidence) ? 1 : 0;
      if (offB !== offA) return offB - offA;
      return rankFactImportance(b) - rankFactImportance(a);
    });
    const primary = sorted[0];
    preferredByCanonical.set(cid, primary.id);
    for (const m of sorted.slice(1)) {
      if (isOfficialConfidence(primary.confidence) && !isOfficialConfidence(m.confidence)) {
        officialEquivalentFactIds.add(m.id);
      }
    }
  }

  return { preferredByCanonical, officialEquivalentFactIds, byCanonical };
}

export function assessFactQuality(fact, { officialEquivalentFactIds } = {}) {
  const summary = String(fact.summary || '');
  const isCompleteSentence = !isIncompleteSentence(summary);
  const hasMalformed = hasMalformedTimestampPrefix(summary);
  const speculation = isSpeculation(summary);
  const generic = isGenericCommentary(summary);
  const hasOfficialEquivalent = officialEquivalentFactIds?.has(fact.id) || false;
  const resolvedDrivers = hasResolvedDrivers(fact);
  const verifiedOutcome = hasVerifiedOutcome(fact);

  let qualityScore = 45;
  if (isCompleteSentence) qualityScore += 12;
  if (verifiedOutcome) qualityScore += 18;
  if (resolvedDrivers) qualityScore += 8;
  if (isOfficialConfidence(fact.confidence)) qualityScore += 15;
  if (fact.category === 'winner') qualityScore += 20;
  if (hasMalformed) qualityScore -= 32;
  if (speculation) qualityScore -= 28;
  if (generic) qualityScore -= 18;
  if (hasOfficialEquivalent) qualityScore -= 35;
  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return {
    isCompleteSentence,
    hasResolvedDrivers: resolvedDrivers,
    hasVerifiedOutcome: verifiedOutcome,
    hasMalformedTimestampPrefix: hasMalformed,
    isSpeculation: speculation,
    isGenericCommentary: generic,
    hasOfficialEquivalent,
    qualityScore,
  };
}

export function planningPriorityTier(fact, quality, importanceScore) {
  if (quality.hasOfficialEquivalent) {
    return { priorityTier: 'supporting', planningEligible: true, criticalEligible: false };
  }
  if (quality.qualityScore < 32) {
    return { priorityTier: 'low', planningEligible: false, criticalEligible: false };
  }
  if (
    fact.category === 'winner' ||
    (fact.structuredData?.finishPosition === 1 && isOfficialConfidence(fact.confidence))
  ) {
    return { priorityTier: 'critical', planningEligible: true, criticalEligible: true };
  }
  if (
    fact.structuredData?.cautionCount != null ||
    (fact.factType === 'caution' && /\b\d+\s+cautions?\b/i.test(fact.summary || ''))
  ) {
    if (isOfficialConfidence(fact.confidence) || quality.qualityScore >= 55) {
      return { priorityTier: 'critical', planningEligible: true, criticalEligible: true };
    }
  }
  if (/third win|3rd win|three wins on the season/i.test(fact.summary || '')) {
    if (quality.qualityScore >= 45) {
      return { priorityTier: 'critical', planningEligible: true, criticalEligible: true };
    }
  }

  let adjusted = importanceScore;
  if (!quality.isCompleteSentence && !isOfficialConfidence(fact.confidence)) adjusted -= 35;
  if (quality.hasMalformedTimestampPrefix) adjusted -= 45;
  if (quality.isSpeculation) adjusted -= 40;
  if (quality.isGenericCommentary) adjusted -= 25;

  if (adjusted >= 85 && quality.qualityScore >= 55) {
    return { priorityTier: 'critical', planningEligible: true, criticalEligible: quality.qualityScore >= 50 };
  }
  if (adjusted >= 65) return { priorityTier: 'high', planningEligible: true, criticalEligible: false };
  if (adjusted >= 40) return { priorityTier: 'medium', planningEligible: true, criticalEligible: false };
  return { priorityTier: 'low', planningEligible: quality.qualityScore >= 40, criticalEligible: false };
}

export function prepareFactsForPlanning(racePackage, driverLookup) {
  const lookupMap = buildPlanningDriverLookup(racePackage, driverLookup);
  const rawFacts = racePackage?.facts || [];
  const normalized = rawFacts.map((f) => normalizeFactDrivers(f, lookupMap));
  const { officialEquivalentFactIds, preferredByCanonical } = buildCanonicalPreferenceIndex(normalized);

  return normalized.map((fact) => {
    const importanceScore = rankFactImportance(fact);
    const quality = assessFactQuality(fact, { officialEquivalentFactIds });
    const tier = planningPriorityTier(fact, quality, importanceScore);
    const isCanonicalPrimary =
      !fact.canonicalFactId || preferredByCanonical.get(fact.canonicalFactId) === fact.id;
    return {
      ...fact,
      importanceScore,
      factQuality: quality,
      planningPriorityTier: tier.priorityTier,
      planningEligible: tier.planningEligible && isCanonicalPrimary,
      criticalEligible: tier.criticalEligible,
      isCanonicalPrimary,
      preferredForPlanning: tier.planningEligible && isCanonicalPrimary,
    };
  });
}

export function planningFactsOnly(preparedFacts) {
  return preparedFacts.filter((f) => f.preferredForPlanning);
}
