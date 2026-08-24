import { getDriverProfiles, getSettings, supabase, slugify, stripPhotoUrlQuery, withPhotoCacheBust, photoCacheVersion } from './_lib.js';
import { buildAvailableNumberSummaryFromDb } from './_driver-number-reservations.js';
import { attachBpNumber, loadBpNumberContext } from './_bp-driver-number.js';
import {
  fetchGoogleFormResponses,
  buildFormSyncPreview,
  applyFormSyncUpdates,
} from './_driver-bio-sync.js';
import {
  buildSharePreviewHtml,
  DEFAULT_SHARE_IMAGE,
  getSiteOrigin,
} from './_share-html.js';
import { resolveOgImageMeta } from './_share-image-meta.js';
import {
  IRACING_ERROR,
  IracingApiError,
  getIracingMember,
  isIracingConfigured,
  normalizeCustomerId,
} from './_iracing.js';
import {
  adminAuthFailurePayload,
  isAdminPasswordValid,
  parseRequestBody,
  validateAdminPassword,
} from './_admin-auth.js';
import { stripPrivateDriverProfileFields } from './_driver-profile-privacy.js';
import {
  mergeDriverProfilePatch,
  resolveExistingProfileForDriverWrite,
  sanitizeIncomingCustomerId,
} from './_drivers-write-identity.js';
import {
  enrichDriversWithNumberArtwork,
} from './_number-artwork-catalog.js';
import { findDriverProfileByQuery } from './_driver-profile-resolve.js';
import { fetchStandingsRows } from './_standings-rows.js';

export { stripPrivateDriverProfileFields } from './_driver-profile-privacy.js';

const DRIVERS_WRITE_INSTRUMENTATION_VERSION = 'drivers-write-instrumentation-v2';

const DRIVERS_WRITE_PATHS = {
  POST_DRIVER_WRITE: 'api/drivers.js:handler:POST:writeDriverProfile',
  UPDATE_BY_RESOLVED_IDENTITY: 'api/drivers.js:writeDriverProfile:update:by_resolved_identity',
  INSERT_NEW_PROFILE: 'api/drivers.js:writeDriverProfile:insert:new_profile',
  RECOVERED_UPDATE: 'api/drivers.js:writeDriverProfile:update:recovered_duplicate_key',
};

function captureDriversWriteStack(label = 'drivers-write') {
  const stack = new Error(label).stack || '';
  return stack
    .split('\n')
    .slice(1, 14)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferDriverWriteSource(body = {}) {
  const action = String(body.action || '').trim().toLowerCase();
  if (action === 'preview-form-sync') return 'google_form_sync_preview';
  if (action === 'apply-form-sync') return 'google_form_sync_apply';
  if (body.source_application_id || body.sourceApplicationId) {
    return 'approved_application';
  }
  if (body.srh_driver_id || body.standings_driver_id || body.standingsDriverId) {
    return 'standings_or_srh_snapshot';
  }
  if (body.in_standings === true || body.inStandings === true) {
    return 'standings_roster_row';
  }
  return 'admin_driver_save';
}

function buildDriversWriteTrace(body = {}, row = {}, options = {}) {
  return {
    instrumentationVersion: DRIVERS_WRITE_INSTRUMENTATION_VERSION,
    operationName: options.operationName || 'driver_profiles_write',
    incomingDriverId: options.incomingDriverId || row?.driver_id || body?.driver_id || null,
    incomingIracingCustomerId:
      options.incomingIracingCustomerId ||
      row?.iracing_customer_id ||
      normalizeCustomerId(body?.iracing_customer_id ?? body?.iracingCustomerId) ||
      null,
    driver_id: row?.driver_id || body?.driver_id || null,
    iracing_customer_id:
      row?.iracing_customer_id ||
      normalizeCustomerId(body?.iracing_customer_id ?? body?.iracingCustomerId) ||
      null,
    display_name: row?.display_name || body?.display_name || body?.iracing_name || null,
    source: inferDriverWriteSource(body),
    operationChosen: options.operationChosen || null,
    operationTargetDriverId: options.operationTargetDriverId || null,
    matchMethod: options.matchMethod || null,
    writePathSelected: options.writePathSelected || null,
    upsertExecuted: options.upsertExecuted === true,
    insertExecuted: options.insertExecuted === true,
    updateExecuted: options.updateExecuted === true,
    insertLikely: options.insertLikely === true,
    existingProfileDriverId: options.existingProfileDriverId || null,
    existingProfileSlug: options.existingProfileSlug || null,
    rowPayload: row || null,
    updatePayload: options.updatePayload || null,
    supabaseResult: options.supabaseResult || null,
    duplicateKeyError: options.duplicateKeyError || null,
    identityConflict: options.identityConflict || null,
    currentFunction: options.currentFunction || null,
    currentSourceDriver: {
      driver_id: body?.driver_id || null,
      iracing_customer_id:
        normalizeCustomerId(body?.iracing_customer_id ?? body?.iracingCustomerId) || null,
      display_name: body?.display_name || body?.iracing_name || null,
      source: inferDriverWriteSource(body),
    },
    stackTrace: options.stackTrace || null,
    notes: Array.isArray(options.notes) ? options.notes : [],
  };
}

function buildDuplicateKeyDiagnostics(error = {}, context = {}) {
  return {
    attemptedDriverId: context.attemptedDriverId || null,
    attemptedIracingCustomerId: context.attemptedIracingCustomerId || null,
    sqlState: error.code || null,
    constraint: error.constraint || null,
    message: error.message || null,
    details: error.details || error.detail || null,
    insertPayload: context.insertPayload || null,
    writePathSelected: context.writePathSelected || null,
    currentFunction: context.currentFunction || null,
    currentSourceDriver: context.currentSourceDriver || null,
    stackTrace: captureDriversWriteStack('driver_profiles duplicate-key'),
  };
}

function logDriversWriteTrace(trace = {}, level = 'info') {
  const payload = {
    level,
    tag: 'drivers-write-runtime',
    ...trace,
  };
  console.log(JSON.stringify(payload));
  return payload;
}

function isDuplicateKeyError(error) {
  return error?.code === '23505';
}

async function handleIracingMemberLookup(req, res) {
  const customerId = normalizeCustomerId(
    req.query?.customerId ?? req.query?.customer_id ?? req.query?.cust_id
  );

  try {
    const result = await getIracingMember(customerId);
    return res.status(200).json({
      ok: true,
      configured: true,
      customer_id: result.customer_id,
      display_name: result.display_name,
      club_name: result.club_name,
      member_since: result.member_since,
      debug: result.debug,
    });
  } catch (error) {
    if (error instanceof IracingApiError) {
      return res.status(error.status).json({
        ok: false,
        configured: error.code !== IRACING_ERROR.MISSING_OAUTH_CONFIG,
        code: error.code,
        error: error.message,
        details: error.details,
        customer_id: customerId || null,
      });
    }

    return res.status(500).json({
      ok: false,
      configured: isIracingConfigured(),
      code: IRACING_ERROR.API_UNAVAILABLE,
      error: error.message || 'iRacing lookup failed.',
      customer_id: customerId || null,
    });
  }
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function normalizeStreamUrl(value) {
  return String(value ?? '').trim();
}

function normalizeOptionalText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeCarNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^\d{1,2}$/.test(text)) return '';
  if (text === '0') return '';
  return text;
}

async function findDriverProfileWithStandingsFallback(profiles, queryId) {
  const direct = findDriverProfileByQuery(profiles, queryId);
  if (direct.profile) return direct.profile;

  try {
    const settings = await getSettings();
    const standingsPayload = await fetchStandingsRows(settings);
    const standingsRows = Array.isArray(standingsPayload)
      ? standingsPayload
      : standingsPayload?.rows || [];
    return findDriverProfileByQuery(profiles, queryId, { standingsRows }).profile;
  } catch {
    return null;
  }
}

function normalizeStandingCrop(row = {}) {
  const zoom = Number(row.standing_photo_zoom ?? row.standingPhotoZoom);
  const x = Number(row.standing_photo_x ?? row.standingPhotoX);
  const y = Number(row.standing_photo_y ?? row.standingPhotoY);
  return {
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
    y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
  };
}

function isAdminDriversRequest(req, body = {}) {
  return isAdminPasswordValid(req, body);
}

function normalizeDriverProfile(row, options = {}) {
  const includePrivateFields = options.includePrivateFields === true;
  if (!row) return null;
  const photo_url = stripPhotoUrlQuery(row.photo_url || '');
  const car_image_url = stripPhotoUrlQuery(row.car_image_url || '');
  const standing_photo_url = stripPhotoUrlQuery(row.standing_photo_url || '');
  const standingCrop = normalizeStandingCrop(row);
  const driver_id = String(row.driver_id ?? '').trim();
  const standingUpdated = row.standing_photo_updated_at || null;
  const profile = {
    driver_id,
    iracing_customer_id: normalizeOptionalText(row.iracing_customer_id) || '',
    iracingCustomerId: normalizeOptionalText(row.iracing_customer_id) || '',
    iracing_name: row.iracing_name || row.driver_name || '',
    display_name: row.display_name || row.driver_name || '',
    car_number: String(row.car_number ?? '').trim(),
    truck_number: String(row.truck_number ?? '').trim(),
    truckNumber: String(row.truck_number ?? '').trim(),
    photo_url,
    photoUrl: photo_url
      ? withPhotoCacheBust(photo_url, photoCacheVersion(row.updated_at))
      : '',
    car_image_url,
    carImageUrl: car_image_url || '',
    standing_photo_url,
    standingPhotoUrl: standing_photo_url
      ? withPhotoCacheBust(standing_photo_url, photoCacheVersion(standingUpdated))
      : '',
    standing_photo_zoom: standingCrop.zoom,
    standingPhotoZoom: standingCrop.zoom,
    standing_photo_x: standingCrop.x,
    standingPhotoX: standingCrop.x,
    standing_photo_y: standingCrop.y,
    standingPhotoY: standingCrop.y,
    standing_photo_updated_at: standingUpdated,
    standingPhotoUpdatedAt: standingUpdated,
    standing_photo_enabled: normalizeBoolean(row.standing_photo_enabled, true),
    standingPhotoEnabled: normalizeBoolean(row.standing_photo_enabled, true),
    is_streamer: normalizeBoolean(row.is_streamer, false),
    stream_url: normalizeStreamUrl(row.stream_url),
    date_of_birth: normalizeOptionalText(row.date_of_birth) || '',
    dateOfBirth: normalizeOptionalText(row.date_of_birth) || '',
    hometown: normalizeOptionalText(row.hometown) || '',
    team: normalizeOptionalText(row.team) || '',
    active: row.active !== false,
    bio: normalizeOptionalText(row.bio) || '',
    years_sim_racing: normalizeOptionalText(row.years_sim_racing) || '',
    yearsSimRacing: normalizeOptionalText(row.years_sim_racing) || '',
    driving_style: normalizeOptionalText(row.driving_style) || '',
    drivingStyle: normalizeOptionalText(row.driving_style) || '',
    favorite_track: normalizeOptionalText(row.favorite_track) || '',
    favoriteTrack: normalizeOptionalText(row.favorite_track) || '',
    favorite_nascar_driver: normalizeOptionalText(row.favorite_nascar_driver) || '',
    favoriteNascarDriver: normalizeOptionalText(row.favorite_nascar_driver) || '',
    sim_racing_accomplishment: normalizeOptionalText(row.sim_racing_accomplishment) || '',
    simRacingAccomplishment: normalizeOptionalText(row.sim_racing_accomplishment) || '',
    season_goal: normalizeOptionalText(row.season_goal) || '',
    seasonGoal: normalizeOptionalText(row.season_goal) || '',
    fun_fact: normalizeOptionalText(row.fun_fact) || '',
    funFact: normalizeOptionalText(row.fun_fact) || '',
    facebook_url: normalizeOptionalText(row.facebook_url) || '',
    facebookUrl: normalizeOptionalText(row.facebook_url) || '',
    twitter_url: normalizeOptionalText(row.twitter_url) || '',
    twitterUrl: normalizeOptionalText(row.twitter_url) || '',
    instagram_url: normalizeOptionalText(row.instagram_url) || '',
    instagramUrl: normalizeOptionalText(row.instagram_url) || '',
    youtube_url: normalizeOptionalText(row.youtube_url) || '',
    youtubeUrl: normalizeOptionalText(row.youtube_url) || '',
    twitch_url: normalizeOptionalText(row.twitch_url) || '',
    twitchUrl: normalizeOptionalText(row.twitch_url) || '',
    tiktok_url: normalizeOptionalText(row.tiktok_url) || '',
    tiktokUrl: normalizeOptionalText(row.tiktok_url) || '',
  };

  if (includePrivateFields) {
    profile.form_email = normalizeOptionalText(row.form_email) || '';
    profile.formEmail = normalizeOptionalText(row.form_email) || '';
    profile.form_submitted_at = row.form_submitted_at || null;
    profile.formSubmittedAt = row.form_submitted_at || null;
    profile.form_permission_granted = normalizeBoolean(row.form_permission_granted, false);
    profile.formPermissionGranted = normalizeBoolean(row.form_permission_granted, false);
  }

  return profile;
}

function buildPublicDriverProfile(row) {
  return normalizeDriverProfile(row, { includePrivateFields: false });
}

function buildAdminDriverProfile(row) {
  return normalizeDriverProfile(row, { includePrivateFields: true });
}

function buildUpsertRow(b) {
  const displayName = b.display_name || b.iracing_name;
  const carNumber = normalizeCarNumber(b.car_number);
  const standingCrop = normalizeStandingCrop(b);
  const hasStandingUrl =
    b.standing_photo_url !== undefined || b.standingPhotoUrl !== undefined;
  const hasStandingCrop =
    b.standing_photo_zoom !== undefined ||
    b.standingPhotoZoom !== undefined ||
    b.standing_photo_x !== undefined ||
    b.standingPhotoX !== undefined ||
    b.standing_photo_y !== undefined ||
    b.standingPhotoY !== undefined;

  const hasStandingEnabled =
    b.standing_photo_enabled !== undefined || b.standingPhotoEnabled !== undefined;

  const row = {
    driver_id: String(b.driver_id),
    iracing_name: String(b.iracing_name),
    display_name: displayName,
    driver_name: displayName,
    slug: slugify(displayName || b.iracing_name || b.driver_id),
    car_number: carNumber,
    truck_number: carNumber,
    photo_url: stripPhotoUrlQuery(b.photo_url || ''),
    is_streamer: normalizeBoolean(b.is_streamer, false),
    stream_url: normalizeStreamUrl(b.stream_url),
    date_of_birth: normalizeOptionalText(b.date_of_birth ?? b.dateOfBirth),
    hometown: normalizeOptionalText(b.hometown),
    team: normalizeOptionalText(b.team),
    active: b.active !== false,
    bio: normalizeOptionalText(b.bio),
    years_sim_racing: normalizeOptionalText(b.years_sim_racing ?? b.yearsSimRacing),
    driving_style: normalizeOptionalText(b.driving_style ?? b.drivingStyle),
    favorite_track: normalizeOptionalText(b.favorite_track ?? b.favoriteTrack),
    favorite_nascar_driver: normalizeOptionalText(
      b.favorite_nascar_driver ?? b.favoriteNascarDriver
    ),
    sim_racing_accomplishment: normalizeOptionalText(
      b.sim_racing_accomplishment ?? b.simRacingAccomplishment
    ),
    season_goal: normalizeOptionalText(b.season_goal ?? b.seasonGoal),
    fun_fact: normalizeOptionalText(b.fun_fact ?? b.funFact),
    facebook_url: normalizeOptionalText(b.facebook_url ?? b.facebookUrl),
    twitter_url: normalizeOptionalText(b.twitter_url ?? b.twitterUrl),
    instagram_url: normalizeOptionalText(b.instagram_url ?? b.instagramUrl),
    youtube_url: normalizeOptionalText(b.youtube_url ?? b.youtubeUrl),
    twitch_url: normalizeOptionalText(b.twitch_url ?? b.twitchUrl),
    tiktok_url: normalizeOptionalText(b.tiktok_url ?? b.tiktokUrl),
    car_image_url: stripPhotoUrlQuery(b.car_image_url ?? b.carImageUrl ?? ''),
    iracing_customer_id: sanitizeIncomingCustomerId(b, null) || '',
    updated_at: new Date().toISOString(),
  };

  if (b.form_email !== undefined || b.formEmail !== undefined) {
    row.form_email = normalizeOptionalText(b.form_email ?? b.formEmail);
  }
  if (b.form_submitted_at !== undefined || b.formSubmittedAt !== undefined) {
    row.form_submitted_at = b.form_submitted_at ?? b.formSubmittedAt ?? null;
  }
  if (b.form_permission_granted !== undefined || b.formPermissionGranted !== undefined) {
    row.form_permission_granted = normalizeBoolean(b.form_permission_granted ?? b.formPermissionGranted);
  }

  if (hasStandingUrl) {
    row.standing_photo_url = stripPhotoUrlQuery(
      b.standing_photo_url ?? b.standingPhotoUrl ?? '',
    );
    row.standing_photo_updated_at =
      b.standing_photo_updated_at ?? b.standingPhotoUpdatedAt ?? new Date().toISOString();
  }

  if (hasStandingCrop) {
    row.standing_photo_zoom = standingCrop.zoom;
    row.standing_photo_x = standingCrop.x;
    row.standing_photo_y = standingCrop.y;
    row.standing_photo_updated_at =
      b.standing_photo_updated_at ?? b.standingPhotoUpdatedAt ?? new Date().toISOString();
  }

  if (hasStandingEnabled) {
    row.standing_photo_enabled = normalizeBoolean(
      b.standing_photo_enabled ?? b.standingPhotoEnabled,
      true,
    );
  }

  return row;
}

function buildIdentityConflictError(resolution = {}) {
  const error = new Error(
    'Identity conflict: multiple existing driver profiles match this incoming row.'
  );
  error.code = 'IDENTITY_CONFLICT';
  error.status = 409;
  error.matches = resolution.matches || [];
  return error;
}

async function recoverProfileFromDuplicateKey(sb, error, incoming = {}, row = {}) {
  const details = String(error?.details || error?.detail || '');
  const resolution = await resolveExistingProfileForDriverWrite(sb, incoming);
  if (resolution.conflict || !resolution.profile) {
    return null;
  }

  if (details.includes('(slug)=')) {
    const slugMatch = resolution.matches.find((entry) => entry.methods.includes('slug'));
    if (slugMatch?.profile) return { profile: slugMatch.profile, matchMethod: 'slug' };
  }

  if (details.includes('(iracing_customer_id)=')) {
    const customerMatch = resolution.matches.find((entry) =>
      entry.methods.includes('iracing_customer_id')
    );
    if (customerMatch?.profile) {
      return { profile: customerMatch.profile, matchMethod: 'iracing_customer_id' };
    }
  }

  if (details.includes('(driver_id)=') || error.constraint === 'driver_profiles_pkey') {
    return { profile: resolution.profile, matchMethod: resolution.matchMethod || 'driver_id' };
  }

  return { profile: resolution.profile, matchMethod: resolution.matchMethod };
}

async function writeDriverProfile(sb, row, context = {}) {
  const traces = [];
  const requestBody = context.requestBody || {};
  const incomingDriverId = String(requestBody.driver_id || row.driver_id || '').trim();
  const incomingCustomerId = normalizeCustomerId(
    requestBody.iracing_customer_id ?? requestBody.iracingCustomerId
  );

  const resolution = await resolveExistingProfileForDriverWrite(sb, requestBody);
  const resolutionTrace = buildDriversWriteTrace(requestBody, row, {
    operationName: 'driver_profiles_identity_resolution',
    incomingDriverId,
    incomingIracingCustomerId: incomingCustomerId,
    existingProfileDriverId: resolution.profile?.driver_id || null,
    existingProfileSlug: resolution.profile?.slug || null,
    matchMethod: resolution.matchMethod || null,
    operationChosen: resolution.conflict
      ? 'CONFLICT'
      : resolution.profile
        ? 'UPDATE'
        : 'INSERT',
    operationTargetDriverId: resolution.profile?.driver_id || null,
    identityConflict: resolution.conflict ? resolution.matches : null,
    currentFunction: 'writeDriverProfile',
    currentSourceDriver: context.currentSourceDriver || null,
    notes: resolution.conflict
      ? ['multiple_identity_matches_detected']
      : resolution.profile
        ? [`resolved_existing_profile:${resolution.profile.driver_id}`, `match_method:${resolution.matchMethod}`]
        : ['no_existing_profile_match'],
  });
  logDriversWriteTrace(resolutionTrace);
  traces.push(resolutionTrace);

  if (resolution.conflict) {
    const conflictError = buildIdentityConflictError(resolution);
    return {
      data: null,
      error: conflictError,
      instrumentation: {
        traces,
        finalPath: DRIVERS_WRITE_PATHS.POST_DRIVER_WRITE,
        identityConflict: resolution.matches,
      },
    };
  }

  if (resolution.profile) {
    const targetId = String(resolution.profile.driver_id);
    const updatePayload = mergeDriverProfilePatch(resolution.profile, row, requestBody);
    const updateTrace = buildDriversWriteTrace(requestBody, row, {
      operationName: 'driver_profiles_update_by_resolved_identity',
      incomingDriverId,
      incomingIracingCustomerId: incomingCustomerId,
      existingProfileDriverId: resolution.profile.driver_id,
      existingProfileSlug: resolution.profile.slug || null,
      matchMethod: resolution.matchMethod,
      operationChosen: 'UPDATE',
      operationTargetDriverId: targetId,
      writePathSelected: DRIVERS_WRITE_PATHS.UPDATE_BY_RESOLVED_IDENTITY,
      updateExecuted: true,
      updatePayload,
      currentFunction: 'writeDriverProfile',
      currentSourceDriver: context.currentSourceDriver || null,
      notes: ['explicit_update_by_existing_profile_driver_id'],
    });
    logDriversWriteTrace(updateTrace);
    traces.push(updateTrace);

    const updateResult = await sb
      .from('driver_profiles')
      .update(updatePayload)
      .eq('driver_id', targetId)
      .select()
      .single();

    updateTrace.supabaseResult = {
      ok: !updateResult.error,
      errorCode: updateResult.error?.code || null,
      errorMessage: updateResult.error?.message || null,
      errorConstraint: updateResult.error?.constraint || null,
    };
    logDriversWriteTrace(updateTrace, updateResult.error ? 'error' : 'info');

    if (!updateResult.error) {
      return {
        ...updateResult,
        instrumentation: {
          traces,
          finalPath: DRIVERS_WRITE_PATHS.UPDATE_BY_RESOLVED_IDENTITY,
          matchMethod: resolution.matchMethod,
          operationTargetDriverId: targetId,
        },
      };
    }

    if (isDuplicateKeyError(updateResult.error)) {
      const duplicateKeyError = buildDuplicateKeyDiagnostics(updateResult.error, {
        attemptedDriverId: targetId,
        attemptedIracingCustomerId: updatePayload.iracing_customer_id,
        insertPayload: updatePayload,
        writePathSelected: DRIVERS_WRITE_PATHS.UPDATE_BY_RESOLVED_IDENTITY,
        currentFunction: 'writeDriverProfile',
        currentSourceDriver: context.currentSourceDriver || null,
      });
      updateTrace.duplicateKeyError = duplicateKeyError;
      updateTrace.stackTrace = duplicateKeyError.stackTrace;
      logDriversWriteTrace(updateTrace, 'error');
      return {
        data: null,
        error: updateResult.error,
        instrumentation: { traces, duplicateKeyError, finalPath: DRIVERS_WRITE_PATHS.UPDATE_BY_RESOLVED_IDENTITY },
      };
    }

    return {
      data: null,
      error: updateResult.error,
      instrumentation: { traces, finalPath: DRIVERS_WRITE_PATHS.UPDATE_BY_RESOLVED_IDENTITY },
    };
  }

  const insertRow = {
    ...row,
    iracing_customer_id:
      sanitizeIncomingCustomerId(requestBody, null) || row.iracing_customer_id || null,
  };
  const insertTrace = buildDriversWriteTrace(requestBody, insertRow, {
    operationName: 'driver_profiles_insert_new',
    incomingDriverId,
    incomingIracingCustomerId: incomingCustomerId,
    operationChosen: 'INSERT',
    writePathSelected: DRIVERS_WRITE_PATHS.INSERT_NEW_PROFILE,
    insertExecuted: true,
    insertLikely: true,
    currentFunction: 'writeDriverProfile',
    currentSourceDriver: context.currentSourceDriver || null,
    notes: ['no_identity_match_explicit_insert'],
  });
  logDriversWriteTrace(insertTrace);
  traces.push(insertTrace);

  const insertResult = await sb.from('driver_profiles').insert(insertRow).select().single();
  insertTrace.supabaseResult = {
    ok: !insertResult.error,
    errorCode: insertResult.error?.code || null,
    errorMessage: insertResult.error?.message || null,
    errorConstraint: insertResult.error?.constraint || null,
  };
  logDriversWriteTrace(insertTrace, insertResult.error ? 'error' : 'info');

  if (!insertResult.error) {
    return {
      ...insertResult,
      instrumentation: { traces, finalPath: DRIVERS_WRITE_PATHS.INSERT_NEW_PROFILE },
    };
  }

  if (isDuplicateKeyError(insertResult.error)) {
    const recovery = await recoverProfileFromDuplicateKey(
      sb,
      insertResult.error,
      requestBody,
      insertRow
    );
    if (recovery?.profile) {
      const recoveredPayload = mergeDriverProfilePatch(recovery.profile, row, requestBody);
      const recoveredTrace = buildDriversWriteTrace(requestBody, insertRow, {
        operationName: 'driver_profiles_recovered_update',
        incomingDriverId,
        incomingIracingCustomerId: incomingCustomerId,
        existingProfileDriverId: recovery.profile.driver_id,
        existingProfileSlug: recovery.profile.slug || null,
        matchMethod: recovery.matchMethod || 'recovered_duplicate_key',
        operationChosen: 'UPDATE',
        operationTargetDriverId: recovery.profile.driver_id,
        writePathSelected: DRIVERS_WRITE_PATHS.RECOVERED_UPDATE,
        updateExecuted: true,
        updatePayload: recoveredPayload,
        currentFunction: 'writeDriverProfile',
        currentSourceDriver: context.currentSourceDriver || null,
        notes: ['recovered_duplicate_key_to_update'],
      });
      logDriversWriteTrace(recoveredTrace, 'warn');
      traces.push(recoveredTrace);

      const recoveredResult = await sb
        .from('driver_profiles')
        .update(recoveredPayload)
        .eq('driver_id', recovery.profile.driver_id)
        .select()
        .single();

      recoveredTrace.supabaseResult = {
        ok: !recoveredResult.error,
        errorCode: recoveredResult.error?.code || null,
        errorMessage: recoveredResult.error?.message || null,
        errorConstraint: recoveredResult.error?.constraint || null,
      };
      logDriversWriteTrace(recoveredTrace, recoveredResult.error ? 'error' : 'info');

      if (!recoveredResult.error) {
        return {
          ...recoveredResult,
          instrumentation: {
            traces,
            finalPath: DRIVERS_WRITE_PATHS.RECOVERED_UPDATE,
            matchMethod: recovery.matchMethod,
            operationTargetDriverId: recovery.profile.driver_id,
            recovered: true,
          },
        };
      }

      return {
        data: null,
        error: recoveredResult.error,
        instrumentation: { traces, finalPath: DRIVERS_WRITE_PATHS.RECOVERED_UPDATE },
      };
    }

    const duplicateKeyError = buildDuplicateKeyDiagnostics(insertResult.error, {
      attemptedDriverId: insertRow.driver_id,
      attemptedIracingCustomerId: insertRow.iracing_customer_id,
      insertPayload: insertRow,
      writePathSelected: DRIVERS_WRITE_PATHS.INSERT_NEW_PROFILE,
      currentFunction: 'writeDriverProfile',
      currentSourceDriver: context.currentSourceDriver || null,
    });
    insertTrace.duplicateKeyError = duplicateKeyError;
    insertTrace.stackTrace = duplicateKeyError.stackTrace;
    logDriversWriteTrace(insertTrace, 'error');
    return {
      data: null,
      error: insertResult.error,
      instrumentation: { traces, duplicateKeyError, finalPath: DRIVERS_WRITE_PATHS.INSERT_NEW_PROFILE },
    };
  }

  return {
    data: null,
    error: insertResult.error,
    instrumentation: { traces, finalPath: DRIVERS_WRITE_PATHS.INSERT_NEW_PROFILE },
  };
}

async function handleFormSyncAction(b, res) {
  const sb = supabase();
  if (!sb) {
    return res.status(400).json({ error: 'Supabase not configured yet.' });
  }

  const formSyncTrace = buildDriversWriteTrace(b, null, {
    operationName: String(b.action || 'form_sync'),
    source: inferDriverWriteSource(b),
    currentFunction: 'handleFormSyncAction',
    notes: [
      'form_sync_delegates_writes_to_api/_driver-bio-sync.js:applyFormSyncUpdates',
      'drivers.js does not execute driver_profiles insert/upsert for this action',
    ],
  });
  logDriversWriteTrace(formSyncTrace);

  const profiles = await getDriverProfiles();
  const sheetData = await fetchGoogleFormResponses();
  const preview = buildFormSyncPreview(profiles, sheetData);

  if (b.action === 'preview-form-sync') {
    return res.status(200).json({
      ...preview,
      diagnostics: {
        instrumentationVersion: DRIVERS_WRITE_INSTRUMENTATION_VERSION,
        trace: formSyncTrace,
      },
    });
  }

  if (b.action === 'apply-form-sync') {
    const driverIds = Array.isArray(b.driver_ids)
      ? b.driver_ids
      : Array.isArray(b.driverIds)
        ? b.driverIds
        : [];

    if (!driverIds.length) {
      return res.status(400).json({ error: 'driver_ids array is required for apply-form-sync.' });
    }

    const result = await applyFormSyncUpdates(sb, profiles, driverIds, sheetData);
    return res.status(200).json({
      ...preview,
      applyResult: result,
      diagnostics: {
        instrumentationVersion: DRIVERS_WRITE_INSTRUMENTATION_VERSION,
        trace: formSyncTrace,
        note: 'Per-driver upserts executed inside api/_driver-bio-sync.js, not api/drivers.js upsertDriver().',
      },
    });
  }

  return res.status(400).json({ error: 'Unknown action.' });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const queryAction = String(req.query?.action || '').trim();
    if (queryAction === 'iracingMember') {
      try {
        return await handleIracingMemberLookup(req, res);
      } catch (error) {
        return res.status(500).json({
          configured: isIracingLookupConfigured(),
          verified: false,
          error: error.message || 'iRacing lookup failed.',
        });
      }
    }

    const includePrivateFields = isAdminDriversRequest(req);
    const normalizeProfile = includePrivateFields ? buildAdminDriverProfile : buildPublicDriverProfile;
    const rows = await getDriverProfiles();
    const sb = supabase();
    const bpContext = await loadBpNumberContext(sb);
    const withNumbers = await enrichDriversWithNumberArtwork(
      rows
        .map((row) => {
          const profile = normalizeProfile(row);
          if (!profile) return null;
          return attachBpNumber(profile, row, bpContext);
        })
        .filter(Boolean),
    );
    const normalized = withNumbers
      .filter((row) => includePrivateFields || row.active !== false)
      .sort((a, b) => a.iracing_name.localeCompare(b.iracing_name));

    if (queryAction === 'availableNumbers') {
      const sb = supabase();
      if (sb) {
        try {
          const summary = await buildAvailableNumberSummaryFromDb(sb);
          return res.status(200).json(summary);
        } catch (error) {
          return res.status(500).json({ error: error.message || 'Failed to load available numbers.' });
        }
      }
      const { buildNumberStatusSummary } = await import('./_driver-number-reservations.js');
      return res.status(200).json(buildNumberStatusSummary(rows, []));
    }

    const driverId = String(req.query?.driver_id ?? req.query?.id ?? '').trim();
    const format = String(req.query?.format || '').trim().toLowerCase();
    if (driverId) {
      const profile = await findDriverProfileWithStandingsFallback(normalized, driverId);
      if (!profile) {
        return res.status(404).json({ error: 'Driver not found.' });
      }
      if (!includePrivateFields && profile.active === false) {
        return res.status(404).json({ error: 'Driver not found.' });
      }

      if (format === 'html') {
        const origin = getSiteOrigin(req);
        const name = profile.display_name || profile.iracing_name || 'Driver';
        const number = profile.bp_number ? `#${profile.bp_number} ` : '';
        const description = profile.bio
          ? String(profile.bio).trim().slice(0, 200)
          : `${name} driver profile — Blazing Pedals Truck Series Season 11.`;
        const image = profile.photoUrl || profile.photo_url || DEFAULT_SHARE_IMAGE;
        const pagePath = `/drivers/${encodeURIComponent(profile.driver_id)}`;
        const title = `${number}${name} — Blazing Pedals Truck Series`;
        const imageMeta = await resolveOgImageMeta({
          image,
          origin,
          alt: title,
        });
        const html = buildSharePreviewHtml({
          title,
          description,
          image: imageMeta.url,
          imageMeta,
          url: pagePath,
          redirectUrl: pagePath,
          type: 'profile',
          origin,
          linkLabel: 'View Profile',
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
        return res.status(200).send(html);
      }

      return res.status(200).json(profile);
    }

    return res.status(200).json(normalized);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = parseRequestBody(req);

  const adminAuth = validateAdminPassword(req, b);
  if (!adminAuth.ok) {
    return res.status(401).json(adminAuthFailurePayload(adminAuth));
  }

  const action = String(b.action || '').trim().toLowerCase();
  if (action === 'preview-form-sync' || action === 'apply-form-sync') {
    try {
      return await handleFormSyncAction(b, res);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Form sync failed.' });
    }
  }

  const sb = supabase();
  if (!sb) {
    return res.status(400).json({ error: 'Supabase not configured yet.' });
  }

  if (!b.driver_id) {
    return res.status(400).json({ error: 'Missing driver_id' });
  }

  if (!b.iracing_name) {
    return res.status(400).json({ error: 'iracing_name is required.' });
  }

  if ((b.car_number ?? '') !== '' && !normalizeCarNumber(b.car_number)) {
    return res.status(400).json({
      error: 'Car number must be 00 or 1 through 99. Number 0 is reserved for the pace car.',
    });
  }

  const row = buildUpsertRow(b);
  const writeContext = {
    requestBody: b,
    currentSourceDriver: {
      driver_id: String(b.driver_id || ''),
      iracing_customer_id: normalizeCustomerId(b.iracing_customer_id ?? b.iracingCustomerId) || null,
      display_name: b.display_name || b.iracing_name || null,
      source: inferDriverWriteSource(b),
    },
  };

  const postTrace = buildDriversWriteTrace(b, row, {
    operationName: 'POST /api/drivers',
    incomingDriverId: String(b.driver_id || ''),
    incomingIracingCustomerId: normalizeCustomerId(b.iracing_customer_id ?? b.iracingCustomerId) || null,
    writePathSelected: DRIVERS_WRITE_PATHS.POST_DRIVER_WRITE,
    currentFunction: 'handler:POST',
    currentSourceDriver: writeContext.currentSourceDriver,
    notes: ['post_handler_invoking_writeDriverProfile'],
  });
  logDriversWriteTrace(postTrace);

  const writeResult = await writeDriverProfile(sb, row, writeContext);
  const { data, error, instrumentation } = writeResult;

  if (error) {
    if (error.code === 'IDENTITY_CONFLICT') {
      return res.status(409).json({
        error: error.message,
        diagnostics: {
          instrumentationVersion: DRIVERS_WRITE_INSTRUMENTATION_VERSION,
          postTrace,
          finalPath: instrumentation?.finalPath || null,
          traces: instrumentation?.traces || [],
          identityConflict: instrumentation?.identityConflict || error.matches || null,
        },
      });
    }

    const duplicateKeyError =
      instrumentation?.duplicateKeyError ||
      (isDuplicateKeyError(error)
        ? buildDuplicateKeyDiagnostics(error, {
            attemptedDriverId: row.driver_id,
            attemptedIracingCustomerId: row.iracing_customer_id,
            insertPayload: row,
            writePathSelected: instrumentation?.finalPath || DRIVERS_WRITE_PATHS.POST_DRIVER_WRITE,
            currentFunction: 'handler:POST',
            currentSourceDriver: writeContext.currentSourceDriver,
          })
        : null);

    return res.status(500).json({
      error: `Supabase error: ${error.message}`,
      diagnostics: {
        instrumentationVersion: DRIVERS_WRITE_INSTRUMENTATION_VERSION,
        postTrace,
        finalPath: instrumentation?.finalPath || null,
        traces: instrumentation?.traces || [],
        duplicateKeyError,
        matchMethod: instrumentation?.matchMethod || null,
        operationTargetDriverId: instrumentation?.operationTargetDriverId || null,
      },
    });
  }

  const primaryTrace = instrumentation?.traces?.[instrumentation.traces.length - 1] || postTrace;

  return res.status(200).json({
    ...attachBpNumber(buildAdminDriverProfile(data), data, await loadBpNumberContext(sb)),
    diagnostics: {
      instrumentationVersion: DRIVERS_WRITE_INSTRUMENTATION_VERSION,
      postTrace,
      finalPath: instrumentation?.finalPath || DRIVERS_WRITE_PATHS.UPDATE_BY_RESOLVED_IDENTITY,
      traces: instrumentation?.traces || [],
      incomingDriverId: primaryTrace.incomingDriverId || String(b.driver_id || ''),
      incomingIracingCustomerId:
        primaryTrace.incomingIracingCustomerId ||
        normalizeCustomerId(b.iracing_customer_id ?? b.iracingCustomerId) ||
        null,
      existingProfileDriverId: primaryTrace.existingProfileDriverId || null,
      existingProfileSlug: primaryTrace.existingProfileSlug || null,
      matchMethod: instrumentation?.matchMethod || primaryTrace.matchMethod || null,
      operationChosen: primaryTrace.operationChosen || null,
      operationTargetDriverId:
        instrumentation?.operationTargetDriverId || primaryTrace.operationTargetDriverId || null,
      insertExecuted: instrumentation?.traces?.some((trace) => trace.insertExecuted) || false,
      updateExecuted: instrumentation?.traces?.some((trace) => trace.updateExecuted) || false,
    },
  });
}
