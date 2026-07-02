import { getDriverProfiles } from './_lib.js';

export const ACTIVE_RESERVATION_STATUSES = ['pending', 'assigned', 'reserved'];
export const RESERVATION_STATUSES = ['available', 'pending', 'assigned', 'reserved', 'released'];

export const ANY_PREFERRED_NUMBER = 'ANY';

export function isAnyPreferredNumber(value) {
  return String(value ?? '').trim().toUpperCase() === ANY_PREFERRED_NUMBER;
}

export function normalizeCarNumber(value) {
  if (isAnyPreferredNumber(value)) return '';
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^\d{1,2}$/.test(text)) return '';
  if (text === '0') return '';
  return text;
}

export function normalizeCustomerId(value) {
  return String(value ?? '').trim().replace(/\D/g, '');
}

export function buildAllowedNumbers() {
  return ['00', ...Array.from({ length: 99 }, (_, index) => String(index + 1))];
}

function isMissingTableError(error) {
  const message = String(error?.message || '');
  return error?.code === '42P01' || /does not exist/i.test(message);
}

export async function listActiveReservations(sb) {
  const { data, error } = await sb
    .from('driver_number_reservations')
    .select('*')
    .in('status', ACTIVE_RESERVATION_STATUSES)
    .order('updated_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw new Error(error.message || 'Failed to load number reservations.');
  }

  return data || [];
}

export async function getReservationForApplication(sb, applicationId) {
  const normalizedId = String(applicationId || '').trim();
  if (!normalizedId) return null;

  const { data, error } = await sb
    .from('driver_number_reservations')
    .select('*')
    .eq('application_id', normalizedId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) return null;
    throw new Error(error.message || 'Failed to load number reservation.');
  }

  return data;
}

export function buildNumberStatusSummary(profiles = [], reservations = []) {
  const allowed = buildAllowedNumbers();
  const statusByNumber = Object.fromEntries(allowed.map((number) => [number, 'available']));

  for (const profile of profiles) {
    if (profile?.active === false) continue;
    const number = normalizeCarNumber(profile.car_number || profile.truck_number);
    if (number) statusByNumber[number] = 'assigned';
  }

  for (const reservation of reservations) {
    const number = normalizeCarNumber(reservation?.number);
    if (!number || !Object.prototype.hasOwnProperty.call(statusByNumber, number)) continue;
    const status = String(reservation.status || '').trim().toLowerCase();
    if (status === 'pending') {
      if (statusByNumber[number] === 'available') statusByNumber[number] = 'pending';
    } else if (status === 'reserved') {
      statusByNumber[number] = 'reserved';
    } else if (status === 'assigned') {
      statusByNumber[number] = 'assigned';
    }
  }

  const numbers = allowed.map((number) => ({ number, status: statusByNumber[number] }));

  return {
    numbers,
    statuses: statusByNumber,
    available: allowed.filter((number) => statusByNumber[number] === 'available'),
    pending: allowed.filter((number) => statusByNumber[number] === 'pending'),
    assigned: allowed.filter((number) => statusByNumber[number] === 'assigned'),
    reserved: allowed.filter((number) => statusByNumber[number] === 'reserved'),
    taken: allowed.filter((number) => statusByNumber[number] !== 'available'),
  };
}

export async function buildAvailableNumberSummaryFromDb(sb) {
  const profiles = await getDriverProfiles();
  let reservations = [];
  try {
    reservations = await listActiveReservations(sb);
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }
  return buildNumberStatusSummary(profiles, reservations);
}

function reservationConflictMessage(number, status) {
  const label = status === 'pending' ? 'pending review' : status;
  return `Number ${number} is ${label}. Please choose another number.`;
}

export async function assertNumberAvailableForApplication(
  sb,
  preferredNumber,
  customerId = '',
  applicationId = ''
) {
  if (isAnyPreferredNumber(preferredNumber)) return { ok: true, carNumber: '' };
  const carNumber = normalizeCarNumber(preferredNumber);
  if (!preferredNumber) return { ok: true, carNumber: '' };
  if (!carNumber) {
    return {
      ok: false,
      status: 400,
      error: 'Preferred number must be 00 or 1 through 99. Number 0 is reserved for the pace car.',
    };
  }

  let { data: profileMatch, error: profileError } = await sb
    .from('driver_profiles')
    .select('driver_id, iracing_customer_id, display_name, iracing_name, car_number, active')
    .eq('car_number', carNumber)
    .neq('active', false)
    .limit(1)
    .maybeSingle();

  if (
    profileError &&
    (profileError.code === '42703' || /iracing_customer_id/i.test(profileError.message || ''))
  ) {
    const fallback = await sb
      .from('driver_profiles')
      .select('driver_id, display_name, iracing_name, car_number, active')
      .eq('car_number', carNumber)
      .neq('active', false)
      .limit(1)
      .maybeSingle();
    profileMatch = fallback.data;
    profileError = fallback.error;
  }

  if (profileError && !isMissingTableError(profileError)) {
    return { ok: false, status: 500, error: profileError.message || 'Failed to check number availability.' };
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (
    profileMatch &&
    (!normalizedCustomerId ||
      (normalizeCustomerId(profileMatch.iracing_customer_id) !== normalizedCustomerId &&
        String(profileMatch.driver_id || '') !== normalizedCustomerId))
  ) {
    const name = profileMatch.display_name || profileMatch.iracing_name || 'another driver';
    return {
      ok: false,
      status: 409,
      error: `Number ${carNumber} is already assigned to ${name}. Please choose another number.`,
    };
  }

  const { data: reservation, error: reservationError } = await sb
    .from('driver_number_reservations')
    .select('*')
    .eq('number', carNumber)
    .in('status', ACTIVE_RESERVATION_STATUSES)
    .limit(1)
    .maybeSingle();

  if (reservationError) {
    if (isMissingTableError(reservationError)) return { ok: true, carNumber };
    return {
      ok: false,
      status: 500,
      error: reservationError.message || 'Failed to check number reservations.',
    };
  }

  if (reservation) {
    const sameApplication =
      applicationId && String(reservation.application_id || '') === String(applicationId);
    const sameCustomer =
      normalizedCustomerId &&
      normalizeCustomerId(reservation.iracing_customer_id) === normalizedCustomerId;
    if (!sameApplication && !sameCustomer) {
      return {
        ok: false,
        status: 409,
        error: reservationConflictMessage(carNumber, reservation.status),
      };
    }
  }

  return { ok: true, carNumber };
}

export async function createPendingReservation(sb, { number, applicationId, iracingCustomerId, note = '' }) {
  const carNumber = normalizeCarNumber(number);
  if (!carNumber) {
    return { ok: false, status: 400, error: 'A valid preferred number is required.' };
  }

  const availability = await assertNumberAvailableForApplication(
    sb,
    carNumber,
    iracingCustomerId,
    applicationId
  );
  if (!availability.ok) return availability;

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from('driver_number_reservations')
    .insert({
      number: carNumber,
      status: 'pending',
      application_id: applicationId,
      iracing_customer_id: normalizeCustomerId(iracingCustomerId) || null,
      note: note || null,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        status: 409,
        error: reservationConflictMessage(carNumber, 'pending'),
      };
    }
    if (isMissingTableError(error)) {
      return { ok: false, status: 503, error: 'Number reservations are not configured yet.' };
    }
    return { ok: false, status: 500, error: error.message || 'Failed to reserve number.' };
  }

  return { ok: true, reservation: data };
}

export async function updateReservationStatus(sb, reservationId, status, patch = {}) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  if (!RESERVATION_STATUSES.includes(normalizedStatus)) {
    return { ok: false, status: 400, error: 'Invalid reservation status.' };
  }

  const { data, error } = await sb
    .from('driver_number_reservations')
    .update({
      status: normalizedStatus,
      updated_at: new Date().toISOString(),
      ...patch,
    })
    .eq('id', reservationId)
    .select('*')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      return { ok: false, status: 503, error: 'Number reservations are not configured yet.' };
    }
    return { ok: false, status: 500, error: error.message || 'Failed to update reservation.' };
  }

  return { ok: true, reservation: data };
}

export async function releaseReservationForApplication(sb, applicationId, note = 'released_by_staff') {
  const reservation = await getReservationForApplication(sb, applicationId);
  if (!reservation) return { ok: true, reservation: null };
  if (!ACTIVE_RESERVATION_STATUSES.includes(String(reservation.status || '').toLowerCase())) {
    return { ok: true, reservation };
  }
  return updateReservationStatus(sb, reservation.id, 'released', { note });
}

export async function assignReservationForApplication(sb, application, driverId = '') {
  if (isAnyPreferredNumber(application?.preferred_number)) {
    return { ok: true, reservation: null };
  }
  const reservation = await getReservationForApplication(sb, application?.id);
  if (!reservation) {
    if (!application?.preferred_number) return { ok: true, reservation: null };
    const createResult = await createPendingReservation(sb, {
      number: application.preferred_number,
      applicationId: application.id,
      iracingCustomerId: application.iracing_customer_id,
      note: 'created_on_assign',
    });
    if (!createResult.ok) return createResult;
    return updateReservationStatus(sb, createResult.reservation.id, 'assigned', {
      driver_id: driverId || normalizeCustomerId(application.iracing_customer_id) || null,
      note: 'assigned_on_approval',
    });
  }

  if (String(reservation.status || '').toLowerCase() === 'assigned') {
    return { ok: true, reservation };
  }

  return updateReservationStatus(sb, reservation.id, 'assigned', {
    driver_id: driverId || normalizeCustomerId(application.iracing_customer_id) || null,
    note: 'assigned_on_approval',
  });
}

export async function syncReservationForApplicationStatus(sb, application, previousStatus = '') {
  const status = String(application?.status || '').trim().toLowerCase();
  const previous = String(previousStatus || '').trim().toLowerCase();

  if (status === previous) return { ok: true };

  if (status === 'rejected') {
    return releaseReservationForApplication(sb, application.id, 'application_rejected');
  }

  if (status === 'approved') {
    return assignReservationForApplication(
      sb,
      application,
      normalizeCustomerId(application.iracing_customer_id)
    );
  }

  if (['pending', 'reviewing', 'waitlist', 'recruiting_race'].includes(status)) {
    const reservation = await getReservationForApplication(sb, application.id);
    if (
      !reservation &&
      application.preferred_number &&
      !isAnyPreferredNumber(application.preferred_number)
    ) {
      return createPendingReservation(sb, {
        number: application.preferred_number,
        applicationId: application.id,
        iracingCustomerId: application.iracing_customer_id,
        note: 'created_on_status_sync',
      });
    }
    if (
      reservation &&
      String(reservation.status || '').toLowerCase() === 'released' &&
      application.preferred_number &&
      !isAnyPreferredNumber(application.preferred_number)
    ) {
      return createPendingReservation(sb, {
        number: application.preferred_number,
        applicationId: application.id,
        iracingCustomerId: application.iracing_customer_id,
        note: 'recreated_on_status_sync',
      });
    }
  }

  return { ok: true };
}

export async function releaseApplicationNumber(applicationId, note = 'released_by_staff') {
  const { supabase } = await import('./_lib.js');
  const sb = supabase();
  if (!sb) return { ok: false, status: 503, error: 'Supabase not configured yet.' };
  return releaseReservationForApplication(sb, applicationId, note);
}

export async function assignApplicationNumber(applicationId, options = {}) {
  const { supabase } = await import('./_lib.js');
  const sb = supabase();
  if (!sb) return { ok: false, status: 503, error: 'Supabase not configured yet.' };

  const { getDriverApplicationById } = await import('./_driver-applications.js');
  const application = await getDriverApplicationById(applicationId);
  if (!application) return { ok: false, status: 404, error: 'Application not found.' };

  const overrideNumber = normalizeCarNumber(options.number);
  const applicationForAssign = isAnyPreferredNumber(application.preferred_number)
    ? overrideNumber
      ? { ...application, preferred_number: overrideNumber }
      : application
    : application;

  if (isAnyPreferredNumber(application.preferred_number) && !overrideNumber) {
    return {
      ok: false,
      status: 400,
      error: 'Applicant selected ANY. Enter a car number to assign.',
    };
  }

  const availability = await assertNumberAvailableForApplication(
    sb,
    applicationForAssign.preferred_number,
    application.iracing_customer_id,
    application.id
  );
  if (!availability.ok) return availability;

  return assignReservationForApplication(
    sb,
    applicationForAssign,
    normalizeCustomerId(application.iracing_customer_id)
  );
}
