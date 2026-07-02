import { getDriverProfiles, supabase, slugify, stripPhotoUrlQuery, withPhotoCacheBust, photoCacheVersion } from './_lib.js';
import { buildAvailableNumberSummaryFromDb } from './_driver-number-reservations.js';
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

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
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

function normalizeLookupName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function twitterHandleFromUrl(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.startsWith('@')) return text.slice(1);
  const match = text.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
  return match?.[1]?.replace(/^@/, '') || '';
}

function findDriverProfile(profiles, queryId) {
  const raw = String(queryId ?? '').trim();
  if (!raw) return null;

  let match = profiles.find((row) => String(row.driver_id) === raw);
  if (match) return match;

  const lookupName = normalizeLookupName(raw);
  const lookupSlug = slugify(raw.replace(/^@/, ''));

  if (raw.startsWith('@')) {
    const handle = raw.slice(1).toLowerCase();
    match = profiles.find((row) => {
      const twitter = String(row.twitter_url || row.twitterUrl || '').trim().toLowerCase();
      const twitterHandle = twitterHandleFromUrl(twitter);
      return (
        twitter === raw.toLowerCase() ||
        twitter.includes(`/${handle}`) ||
        twitter.includes(`@${handle}`) ||
        twitterHandle === handle
      );
    });
    if (match) return match;

    match = profiles.find((row) => {
      const names = [row.display_name, row.iracing_name].map(normalizeLookupName);
      return names.includes(handle) || names.includes(lookupName);
    });
    if (match) return match;
  }

  match = profiles.find((row) => {
    const names = [row.display_name, row.iracing_name].map(normalizeLookupName);
    return names.includes(lookupName);
  });
  if (match) return match;

  if (lookupSlug) {
    match = profiles.find(
      (row) =>
        slugify(row.display_name || row.iracing_name || '') === lookupSlug ||
        slugify(row.driver_id || '') === lookupSlug
    );
    if (match) return match;
  }

  return null;
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

function adminPasswordFromRequest(req, body = {}) {
  const header =
    req.headers['x-admin-password'] ||
    req.headers['X-Admin-Password'] ||
    req.headers['x-admin-password'.toLowerCase()];
  return String(header || body.password || req.query?.password || '').trim();
}

function isAdminDriversRequest(req, body = {}) {
  return adminPasswordFromRequest(req, body) === process.env.ADMIN_PASSWORD;
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
    car_number: row.car_number || row.truck_number || '',
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

export function stripPrivateDriverProfileFields(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const sanitized = { ...profile };
  delete sanitized.form_email;
  delete sanitized.formEmail;
  delete sanitized.form_submitted_at;
  delete sanitized.formSubmittedAt;
  delete sanitized.form_permission_granted;
  delete sanitized.formPermissionGranted;
  return sanitized;
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
    iracing_customer_id: normalizeCustomerId(b.iracing_customer_id ?? b.iracingCustomerId),
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

function isConflictConstraintError(error) {
  const msg = error?.message || '';
  return /on conflict|no unique|exclusion constraint|constraint matching/i.test(msg);
}

async function upsertDriver(sb, row) {
  const byDriverId = await sb
    .from('driver_profiles')
    .upsert(row, { onConflict: 'driver_id' })
    .select()
    .single();

  if (!byDriverId.error) return byDriverId;

  if (!isConflictConstraintError(byDriverId.error)) {
    return byDriverId;
  }

  return sb
    .from('driver_profiles')
    .upsert(row, { onConflict: 'slug' })
    .select()
    .single();
}

async function handleFormSyncAction(b, res) {
  const sb = supabase();
  if (!sb) {
    return res.status(400).json({ error: 'Supabase not configured yet.' });
  }

  const profiles = await getDriverProfiles();
  const sheetData = await fetchGoogleFormResponses();
  const preview = buildFormSyncPreview(profiles, sheetData);

  if (b.action === 'preview-form-sync') {
    return res.status(200).json(preview);
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
    return res.status(200).json({ ...preview, applyResult: result });
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
    const normalized = rows
      .map(normalizeProfile)
      .filter(Boolean)
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
      const profile = findDriverProfile(normalized, driverId);
      if (!profile) {
        return res.status(404).json({ error: 'Driver not found.' });
      }

      if (format === 'html') {
        const origin = getSiteOrigin(req);
        const name = profile.display_name || profile.iracing_name || 'Driver';
        const number = profile.car_number ? `#${profile.car_number} ` : '';
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

  const b = parseBody(req);

  if (b.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Bad password' });
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
  const { data, error } = await upsertDriver(sb, row);

  if (error) {
    return res.status(500).json({ error: `Supabase error: ${error.message}` });
  }

  return res.status(200).json(buildAdminDriverProfile(data));
}
