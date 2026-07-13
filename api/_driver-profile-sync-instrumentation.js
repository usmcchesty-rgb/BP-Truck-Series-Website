import { DRIVER_PROFILE_SYNC_VERSION } from './_driver-profile-sync-identity.js';

export const SYNC_INSTRUMENTATION_VERSION = 'driver-profile-sync-instrumentation-v1';

/** Stable fingerprints for proving which code path ran in production logs. */
export const SYNC_INSERT_PATHS = {
  SYNC_APPLICATION_NO_MATCH:
    'api/_driver-applications.js:syncApplicationToDriverProfile:449→createDriverProfileFromApplication',
  CREATE_PROFILE_NO_MATCH:
    'api/_driver-applications.js:createDriverProfileFromApplication:316→insert:322',
  CREATE_PROFILE_INSERT_EXECUTED:
    'api/_driver-applications.js:createDriverProfileFromApplication:322',
};

function captureStackTrace(label = '') {
  const stack = new Error(label || 'sync-instrumentation-stack').stack || '';
  return stack
    .split('\n')
    .slice(1, 12)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function buildSyncRuntimeBuildInfo() {
  return {
    syncVersion: DRIVER_PROFILE_SYNC_VERSION,
    instrumentationVersion: SYNC_INSTRUMENTATION_VERSION,
    instrumentedModule: 'api/_driver-applications.js',
    insertPathFingerprints: SYNC_INSERT_PATHS,
    instrumentedAt: '2026-07-13',
  };
}

export function buildPerApplicationTrace(application = {}, match = {}, options = {}) {
  const customerId = String(options.incomingIracingCustomerId || application?.iracing_customer_id || '').trim();
  return {
    syncVersion: DRIVER_PROFILE_SYNC_VERSION,
    instrumentationVersion: SYNC_INSTRUMENTATION_VERSION,
    applicationId: application?.id || null,
    driverName:
      application?.iracing_display_name ||
      application?.driver_name ||
      null,
    incomingDriverId: options.incomingDriverId ?? null,
    incomingIracingCustomerId: customerId || null,
    srhDriverId: application?.srh_driver_id || application?.standings_driver_id || null,
    resolvedExistingProfileDriverId: match?.profile?.driver_id || null,
    matchMethod: match?.matchedBy || null,
    operationChosen: options.operationChosen || null,
    insertPathSelected: options.insertPathSelected || null,
    insertPayload: options.insertPayload || null,
    insertExecuted: options.insertExecuted === true,
    precomputedMatchPassed: options.precomputedMatchPassed === true,
    profileMapStats: options.profileMapStats || null,
    standingsDriverCount: options.standingsDriverCount ?? null,
    duplicateKeyError: options.duplicateKeyError || null,
    stackTrace: options.stackTrace || null,
    notes: Array.isArray(options.notes) ? options.notes : [],
  };
}

export function buildDuplicateKeyCapture(error = {}, context = {}) {
  return {
    attemptedDriverId: context.attemptedDriverId || null,
    attemptedIracingCustomerId: context.attemptedIracingCustomerId || null,
    sqlErrorCode: error.code || null,
    sqlErrorMessage: error.message || null,
    sqlConstraint: error.constraint || null,
    sqlDetail: error.details || error.detail || null,
    insertInitiatorFunction: context.insertInitiatorFunction || null,
    insertPathSelected: context.insertPathSelected || null,
    insertPayload: context.insertPayload || null,
    stackTrace: captureStackTrace('driver_profiles insert duplicate-key'),
  };
}

export function summarizeProfileMapStats(profileMaps = {}) {
  return {
    profileCount: Array.isArray(profileMaps.all) ? profileMaps.all.length : 0,
    byDriverId: profileMaps.byDriverId?.size ?? 0,
    byIracingCustomerId: profileMaps.byIracingCustomerId?.size ?? 0,
    bySourceApplicationId: profileMaps.bySourceApplicationId?.size ?? 0,
    byEmail: profileMaps.byEmail?.size ?? 0,
    byName: profileMaps.byName?.size ?? 0,
  };
}

export function logSyncRuntimeTrace(trace = {}, level = 'info') {
  const payload = {
    level,
    tag: 'driver-profile-sync-runtime',
    ...trace,
  };
  console.log(JSON.stringify(payload));
  return payload;
}

export function attachRuntimeTraceToResult(result = {}, trace = {}) {
  return {
    ...result,
    runtimeTrace: trace,
  };
}
