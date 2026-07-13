import { normalizeCustomerId } from './_driver-number-reservations.js';

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

export function resolveExistingProfileFromMaps(syncInput = {}, maps = {}) {
  const customerId = normalizeCustomerId(syncInput.iracing_customer_id);
  const applicationId = String(syncInput.id || syncInput.application_id || '').trim();
  const srhDriverId = String(syncInput.srh_driver_id || syncInput.matched_driver_id || '').trim();
  const email = normalizeSyncEmail(syncInput.email);

  if (customerId && maps.byIracingCustomerId?.has(customerId)) {
    return {
      profile: maps.byIracingCustomerId.get(customerId),
      matchedBy: 'iracing_customer_id',
    };
  }

  if (srhDriverId && maps.byDriverId?.has(srhDriverId)) {
    return { profile: maps.byDriverId.get(srhDriverId), matchedBy: 'srh_driver_id' };
  }

  if (customerId && maps.byDriverId?.has(customerId)) {
    return { profile: maps.byDriverId.get(customerId), matchedBy: 'driver_id' };
  }

  if (applicationId && maps.bySourceApplicationId?.has(applicationId)) {
    return {
      profile: maps.bySourceApplicationId.get(applicationId),
      matchedBy: 'source_application_id',
    };
  }

  if (email && maps.byEmail?.has(email)) {
    return { profile: maps.byEmail.get(email), matchedBy: 'form_email' };
  }

  const nameKeys = [
    normalizeSyncName(syncInput.iracing_display_name),
    normalizeSyncName(syncInput.driver_name),
  ].filter(Boolean);

  for (const name of [...new Set(nameKeys)]) {
    const candidates = maps.byName?.get(name) || [];
    if (!candidates.length) continue;

    const profile = pickBestProfileNameMatch(candidates, customerId);
    if (profile) {
      return { profile, matchedBy: 'normalized_name' };
    }
  }

  return { profile: null, matchedBy: null };
}

function mergeApplicationField(existingValue, incomingValue) {
  const existing = String(existingValue ?? '').trim();
  const incoming = String(incomingValue ?? '').trim();
  return incoming || existing || null;
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
