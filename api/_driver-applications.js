import { slugify, supabase, getSettings } from './_lib.js';
import { createSrhCareerSnapshotForApplication } from './_driver-application-srh-career-snapshots.js';
import {
  buildDriverProfileLookupMaps,
  buildStandingsDriverIdSet,
  buildSyncDiagnostics,
  DRIVER_PROFILE_SYNC_VERSION,
  enrichSyncInputsWithStandings,
  mergeApprovedSyncInputs,
  registerProfileInLookupMaps,
  resolveExistingProfileFromMaps,
  resolveIncomingDriverId,
} from './_driver-profile-sync-identity.js';
import { fetchStandingsRows } from './_standings-rows.js';
import {
  ANY_PREFERRED_NUMBER,
  assertNumberAvailableForApplication,
  assignReservationForApplication,
  createPendingReservation,
  getReservationForApplication,
  isAnyPreferredNumber,
  normalizeCarNumber,
  normalizeCustomerId,
  releaseReservationForApplication,
  syncReservationForApplicationStatus,
} from './_driver-number-reservations.js';

export const OPEN_APPLICATION_STATUSES = [
  'pending',
  'reviewing',
  'recruiting_race',
  'waitlist',
];

export const APPLICATION_STATUSES = [
  'pending',
  'reviewing',
  'approved',
  'rejected',
  'waitlist',
  'recruiting_race',
];

export const IRACING_LOOKUP_ACTIVE_STATUSES = ['queued', 'processing', 'needs_login'];

export const IRACING_LOOKUP_REASONS = [
  'application_submitted',
  'manual_refresh',
  'scheduled_refresh',
  'retry_failed',
];

function normalizeOptionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeLookupReason(value) {
  const reason = String(value || '').trim();
  return IRACING_LOOKUP_REASONS.includes(reason) ? reason : 'manual_refresh';
}

function normalizeExactDisplayName(value) {
  return String(value ?? '').trim();
}

async function loadAllDriverProfiles(sb) {
  const { data, error } = await sb.from('driver_profiles').select('*');
  if (error) throw new Error(error.message || 'Failed to load driver profiles.');
  return data || [];
}

async function loadLatestSrhSnapshotsByApplicationId(sb, applicationIds = []) {
  const ids = [...new Set(applicationIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await sb
    .from('driver_application_srh_career_snapshots')
    .select('application_id, matched_driver_id, matched_driver_name, created_at')
    .in('application_id', ids)
    .order('created_at', { ascending: false });

  if (error) {
    const message = String(error.message || '');
    const missingTable = error.code === '42P01' || /does not exist/i.test(message);
    if (missingTable) return new Map();
    throw new Error(error.message || 'Failed to load SRH career snapshots.');
  }

  const byApplicationId = new Map();
  for (const row of data || []) {
    const applicationId = String(row.application_id || '').trim();
    if (!applicationId || byApplicationId.has(applicationId)) continue;
    byApplicationId.set(applicationId, row);
  }

  return byApplicationId;
}

async function findExistingDriverProfileForApplication(sb, application, options = {}) {
  const standingsDriverIds = options.standingsDriverIds || new Set();
  if (options.profileMaps) {
    return resolveExistingProfileFromMaps(application, options.profileMaps, {
      standingsDriverIds,
    });
  }

  const maps = buildDriverProfileLookupMaps(await loadAllDriverProfiles(sb));
  return resolveExistingProfileFromMaps(application, maps, { standingsDriverIds });
}

function buildSyncLogEntry(application, match, result, diagnostics = null) {
  const customerId = normalizeCustomerId(application?.iracing_customer_id);
  return {
    application:
      normalizeExactDisplayName(application?.iracing_display_name) ||
      normalizeOptionalText(application?.driver_name) ||
      String(application?.id || ''),
    application_id: application?.id || null,
    customer_id: customerId || null,
    matched_existing_profile: match.profile
      ? `${match.profile.driver_id}${match.matchedBy ? ` (${match.matchedBy})` : ''}`
      : 'No',
    action: result.action,
    reason: result.reason || '',
    driver_id: result.driverProfile?.driver_id || match.profile?.driver_id || null,
    error: result.error || null,
    diagnostics: diagnostics || result.diagnostics || null,
    recovery: result.recovery || null,
    merged_fields: result.mergedFields || null,
  };
}

function mergePatchWithoutBlankOverwrite(existing = {}, patch = {}) {
  const merged = { ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') {
      if (existing[key] != null && existing[key] !== '') {
        delete merged[key];
      }
      continue;
    }
    if (key === 'slug' && existing.slug) {
      delete merged[key];
    }
  }
  return merged;
}

async function resolveApprovedCarNumber(sb, application) {
  const reservation = await getReservationForApplication(sb, application?.id);
  const reservationStatus = String(reservation?.status || '').trim().toLowerCase();
  if (reservation && ['assigned', 'pending', 'reserved'].includes(reservationStatus)) {
    const fromReservation = normalizeCarNumber(reservation.number);
    if (fromReservation) return fromReservation;
  }

  if (isAnyPreferredNumber(application?.preferred_number)) return '';
  return normalizeCarNumber(application?.preferred_number);
}

function buildApplicationDriverProfilePatch(application, carNumber, now, existing = null) {
  const customerId = normalizeCustomerId(application?.iracing_customer_id);
  const displayName = String(
    application.iracing_display_name || application.driver_name || `Driver ${customerId}`
  ).trim();

  const patch = {
    iracing_name: displayName,
    display_name: displayName,
    driver_name: displayName,
    slug: slugify(displayName || customerId),
    active: true,
    form_submitted_at: application.created_at || null,
    source_application_id: application.id,
    approved_application_at: now,
    updated_at: now,
  };

  const applicationEmail = normalizeOptionalText(application.email);
  if (applicationEmail) {
    patch.form_email = applicationEmail;
  }

  if (customerId) patch.iracing_customer_id = customerId;

  const discordName = normalizeOptionalText(application.discord_name);
  if (discordName) patch.discord_name = discordName;

  const timezone = normalizeOptionalText(application.timezone);
  if (timezone) patch.timezone = timezone;

  if (carNumber) {
    patch.car_number = carNumber;
    patch.truck_number = carNumber;
  }

  return existing ? mergePatchWithoutBlankOverwrite(existing, patch) : patch;
}

async function fetchProfileByDriverId(sb, driverId, maps = null) {
  const normalizedId = String(driverId || '').trim();
  if (!normalizedId) return null;
  if (maps?.byDriverId?.has(normalizedId)) {
    return maps.byDriverId.get(normalizedId);
  }
  const { data, error } = await sb
    .from('driver_profiles')
    .select('*')
    .eq('driver_id', normalizedId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Failed to load driver profile.');
  return data || null;
}

async function updateExistingDriverProfileFromApplication(
  sb,
  existing,
  application,
  carNumber,
  now,
  options = {}
) {
  const patch = buildApplicationDriverProfilePatch(application, carNumber, now, existing);
  const diagnostics = buildSyncDiagnostics(application, {
    profile: existing,
    matchedBy: options.matchMethod || 'update',
  }, 'update');

  const { data, error } = await sb
    .from('driver_profiles')
    .update(patch)
    .eq('driver_id', existing.driver_id)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        action: 'Conflict',
        reason: 'Cannot link this iRacing Customer ID — it is already assigned to another driver profile.',
        status: 409,
        error:
          'Cannot link this iRacing Customer ID — it is already assigned to another driver profile.',
        diagnostics,
        recovery: {
          constraint: error.constraint || 'unknown',
          attemptedDriverId: existing.driver_id,
          existingProfileDriverId: existing.driver_id,
          applicationId: application.id || null,
          matchMethod: options.matchMethod || null,
        },
      };
    }
    return {
      ok: false,
      action: 'Error',
      reason: error.message || 'Driver profile update failed.',
      status: 500,
      error: error.message || 'Application approved, but driver profile update failed.',
      diagnostics,
    };
  }

  return {
    ok: true,
    action: options.recovered ? 'RecoveredUpdate' : 'Updated',
    reason: options.recovered
      ? 'Recovered from duplicate primary-key collision and updated existing profile.'
      : 'Matched existing driver profile and updated application fields.',
    driverProfile: data,
    driverProfileAction: 'updated',
    message: options.recovered ? 'Recovered duplicate collision' : 'Existing driver updated',
    diagnostics,
    mergedFields: Object.keys(patch).filter((key) => key !== 'updated_at'),
    recovery: options.recovery || null,
  };
}

async function createDriverProfileFromApplication(sb, application, carNumber, now, options = {}) {
  const customerId = normalizeCustomerId(application?.iracing_customer_id);
  const attemptedDriverId = resolveIncomingDriverId(application);
  const displayName = String(
    application.iracing_display_name || application.driver_name || `Driver ${customerId}`
  ).trim();
  const profileMaps = options.profileMaps || null;
  const standingsDriverIds = options.standingsDriverIds || new Set();

  let match =
    options.precomputedMatch ||
    resolveExistingProfileFromMaps(application, profileMaps || buildDriverProfileLookupMaps([]), {
      standingsDriverIds,
    });

  if (!match.profile && attemptedDriverId && profileMaps?.byDriverId?.has(attemptedDriverId)) {
    match = {
      profile: profileMaps.byDriverId.get(attemptedDriverId),
      matchedBy: 'incoming_driver_id_precheck',
    };
  }

  const diagnostics = buildSyncDiagnostics(application, match, 'insert');

  if (match.profile) {
    return updateExistingDriverProfileFromApplication(
      sb,
      match.profile,
      application,
      carNumber,
      now,
      { matchMethod: match.matchedBy }
    );
  }

  const row = {
    driver_id: attemptedDriverId,
    iracing_name: displayName,
    ...buildApplicationDriverProfilePatch(application, carNumber, now),
  };

  const { data, error } = await sb.from('driver_profiles').insert(row).select('*').single();

  if (error) {
    if (error.code === '23505') {
      const recoveredProfile =
        (attemptedDriverId && (await fetchProfileByDriverId(sb, attemptedDriverId, profileMaps))) ||
        (
          await findExistingDriverProfileForApplication(sb, application, {
            profileMaps,
            standingsDriverIds,
          })
        ).profile;

      if (recoveredProfile) {
        return updateExistingDriverProfileFromApplication(
          sb,
          recoveredProfile,
          application,
          carNumber,
          now,
          {
            recovered: true,
            matchMethod: 'pkey_recovery',
            recovery: {
              constraint: error.constraint || 'driver_profiles_pkey',
              attemptedDriverId,
              existingProfileDriverId: recoveredProfile.driver_id,
              applicationId: application.id || null,
              matchMethod: 'pkey_recovery',
            },
          }
        );
      }

      return {
        ok: false,
        action: 'Conflict',
        reason: 'Driver profile already exists for this identity.',
        status: 409,
        error: 'Driver profile already exists for this identity.',
        diagnostics,
        recovery: {
          constraint: error.constraint || 'driver_profiles_pkey',
          attemptedDriverId,
          existingProfileDriverId: null,
          applicationId: application.id || null,
          matchMethod: null,
        },
      };
    }
    return {
      ok: false,
      action: 'Error',
      reason: error.message || 'Driver profile creation failed.',
      status: 500,
      error: error.message || 'Application approved, but driver profile creation failed.',
      diagnostics,
    };
  }

  return {
    ok: true,
    action: 'Created',
    reason: 'No existing driver profile found; created a new profile.',
    driverProfile: data,
    driverProfileAction: 'created',
    message: 'Driver created',
    diagnostics,
  };
}

export async function syncApplicationToDriverProfile(sb, application, options = {}) {
  const customerId = normalizeCustomerId(application?.iracing_customer_id);
  const enforceNumberCheck = options.enforceNumberCheck !== false;

  if (!customerId) {
    return {
      ok: false,
      action: 'Skipped',
      reason: 'Missing iRacing Customer ID.',
      status: 400,
      error: 'Approved application is missing an iRacing Customer ID.',
    };
  }

  const carNumber = await resolveApprovedCarNumber(sb, application);
  if (carNumber && enforceNumberCheck) {
    const numberCheck = await assertNumberAvailableForApplication(
      sb,
      carNumber,
      customerId,
      application.id
    );
    if (!numberCheck.ok) {
      return {
        ok: false,
        action: 'Error',
        reason: numberCheck.error || 'Number is not available.',
        status: numberCheck.status || 409,
        error: numberCheck.error,
      };
    }
  }

  const now = new Date().toISOString();
  const standingsDriverIds = options.standingsDriverIds || new Set();
  const match =
    options.precomputedMatch ||
    (await findExistingDriverProfileForApplication(sb, application, options));
  const diagnostics = buildSyncDiagnostics(
    application,
    match,
    match.profile ? 'update' : 'insert'
  );

  if (match.profile) {
    const updateResult = await updateExistingDriverProfileFromApplication(
      sb,
      match.profile,
      application,
      carNumber,
      now,
      { matchMethod: match.matchedBy }
    );
    return { ...updateResult, diagnostics: updateResult.diagnostics || diagnostics };
  }

  return createDriverProfileFromApplication(sb, application, carNumber, now, {
    ...options,
    standingsDriverIds,
    precomputedMatch: match,
  });
}

async function promoteApprovedApplicationToDriverProfile(sb, application, options = {}) {
  return syncApplicationToDriverProfile(sb, application, options);
}

export async function syncApprovedApplicationsToDriverProfiles() {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const { data, error } = await sb
    .from('driver_applications')
    .select('*')
    .eq('status', 'approved')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message || 'Failed to load approved applications.');

  const applications = data || [];
  let profileMaps = buildDriverProfileLookupMaps(await loadAllDriverProfiles(sb));

  let standingsRows = [];
  try {
    const settings = await getSettings();
    const standingsResult = await fetchStandingsRows(settings);
    standingsRows = standingsResult?.rows || [];
  } catch {
    standingsRows = [];
  }

  const standingsDriverIds = buildStandingsDriverIdSet(standingsRows);
  const srhByApplicationId = await loadLatestSrhSnapshotsByApplicationId(
    sb,
    applications.map((application) => application.id)
  );
  const mergedApplications = mergeApprovedSyncInputs(applications, srhByApplicationId);
  const syncQueue = enrichSyncInputsWithStandings(mergedApplications, standingsRows, profileMaps);

  const summary = {
    added: 0,
    updatedExistingCurrentProfiles: 0,
    alreadyCurrent: 0,
    recoveredDuplicateCollisions: 0,
    conflicts: 0,
    skipped: 0,
    errors: 0,
  };
  const results = [];

  for (const application of syncQueue) {
    const match = resolveExistingProfileFromMaps(application, profileMaps, {
      standingsDriverIds,
    });
    const diagnostics = buildSyncDiagnostics(
      application,
      match,
      match.profile ? 'update' : 'insert'
    );

    const syncResult = await syncApplicationToDriverProfile(sb, application, {
      enforceNumberCheck: false,
      profileMaps,
      precomputedMatch: match,
      standingsDriverIds,
    });
    const logEntry = buildSyncLogEntry(application, match, syncResult, diagnostics);
    results.push(logEntry);

    if (syncResult.ok && syncResult.driverProfile) {
      profileMaps = registerProfileInLookupMaps(profileMaps, syncResult.driverProfile);
    }

    const action = String(syncResult.action || '');
    if (!syncResult.ok) {
      if (action === 'Conflict') summary.conflicts += 1;
      else summary.errors += 1;
    } else if (action === 'Created') {
      summary.added += 1;
    } else if (action === 'RecoveredUpdate') {
      summary.recoveredDuplicateCollisions += 1;
      summary.updatedExistingCurrentProfiles += 1;
    } else if (action === 'Updated') {
      const profileId = String(syncResult.driverProfile?.driver_id || match.profile?.driver_id || '');
      if (standingsDriverIds.has(profileId)) {
        summary.updatedExistingCurrentProfiles += 1;
      } else if (match.profile?.source_application_id) {
        summary.alreadyCurrent += 1;
      } else {
        summary.updatedExistingCurrentProfiles += 1;
      }
    } else if (action === 'Skipped') {
      summary.skipped += 1;
    } else {
      summary.errors += 1;
    }
  }

  return {
    ok: summary.errors === 0 && summary.conflicts === 0,
    syncVersion: DRIVER_PROFILE_SYNC_VERSION,
    summary,
    results,
    total: syncQueue.length,
    sourceApplications: applications.length,
    standingsDrivers: standingsRows.length,
  };
}

function isValidApplicationEmail(value) {
  const email = normalizeOptionalText(value);
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateApplicationPayload(body = {}) {
  const errors = [];
  const applicantName = String(body.driver_name ?? body.driverName ?? '').trim();
  const iracingDisplayName = String(
    body.iracing_display_name ?? body.iracingDisplayName ?? ''
  ).trim();
  const iracingCustomerId = normalizeCustomerId(body.iracing_customer_id ?? body.iracingCustomerId);
  const ageConfirmed =
    body.age_confirmed === true ||
    body.ageConfirmed === true ||
    body.age_confirmed === 'true' ||
    body.ageConfirmed === 'true' ||
    body.age_confirmed === 1 ||
    body.ageConfirmed === 1;

  if (!iracingDisplayName) errors.push('iRacing Display Name is required.');
  if (!iracingCustomerId) errors.push('iRacing Customer ID is required.');
  else if (!/^\d+$/.test(iracingCustomerId)) {
    errors.push('iRacing Customer ID must contain numbers only.');
  }
  if (!ageConfirmed) errors.push('Age confirmation is required.');
  const email = normalizeOptionalText(body.email);
  if (!isValidApplicationEmail(email)) {
    errors.push('Please enter a valid email address.');
  }
  const preferredNumberRaw = normalizeOptionalText(body.preferred_number ?? body.preferredNumber);
  if (!preferredNumberRaw) {
    errors.push('Preferred number is required.');
  } else if (!isAnyPreferredNumber(preferredNumberRaw) && !normalizeCarNumber(preferredNumberRaw)) {
    errors.push('Preferred number must be 00 or 1 through 99. Number 0 is reserved for the pace car.');
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  const preferredNumberStored = isAnyPreferredNumber(preferredNumberRaw)
    ? ANY_PREFERRED_NUMBER
    : normalizeCarNumber(preferredNumberRaw);

  return {
    ok: true,
    row: {
      driver_name: applicantName || null,
      iracing_display_name: iracingDisplayName,
      iracing_customer_id: iracingCustomerId,
      discord_name: normalizeOptionalText(body.discord_name ?? body.discordName),
      email,
      age_confirmed: true,
      timezone: normalizeOptionalText(body.timezone ?? body.timeZone),
      preferred_number: preferredNumberStored,
      racing_background: normalizeOptionalText(body.racing_background ?? body.racingBackground),
      why_join: normalizeOptionalText(body.why_join ?? body.whyJoin),
      referred_by: normalizeOptionalText(body.referred_by ?? body.referredBy),
      status: 'pending',
    },
  };
}

export async function findOpenApplicationByCustomerId(customerId) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const normalizedId = normalizeCustomerId(customerId);
  if (!normalizedId) return null;

  const { data, error } = await sb
    .from('driver_applications')
    .select('*')
    .eq('iracing_customer_id', normalizedId)
    .in('status', OPEN_APPLICATION_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function submitDriverApplication(body) {
  const validation = validateApplicationPayload(body);
  if (!validation.ok) {
    return { ok: false, status: 400, error: validation.errors.join(' ') };
  }

  const sb = supabase();
  if (!sb) {
    return { ok: false, status: 503, error: 'Application system is not configured yet.' };
  }

  const existing = await findOpenApplicationByCustomerId(validation.row.iracing_customer_id);
  if (existing) {
    return {
      ok: false,
      status: 409,
      error:
        'An application for this iRacing Customer ID is already on file and under review. Please contact league staff if you need to update your submission.',
    };
  }

  const numberCheck = isAnyPreferredNumber(validation.row.preferred_number)
    ? { ok: true }
    : await assertNumberAvailableForApplication(
        sb,
        validation.row.preferred_number,
        validation.row.iracing_customer_id
      );
  if (!numberCheck.ok) return numberCheck;

  const { data, error } = await sb
    .from('driver_applications')
    .insert(validation.row)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        status: 409,
        error:
          'An application for this iRacing Customer ID is already on file and under review. Please contact league staff if you need to update your submission.',
      };
    }
    return { ok: false, status: 500, error: error.message || 'Failed to save application.' };
  }

  if (validation.row.preferred_number && !isAnyPreferredNumber(validation.row.preferred_number)) {
    const reservationResult = await createPendingReservation(sb, {
      number: validation.row.preferred_number,
      applicationId: data.id,
      iracingCustomerId: validation.row.iracing_customer_id,
      note: 'application_submitted',
    });
    if (!reservationResult.ok) {
      await sb.from('driver_applications').delete().eq('id', data.id);
      return reservationResult;
    }
  }

  let srh_career_snapshot = null;
  let srh_career_snapshot_error = null;
  try {
    const srhResult = await createSrhCareerSnapshotForApplication(data);
    srh_career_snapshot = srhResult.snapshot || null;
  } catch (snapshotError) {
    srh_career_snapshot_error =
      snapshotError?.message || 'Application saved, but SRH career lookup failed.';
  }

  return {
    ok: true,
    status: 201,
    application: data,
    srh_career_snapshot,
    srh_career_snapshot_error,
  };
}

export async function listDriverApplications() {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const { data, error } = await sb
    .from('driver_applications')
    .select(
      'id, created_at, updated_at, status, driver_name, iracing_display_name, iracing_customer_id, discord_name, email, age_confirmed, timezone, preferred_number, racing_background, why_join, referred_by, admin_notes'
    )
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

export async function getLatestIracingLookupJobForApplication(id) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const applicationId = String(id || '').trim();
  if (!applicationId) return null;

  const { data, error } = await sb
    .from('iracing_lookup_jobs')
    .select('id, created_at, updated_at, application_id, customer_id, status, reason, attempts, worker_name, started_at, completed_at, error')
    .eq('application_id', applicationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function getDriverApplicationById(id) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const applicationId = String(id || '').trim();
  if (!applicationId) return null;

  const { data, error } = await sb
    .from('driver_applications')
    .select('*')
    .eq('id', applicationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateDriverApplication(id, patch = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const applicationId = String(id || '').trim();
  if (!applicationId) {
    return { ok: false, status: 400, error: 'Application id is required.' };
  }

  const update = {};
  if (patch.status !== undefined) {
    const status = String(patch.status || '').trim().toLowerCase();
    if (!APPLICATION_STATUSES.includes(status)) {
      return { ok: false, status: 400, error: 'Invalid application status.' };
    }
    update.status = status;
  }
  if (patch.admin_notes !== undefined || patch.adminNotes !== undefined) {
    update.admin_notes = normalizeOptionalText(patch.admin_notes ?? patch.adminNotes);
  }

  if (!Object.keys(update).length) {
    return { ok: false, status: 400, error: 'No valid fields to update.' };
  }

  const existing = await getDriverApplicationById(applicationId);
  if (!existing) {
    return { ok: false, status: 404, error: 'Application not found.' };
  }

  const wasApproved = String(existing.status || '').trim().toLowerCase() === 'approved';
  const transitioningToApproved =
    update.status === 'approved' && !wasApproved;

  if (transitioningToApproved) {
    const approvedCarNumber = await resolveApprovedCarNumber(sb, existing);
    if (approvedCarNumber) {
      const numberCheck = await assertNumberAvailableForApplication(
        sb,
        approvedCarNumber,
        existing.iracing_customer_id,
        existing.id
      );
      if (!numberCheck.ok) return numberCheck;
    }
  }

  const { data, error } = await sb
    .from('driver_applications')
    .update(update)
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) {
    return { ok: false, status: 500, error: error.message || 'Failed to update application.' };
  }

  const reservationSync = await syncReservationForApplicationStatus(sb, data, existing.status);
  if (!reservationSync.ok) return reservationSync;

  const isApproved = String(data.status || '').trim().toLowerCase() === 'approved';
  if (isApproved) {
    const match = await findExistingDriverProfileForApplication(sb, data);
    const promoteResult = await promoteApprovedApplicationToDriverProfile(sb, data, {
      enforceNumberCheck: transitioningToApproved,
    });
    if (!promoteResult.ok) {
      if (transitioningToApproved) {
        await releaseReservationForApplication(sb, data.id, 'approval_rollback');
      }
      return {
        ok: false,
        status: promoteResult.status || 400,
        error: promoteResult.error,
        sync_log: buildSyncLogEntry(data, match, promoteResult),
      };
    }

    let assignResult = { ok: true, reservation: null };
    if (transitioningToApproved) {
      assignResult = await assignReservationForApplication(
        sb,
        data,
        normalizeCustomerId(data.iracing_customer_id)
      );
      if (!assignResult.ok) return assignResult;
    }

    return {
      ok: true,
      status: 200,
      application: data,
      driver_profile: promoteResult.driverProfile,
      driver_profile_action: promoteResult.driverProfileAction || null,
      message: promoteResult.message || null,
      sync_log: buildSyncLogEntry(data, match, promoteResult),
      number_reservation: assignResult.reservation || null,
    };
  }

  const numberReservation = await getReservationForApplication(sb, data.id);
  return {
    ok: true,
    status: 200,
    application: data,
    number_reservation: numberReservation,
  };
}

export async function enqueueIracingLookupJob(applicationId, customerId, reason = 'manual_refresh') {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const normalizedApplicationId = String(applicationId || '').trim();
  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!normalizedApplicationId) {
    return { ok: false, status: 400, error: 'Application id is required.' };
  }
  if (!normalizedCustomerId) {
    return { ok: false, status: 400, error: 'iRacing Customer ID is required.' };
  }

  const lookupReason = normalizeLookupReason(reason);

  const { data: activeJob, error: activeError } = await sb
    .from('iracing_lookup_jobs')
    .select('id, status, created_at, updated_at')
    .eq('application_id', normalizedApplicationId)
    .in('status', IRACING_LOOKUP_ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) {
    return { ok: false, status: 500, error: activeError.message || 'Failed to check active lookup jobs.' };
  }

  if (activeJob) {
    return {
      ok: false,
      status: 409,
      error: 'Lookup already queued or processing.',
      job: activeJob,
    };
  }

  const { data: job, error } = await sb
    .from('iracing_lookup_jobs')
    .insert({
      application_id: normalizedApplicationId,
      customer_id: normalizedCustomerId,
      status: 'queued',
      reason: lookupReason,
    })
    .select('id, created_at, updated_at, application_id, customer_id, status, reason, attempts, worker_name, started_at, completed_at, error')
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        status: 409,
        error: 'Lookup already queued or processing.',
      };
    }
    return { ok: false, status: 500, error: error.message || 'Failed to enqueue lookup job.' };
  }

  return { ok: true, status: 201, job };
}

export async function deleteDriverApplication(id) {
  const sb = supabase();
  if (!sb) return { ok: false, status: 503, error: 'Supabase not configured yet.' };

  const applicationId = String(id || '').trim();
  if (!applicationId) {
    return { ok: false, status: 400, error: 'Application id is required.' };
  }

  const application = await getDriverApplicationById(applicationId);
  if (!application) {
    return { ok: false, status: 404, error: 'Application not found.' };
  }

  const releaseResult = await releaseReservationForApplication(
    sb,
    applicationId,
    'application_deleted'
  );
  if (!releaseResult.ok) {
    return releaseResult;
  }

  const { error: reservationError } = await sb
    .from('driver_number_reservations')
    .delete()
    .eq('application_id', applicationId);

  if (reservationError) {
    const message = String(reservationError.message || '');
    const missingTable =
      reservationError.code === '42P01' || /does not exist/i.test(message);
    if (!missingTable) {
      return {
        ok: false,
        status: 500,
        error: reservationError.message || 'Failed to clean up number reservation.',
      };
    }
  }

  const { error } = await sb.from('driver_applications').delete().eq('id', applicationId);
  if (error) {
    return {
      ok: false,
      status: 500,
      error: error.message || 'Failed to delete application.',
    };
  }

  return { ok: true, deletedId: applicationId };
}
