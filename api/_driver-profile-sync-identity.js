import { normalizeCustomerId } from './_driver-number-reservations.js';

export const DRIVER_PROFILE_SYNC_VERSION = 'driver-profile-sync-v2';

export function normalizeSyncEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  return email || null;
}

export function normalizeSyncName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveIncomingDriverId(syncInput = {}) {
  const customerId = normalizeCustomerId(syncInput.iracing_customer_id);
  const srhDriverId = String(syncInput.srh_driver_id || syncInput.matched_driver_id || '').trim();
  return srhDriverId || customerId || null;
}

function collectProfileNames(profile = {}) {
  const names = new Set();
  for (const field of [profile.iracing_name, profile.display_name, profile.driver_name]) {
    const normalized = normalizeSyncName(field);
    if (normalized) names.add(normalized);
  }
  return [...names];
}

function profileScoreForNameTiebreak(profile = {}, customerId = null) {
  let score = 0;
  if (profile.active !== false) score += 4;
  if (normalizeCustomerId(profile.iracing_customer_id) === customerId) score += 8;
  if (profile.source_application_id) score += 2;
  if (profile.form_email) score += 1;
  return score;
}

export function pickBestProfileNameMatch(candidates = [], customerId = null) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  return [...candidates].sort((a, b) => {
    const scoreDiff =
      profileScoreForNameTiebreak(b, customerId) - profileScoreForNameTiebreak(a, customerId);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.driver_id).localeCompare(String(b.driver_id));
  })[0];
}

export function buildStandingsDriverIdSet(standingsRows = []) {
  return new Set(
    standingsRows
      .map((row) => String(row.driverId || row.driver_id || '').trim())
      .filter(Boolean)
  );
}

export function buildDriverProfileLookupMaps(profiles = []) {
  const byDriverId = new Map();
  const byIracingCustomerId = new Map();
  const bySourceApplicationId = new Map();
  const byEmail = new Map();
  const byName = new Map();

  for (const profile of profiles) {
    const driverId = String(profile?.driver_id || '').trim();
    if (driverId) byDriverId.set(driverId, profile);

    const customerId = normalizeCustomerId(profile?.iracing_customer_id);
    if (customerId && !byIracingCustomerId.has(customerId)) {
      byIracingCustomerId.set(customerId, profile);
    }

    const applicationId = String(profile?.source_application_id || '').trim();
    if (applicationId && !bySourceApplicationId.has(applicationId)) {
      bySourceApplicationId.set(applicationId, profile);
    }

    const email = normalizeSyncEmail(profile?.form_email);
    if (email && !byEmail.has(email)) byEmail.set(email, profile);

    for (const name of collectProfileNames(profile)) {
      if (!byName.has(name)) byName.set(name, []);
      const bucket = byName.get(name);
      if (!bucket.some((row) => String(row.driver_id) === driverId)) {
        bucket.push(profile);
      }
    }
  }

  return {
    byDriverId,
    byIracingCustomerId,
    bySourceApplicationId,
    byEmail,
    byName,
    all: profiles,
  };
}

export function registerProfileInLookupMaps(maps, profile) {
  if (!maps || !profile) return maps;

  const existingIndex = maps.all.findIndex(
    (row) => String(row.driver_id) === String(profile.driver_id)
  );
  if (existingIndex >= 0) maps.all[existingIndex] = profile;
  else maps.all.push(profile);

  return buildDriverProfileLookupMaps(maps.all);
}

function addProfileCandidate(candidates, profile, matchedBy) {
  if (!profile?.driver_id) return;
  const driverId = String(profile.driver_id);
  if (candidates.some((entry) => String(entry.profile.driver_id) === driverId)) return;
  candidates.push({ profile, matchedBy });
}

export function pickCanonicalProfileMatch(
  candidates = [],
  standingsDriverIds = new Set(),
  customerId = null
) {
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    const aInStandings = standingsDriverIds.has(String(a.profile.driver_id)) ? 1 : 0;
    const bInStandings = standingsDriverIds.has(String(b.profile.driver_id)) ? 1 : 0;
    if (bInStandings !== aInStandings) return bInStandings - aInStandings;

    const aCustomerPk = customerId && String(a.profile.driver_id) === customerId ? 0 : 1;
    const bCustomerPk = customerId && String(b.profile.driver_id) === customerId ? 0 : 1;
    if (bCustomerPk !== aCustomerPk) return bCustomerPk - aCustomerPk;

    const scoreDiff =
      profileScoreForNameTiebreak(b.profile, customerId) -
      profileScoreForNameTiebreak(a.profile, customerId);
    if (scoreDiff !== 0) return scoreDiff;

    return String(a.profile.driver_id).localeCompare(String(b.profile.driver_id));
  })[0];
}

export function resolveExistingProfileFromMaps(syncInput = {}, maps = {}, options = {}) {
  const standingsDriverIds = options.standingsDriverIds || new Set();
  const customerId = normalizeCustomerId(syncInput.iracing_customer_id);
  const applicationId = String(syncInput.id || syncInput.application_id || '').trim();
  const srhDriverId = String(syncInput.srh_driver_id || syncInput.matched_driver_id || '').trim();
  const incomingDriverId = resolveIncomingDriverId(syncInput);
  const email = normalizeSyncEmail(syncInput.email);
  const candidates = [];

  if (incomingDriverId && maps.byDriverId?.has(incomingDriverId)) {
    addProfileCandidate(
      candidates,
      maps.byDriverId.get(incomingDriverId),
      'incoming_driver_id'
    );
  }

  if (srhDriverId && maps.byDriverId?.has(srhDriverId)) {
    addProfileCandidate(candidates, maps.byDriverId.get(srhDriverId), 'srh_driver_id');
  }

  if (customerId && maps.byIracingCustomerId?.has(customerId)) {
    addProfileCandidate(
      candidates,
      maps.byIracingCustomerId.get(customerId),
      'iracing_customer_id'
    );
  }

  if (customerId && maps.byDriverId?.has(customerId)) {
    addProfileCandidate(candidates, maps.byDriverId.get(customerId), 'driver_id');
  }

  if (applicationId && maps.bySourceApplicationId?.has(applicationId)) {
    addProfileCandidate(
      candidates,
      maps.bySourceApplicationId.get(applicationId),
      'source_application_id'
    );
  }

  if (email && maps.byEmail?.has(email)) {
    addProfileCandidate(candidates, maps.byEmail.get(email), 'form_email');
  }

  const nameKeys = [
    normalizeSyncName(syncInput.iracing_display_name),
    normalizeSyncName(syncInput.driver_name),
  ].filter(Boolean);

  for (const name of [...new Set(nameKeys)]) {
    const nameCandidates = maps.byName?.get(name) || [];
    for (const profile of nameCandidates) {
      addProfileCandidate(candidates, profile, 'normalized_name');
    }
  }

  const best = pickCanonicalProfileMatch(candidates, standingsDriverIds, customerId);
  return best || { profile: null, matchedBy: null };
}

function mergeApplicationField(existingValue, incomingValue) {
  const existing = String(existingValue ?? '').trim();
  const incoming = String(incomingValue ?? '').trim();
  return incoming || existing || null;
}

export function enrichSyncInputsWithStandings(syncInputs = [], standingsRows = [], maps = {}) {
  const standingsByName = new Map();
  const standingsByCustomerId = new Map();

  for (const row of standingsRows) {
    const driverId = String(row.driverId || row.driver_id || '').trim();
    const name = normalizeSyncName(row.driverName || row.driver);
    if (name && !standingsByName.has(name)) {
      standingsByName.set(name, row);
    }
    const profile = maps.byDriverId?.get(driverId);
    const customerId = normalizeCustomerId(profile?.iracing_customer_id);
    if (customerId && !standingsByCustomerId.has(customerId)) {
      standingsByCustomerId.set(customerId, row);
    }
  }

  return syncInputs.map((input) => {
    const customerId = normalizeCustomerId(input.iracing_customer_id);
    const name = normalizeSyncName(input.iracing_display_name || input.driver_name);
    const standingsRow =
      (customerId && standingsByCustomerId.get(customerId)) ||
      (name && standingsByName.get(name)) ||
      null;
    const standingsDriverId = standingsRow
      ? String(standingsRow.driverId || standingsRow.driver_id || '').trim()
      : null;

    return {
      ...input,
      srh_driver_id: mergeApplicationField(input.srh_driver_id, standingsDriverId),
      standings_driver_id: standingsDriverId,
      in_current_standings: Boolean(standingsDriverId),
    };
  });
}

export function mergeApprovedSyncInputs(applications = [], srhByApplicationId = new Map()) {
  const merged = new Map();

  for (const application of applications) {
    const customerId = normalizeCustomerId(application?.iracing_customer_id);
    const snapshot = srhByApplicationId.get(String(application?.id || '').trim()) || null;
    const syncInput = {
      ...application,
      srh_driver_id: snapshot?.matched_driver_id || null,
    };

    const key = customerId || `application:${application.id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, syncInput);
      continue;
    }

    merged.set(key, {
      ...existing,
      ...syncInput,
      driver_name: mergeApplicationField(existing.driver_name, syncInput.driver_name),
      iracing_display_name: mergeApplicationField(
        existing.iracing_display_name,
        syncInput.iracing_display_name
      ),
      email: mergeApplicationField(existing.email, syncInput.email),
      discord_name: mergeApplicationField(existing.discord_name, syncInput.discord_name),
      timezone: mergeApplicationField(existing.timezone, syncInput.timezone),
      preferred_number: mergeApplicationField(existing.preferred_number, syncInput.preferred_number),
      srh_driver_id: mergeApplicationField(existing.srh_driver_id, syncInput.srh_driver_id),
      updated_at:
        String(syncInput.updated_at || '') > String(existing.updated_at || '')
          ? syncInput.updated_at
          : existing.updated_at,
    });
  }

  return [...merged.values()].sort((a, b) =>
    String(a.created_at || '').localeCompare(String(b.created_at || ''))
  );
}

export function buildSyncDiagnostics(syncInput = {}, match = {}, operation = 'update') {
  return {
    applicationId: syncInput.id || null,
    applicationDriverName:
      syncInput.iracing_display_name || syncInput.driver_name || null,
    incomingDriverId: resolveIncomingDriverId(syncInput),
    incomingIracingCustomerId: normalizeCustomerId(syncInput.iracing_customer_id) || null,
    matchedSrhDriverId:
      syncInput.srh_driver_id || syncInput.standings_driver_id || null,
    existingProfileDriverId: match.profile?.driver_id || null,
    matchMethod: match.matchedBy || null,
    operation,
  };
}

export function profileMatchesStandingsDriver(profile = {}, standingsDriverIds = new Set()) {
  const driverId = String(profile.driver_id || '').trim();
  return driverId ? standingsDriverIds.has(driverId) : false;
}

export function resolveRosterStatusForProfile(
  profile = {},
  standingsDriverIds = new Set(),
  identityMaps = null,
  syncInput = null
) {
  const active = profile?.active !== false;
  const inStandings = profileMatchesStandingsDriver(profile, standingsDriverIds);

  if (!active) return 'inactive';
  if (inStandings) return 'current';

  if (identityMaps && syncInput) {
    const match = resolveExistingProfileFromMaps(syncInput, identityMaps, {
      standingsDriverIds,
    });
    if (
      match.profile &&
      standingsDriverIds.has(String(match.profile.driver_id)) &&
      String(match.profile.driver_id) !== String(profile.driver_id)
    ) {
      return 'current';
    }
  }

  return 'new_approved';
}

export function shouldHideDuplicateApprovedProfile(
  profile = {},
  standingsDriverIds = new Set(),
  identityMaps = null,
  syncInput = null
) {
  if (
    !profile?.source_application_id &&
    !profile?.approved_application_at
  ) {
    return false;
  }
  if (profileMatchesStandingsDriver(profile, standingsDriverIds)) return false;
  if (!identityMaps || !syncInput) return false;

  const match = resolveExistingProfileFromMaps(syncInput, identityMaps, {
    standingsDriverIds,
  });
  return Boolean(
    match.profile &&
      standingsDriverIds.has(String(match.profile.driver_id)) &&
      String(match.profile.driver_id) !== String(profile.driver_id)
  );
}
