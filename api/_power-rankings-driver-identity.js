/**
 * Power Rankings driver identity: stored week rows may use SimRacerHub drid while
 * driver_profiles.driver_id is often the iRacing customer ID (identitySplit).
 */
import {
  findDriverProfileByQuery,
  resolveProfileForStandingsRow,
} from './_driver-profile-resolve.js';
import { buildDriverLookup } from './_standings-rows.js';

export function buildPowerRankingsIdentityContext(profiles = [], standingsRows = []) {
  const profileList = Array.isArray(profiles) ? profiles : [];
  const rows = Array.isArray(standingsRows) ? standingsRows : [];

  return {
    profiles: profileList,
    profileById: Object.fromEntries(profileList.map((p) => [String(p.driver_id), p])),
    driverLookup: buildDriverLookup(rows, profileList),
    standingsRows: rows,
  };
}

/**
 * Resolve a stored power_rankings driver_id to profile + display name.
 * Never returns "Unknown Driver"; caller may fall back only when driverName is empty.
 */
export function resolvePowerRankingsDriver(storedDriverId, context = {}) {
  const stored = String(storedDriverId || '').trim();
  if (!stored) {
    return {
      profile: null,
      driverName: '',
      canonicalDriverId: '',
      matchMethod: null,
      srhDriverId: null,
    };
  }

  const profileById = context.profileById || {};
  const profiles = context.profiles || [];
  const driverLookup = context.driverLookup || new Map();
  const standingsRows = context.standingsRows || [];

  const directProfile = profileById[stored];
  if (directProfile) {
    return {
      profile: directProfile,
      driverName: directProfile.display_name || directProfile.iracing_name || '',
      canonicalDriverId: stored,
      matchMethod: 'driver_id',
      srhDriverId: null,
    };
  }

  const standingsRow = driverLookup.get(stored);
  if (standingsRow) {
    const rowName = standingsRow.driverName || standingsRow.driver || '';
    const resolution = resolveProfileForStandingsRow(
      { driverId: stored, driverName: rowName },
      profiles,
    );
    if (resolution.profile) {
      const canonicalDriverId = String(
        resolution.profileDriverId || resolution.profile.driver_id,
      );
      return {
        profile: resolution.profile,
        driverName:
          resolution.profile.display_name ||
          resolution.profile.iracing_name ||
          rowName ||
          '',
        canonicalDriverId,
        matchMethod: resolution.matchMethod || 'standings',
        srhDriverId: resolution.srhDriverId || stored,
      };
    }
    if (rowName) {
      return {
        profile: null,
        driverName: rowName,
        canonicalDriverId: stored,
        matchMethod: 'standings_name_only',
        srhDriverId: stored,
      };
    }
  }

  const byQuery = findDriverProfileByQuery(profiles, stored, { standingsRows });
  if (byQuery.profile) {
    const canonicalDriverId = String(byQuery.profile.driver_id);
    return {
      profile: byQuery.profile,
      driverName: byQuery.profile.display_name || byQuery.profile.iracing_name || '',
      canonicalDriverId,
      matchMethod: byQuery.matchedBy,
      srhDriverId: stored !== canonicalDriverId ? stored : null,
    };
  }

  return {
    profile: null,
    driverName: '',
    canonicalDriverId: stored,
    matchMethod: null,
    srhDriverId: null,
  };
}

export function canonicalizePowerRankingsDriverId(storedDriverId, context) {
  const resolved = resolvePowerRankingsDriver(storedDriverId, context);
  return resolved.canonicalDriverId || String(storedDriverId || '').trim();
}

/** Prefer catalog PK when standings row has identitySplit. */
export function preferredDriverIdFromLookupRow(row) {
  if (!row) return '';
  return String(row.profileDriverId || row.driverId || '').trim();
}

/** Match admin select / Discord export option to a stored id (SRH or profile PK). */
/** Map stored ids and SRH/profile aliases to the same previous rank (movement). */
export function buildPreviousRankByDriver(entries = [], driverLookup = new Map()) {
  const map = {};
  for (const entry of entries) {
    const stored = String(entry.driverId || entry.driver_id || '').trim();
    if (!stored) continue;
    const rank = Number(entry.rank);
    if (!Number.isFinite(rank)) continue;

    map[stored] = rank;

    const row = driverLookup.get(stored);
    if (row) {
      const profileId = String(row.profileDriverId || '').trim();
      const srhId = String(row.driverId || '').trim();
      if (profileId) map[profileId] = rank;
      if (srhId) map[srhId] = rank;
    }
  }
  return map;
}

export function resolveDriverOptionForStoredId(storedId, driverOptions = []) {
  const stored = String(storedId || '').trim();
  if (!stored) return null;

  const options = Array.isArray(driverOptions) ? driverOptions : [];
  const direct = options.find((row) => String(row.driver_id) === stored);
  if (direct) return direct;

  return (
    options.find(
      (row) =>
        String(row.srh_driver_id || row.srhDriverId || '') === stored ||
        String(row.profileDriverId || '') === stored,
    ) || null
  );
}
