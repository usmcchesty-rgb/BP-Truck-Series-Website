import { matchDriverIdByName } from './_power-rankings-recent-form.js';

const TRAILING_DIGIT_ARTIFACT = /^(.+?)(\d{1,2})$/;

/**
 * Resolve a raw name against standings/driver lookup.
 * @param {Map|Object} driverLookup - Map from buildDriverLookup or array of { driverId, driverName, carNumber }
 */
export function resolveDriverEntity(rawName, driverLookup, options = {}) {
  const name = String(rawName || '').trim();
  if (!name) {
    return {
      rawName: name,
      matchedDriverId: null,
      canonicalName: null,
      carNumber: null,
      confidence: 'unverified',
      matchMethod: 'empty',
      requiresReview: false,
    };
  }

  let lookup = driverLookup;
  if (Array.isArray(driverLookup)) {
    lookup = new Map(driverLookup.map((d) => [String(d.driverId), d]));
  }

  const directId = matchDriverIdByName(name, lookup);
  if (directId) {
    const row = lookup.get(String(directId)) || lookup.get(directId);
    return {
      rawName: name,
      matchedDriverId: String(directId),
      canonicalName: row?.driverName || name,
      carNumber: row?.carNumber || null,
      confidence: 'official',
      matchMethod: 'exact_or_token',
      requiresReview: false,
    };
  }

  if (options.allowTrailingDigitFix !== false) {
    const artifact = name.match(TRAILING_DIGIT_ARTIFACT);
    if (artifact) {
      const stripped = artifact[1].trim();
      const strippedId = matchDriverIdByName(stripped, lookup);
      if (strippedId) {
        const row = lookup.get(String(strippedId));
        return {
          rawName: name,
          matchedDriverId: String(strippedId),
          canonicalName: row?.driverName || stripped,
          carNumber: row?.carNumber || null,
          confidence: 'derived',
          matchMethod: 'trailing_digit_strip',
          requiresReview: true,
        };
      }
    }
  }

  return {
    rawName: name,
    matchedDriverId: null,
    canonicalName: name,
    carNumber: null,
    confidence: 'unverified',
    matchMethod: 'unresolved',
    requiresReview: true,
  };
}

export function resolveDriverNames(rawNames, driverLookup, options = {}) {
  return (rawNames || []).map((name) => resolveDriverEntity(name, driverLookup, options));
}

export function collectDriverFields(resolutions) {
  const driverIds = [];
  const driverNames = [];
  for (const row of resolutions) {
    if (row.matchedDriverId && !driverIds.includes(row.matchedDriverId)) {
      driverIds.push(row.matchedDriverId);
    }
    const label = row.canonicalName || row.rawName;
    if (label && !driverNames.includes(label)) driverNames.push(label);
  }
  return { driverIds, driverNames };
}
