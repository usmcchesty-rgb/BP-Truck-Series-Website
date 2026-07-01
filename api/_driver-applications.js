import { supabase } from './_lib.js';
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

function normalizeLookupReason(value) {
  const reason = String(value || '').trim();
  return IRACING_LOOKUP_REASONS.includes(reason) ? reason : 'manual_refresh';
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
      preferred_number: normalizeOptionalText(body.preferred_number ?? body.preferredNumber),
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

  const { data, error } = await sb
    .from('driver_applications')
    .update(update)
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) {
    return { ok: false, status: 500, error: error.message || 'Failed to update application.' };
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
