import {
  ACTIVE_RESERVATION_STATUSES,
  isAnyPreferredNumber,
  listActiveReservations,
  normalizeCarNumber,
} from './_driver-number-reservations.js';

function isMissingTableError(error) {
  const message = String(error?.message || '');
  return error?.code === '42P01' || /does not exist/i.test(message);
}

export function normalizeCustomerId(value) {
  return String(value ?? '').trim().replace(/\D/g, '');
}

export function extractStandingsCarNumber(srhRow = {}, srhDriver = {}) {
  const candidates = [
    srhRow.car_number,
    srhRow.carNumber,
    srhRow.car_num,
    srhRow.carnum,
    srhRow.number,
    srhDriver.car_number,
    srhDriver.carNumber,
    srhDriver.car_num,
    srhDriver.carnum,
    srhDriver.number,
  ];

  for (const value of candidates) {
    const normalized = normalizeCarNumber(value);
    if (normalized) return normalized;
  }

  return '';
}

export function resolveBpNumber({
  profile = null,
  reservation = null,
  application = null,
  standingsCarNumber = '',
} = {}) {
  const row = profile || {};

  const fromCar = normalizeCarNumber(row.car_number);
  if (fromCar) return fromCar;

  const fromTruck = normalizeCarNumber(row.truck_number);
  if (fromTruck) return fromTruck;

  if (reservation) {
    const status = String(reservation.status || '').trim().toLowerCase();
    if (ACTIVE_RESERVATION_STATUSES.includes(status)) {
      const fromReservation = normalizeCarNumber(reservation.number);
      if (fromReservation) return fromReservation;
    }
  }

  if (application) {
    const status = String(application.status || '').trim().toLowerCase();
    if (status === 'approved' && !isAnyPreferredNumber(application.preferred_number)) {
      const fromPreferred = normalizeCarNumber(application.preferred_number);
      if (fromPreferred) return fromPreferred;
    }
  }

  const fromStandings = normalizeCarNumber(standingsCarNumber);
  if (fromStandings) return fromStandings;

  return '';
}

export function buildReservationMaps(reservations = []) {
  const byDriverId = new Map();
  const byApplicationId = new Map();
  const byCustomerId = new Map();

  for (const reservation of reservations) {
    const status = String(reservation.status || '').trim().toLowerCase();
    if (!ACTIVE_RESERVATION_STATUSES.includes(status)) continue;

    const driverId = String(reservation.driver_id || '').trim();
    if (driverId && !byDriverId.has(driverId)) {
      byDriverId.set(driverId, reservation);
    }

    const applicationId = String(reservation.application_id || '').trim();
    if (applicationId && !byApplicationId.has(applicationId)) {
      byApplicationId.set(applicationId, reservation);
    }

    const customerId = normalizeCustomerId(reservation.iracing_customer_id);
    if (customerId && !byCustomerId.has(customerId)) {
      byCustomerId.set(customerId, reservation);
    }
  }

  return { byDriverId, byApplicationId, byCustomerId };
}

export function buildApplicationMaps(applications = []) {
  const byApplicationId = new Map();
  const byCustomerId = new Map();

  for (const application of applications) {
    const applicationId = String(application.id || '').trim();
    if (applicationId) {
      byApplicationId.set(applicationId, application);
    }

    const customerId = normalizeCustomerId(application.iracing_customer_id);
    if (customerId && !byCustomerId.has(customerId)) {
      byCustomerId.set(customerId, application);
    }
  }

  return { byApplicationId, byCustomerId };
}

export function pickReservationForProfile(profile = {}, maps = {}) {
  const driverId = String(profile.driver_id || '').trim();
  if (driverId && maps.byDriverId?.has(driverId)) {
    return maps.byDriverId.get(driverId);
  }

  const applicationId = String(
    profile.source_application_id || profile.sourceApplicationId || '',
  ).trim();
  if (applicationId && maps.byApplicationId?.has(applicationId)) {
    return maps.byApplicationId.get(applicationId);
  }

  const customerId = normalizeCustomerId(
    profile.iracing_customer_id || profile.iracingCustomerId,
  );
  if (customerId && maps.byCustomerId?.has(customerId)) {
    return maps.byCustomerId.get(customerId);
  }

  return null;
}

export function pickApplicationForProfile(profile = {}, maps = {}) {
  const applicationId = String(
    profile.source_application_id || profile.sourceApplicationId || '',
  ).trim();
  if (applicationId && maps.byApplicationId?.has(applicationId)) {
    return maps.byApplicationId.get(applicationId);
  }

  const customerId = normalizeCustomerId(
    profile.iracing_customer_id || profile.iracingCustomerId,
  );
  if (customerId && maps.byCustomerId?.has(customerId)) {
    return maps.byCustomerId.get(customerId);
  }

  return null;
}

export async function loadBpNumberContext(sb) {
  if (!sb) {
    return {
      reservations: [],
      applications: [],
      reservationMaps: buildReservationMaps([]),
      applicationMaps: buildApplicationMaps([]),
    };
  }

  let reservations = [];
  try {
    reservations = await listActiveReservations(sb);
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
  }

  let applications = [];
  const { data, error } = await sb
    .from('driver_applications')
    .select('id, status, preferred_number, iracing_customer_id')
    .eq('status', 'approved');

  if (error) {
    if (!isMissingTableError(error)) throw error;
  } else {
    applications = data || [];
  }

  return {
    reservations,
    applications,
    reservationMaps: buildReservationMaps(reservations),
    applicationMaps: buildApplicationMaps(applications),
  };
}

export function attachBpNumber(profile, rawRow, context, standingsCarNumber = '') {
  if (!profile) return profile;

  const reservation = pickReservationForProfile(rawRow || profile, context.reservationMaps);
  const application = pickApplicationForProfile(rawRow || profile, context.applicationMaps);
  const bp_number = resolveBpNumber({
    profile: rawRow || profile,
    reservation,
    application,
    standingsCarNumber,
  });

  return {
    ...profile,
    bp_number,
  };
}
