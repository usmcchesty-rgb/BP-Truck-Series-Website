import { slugify, supabase } from './_lib.js';
import { createSrhCareerSnapshotForApplication } from './_driver-application-srh-career-snapshots.js';

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

function normalizeCustomerId(value) {
  return String(value ?? '').trim().replace(/\D/g, '');
}

function normalizeCarNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^\d{1,2}$/.test(text)) return '';
  if (text === '0') return '';
  return text;
}

function normalizeLookupReason(value) {
  const reason = String(value || '').trim();
  return IRACING_LOOKUP_REASONS.includes(reason) ? reason : 'manual_refresh';
}

async function assertPreferredNumberAvailable(sb, preferredNumber, customerId = '') {
  const carNumber = normalizeCarNumber(preferredNumber);
  if (!preferredNumber) return { ok: true, carNumber: '' };
  if (!carNumber) {
    return {
      ok: false,
      status: 400,
      error: 'Preferred number must be 00 or 1 through 99. Number 0 is reserved for the pace car.',
    };
  }

  let { data, error } = await sb
    .from('driver_profiles')
    .select('driver_id, iracing_customer_id, display_name, iracing_name, car_number, active')
    .eq('car_number', carNumber)
    .neq('active', false)
    .limit(1)
    .maybeSingle();

  if (error && (error.code === '42703' || /iracing_customer_id/i.test(error.message || ''))) {
    const fallback = await sb
      .from('driver_profiles')
      .select('driver_id, display_name, iracing_name, car_number, active')
      .eq('car_number', carNumber)
      .neq('active', false)
      .limit(1)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
      return { ok: true, carNumber };
    }
    return { ok: false, status: 500, error: error.message || 'Failed to check number availability.' };
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (
    data &&
    (!normalizedCustomerId ||
      (normalizeCustomerId(data.iracing_customer_id) !== normalizedCustomerId &&
        String(data.driver_id || '') !== normalizedCustomerId))
  ) {
    const name = data.display_name || data.iracing_name || 'another driver';
    return {
      ok: false,
      status: 409,
      error: `Number ${carNumber} is already taken by ${name}. Please choose another number.`,
    };
  }

  return { ok: true, carNumber };
}

async function promoteApprovedApplicationToDriverProfile(sb, application) {
  const customerId = normalizeCustomerId(application?.iracing_customer_id);
  if (!customerId) {
    return { ok: false, status: 400, error: 'Approved application is missing an iRacing Customer ID.' };
  }

  const displayName = String(
    application.iracing_display_name || application.driver_name || `Driver ${customerId}`
  ).trim();
  const numberCheck = await assertPreferredNumberAvailable(
    sb,
    application.preferred_number,
    customerId
  );
  if (!numberCheck.ok) return numberCheck;

  const now = new Date().toISOString();
  const row = {
    driver_id: customerId,
    iracing_customer_id: customerId,
    iracing_name: displayName,
    display_name: displayName,
    driver_name: displayName,
    slug: slugify(displayName || customerId),
    car_number: numberCheck.carNumber,
    truck_number: numberCheck.carNumber,
    active: true,
    form_email: normalizeOptionalText(application.email),
    form_submitted_at: application.created_at || null,
    source_application_id: application.id,
    approved_application_at: now,
    updated_at: now,
  };

  const { data, error } = await sb
    .from('driver_profiles')
    .upsert(row, { onConflict: 'driver_id' })
    .select('*')
    .single();

  if (error) {
    return {
      ok: false,
      status: 500,
      error: error.message || 'Application approved, but driver profile creation failed.',
    };
  }

  return { ok: true, driverProfile: data };
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
  const preferredNumber = normalizeOptionalText(body.preferred_number ?? body.preferredNumber);
  if (preferredNumber && !normalizeCarNumber(preferredNumber)) {
    errors.push('Preferred number must be 00 or 1 through 99. Number 0 is reserved for the pace car.');
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    row: {
      driver_name: applicantName || null,
      iracing_display_name: iracingDisplayName,
      iracing_customer_id: iracingCustomerId,
      discord_name: normalizeOptionalText(body.discord_name ?? body.discordName),
      email: normalizeOptionalText(body.email),
      age_confirmed: true,
      timezone: normalizeOptionalText(body.timezone ?? body.timeZone),
      preferred_number: preferredNumber ? normalizeCarNumber(preferredNumber) : null,
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

  const numberCheck = await assertPreferredNumberAvailable(
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

  if (update.status === 'approved') {
    const existing = await getDriverApplicationById(applicationId);
    if (!existing) {
      return { ok: false, status: 404, error: 'Application not found.' };
    }
    const numberCheck = await assertPreferredNumberAvailable(
      sb,
      existing.preferred_number,
      existing.iracing_customer_id
    );
    if (!numberCheck.ok) return numberCheck;
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

  if (data.status === 'approved') {
    const promoteResult = await promoteApprovedApplicationToDriverProfile(sb, data);
    if (!promoteResult.ok) return promoteResult;
    return {
      ok: true,
      status: 200,
      application: data,
      driver_profile: promoteResult.driverProfile,
    };
  }

  return { ok: true, status: 200, application: data };
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
