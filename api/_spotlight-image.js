import {
  photoCacheVersion,
  slugify,
  stripPhotoUrlQuery,
  withPhotoCacheBust,
} from './_lib.js';

export const SPOTLIGHT_PLACEHOLDER_URL = '/assets/drivers/placeholder.png';

export const SPOTLIGHT_SOURCE_LABELS = {
  'custom-spotlight': 'Custom Spotlight Image',
  'standing-photo': 'Standing Driver Photo',
  'driver-photo': 'Driver Photo',
  placeholder: 'Placeholder',
};

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function clampAxis(value, fallback = 50) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : fallback;
}

function clampZoom(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function driverSlugPhotoUrl(driverProfile = {}) {
  const name =
    driverProfile.display_name ||
    driverProfile.displayName ||
    driverProfile.iracing_name ||
    driverProfile.iracingName ||
    driverProfile.driverName ||
    '';
  const slug = slugify(name);
  return slug ? `/assets/drivers/${slug}.png` : SPOTLIGHT_PLACEHOLDER_URL;
}

export function resolveSpotlightImage(article = {}, driverProfile = null) {
  const customUrl = stripPhotoUrlQuery(
    article.spotlightImageUrl ?? article.spotlight_image_url ?? ''
  );
  if (customUrl) {
    return {
      source: 'custom-spotlight',
      url: customUrl,
      updatedAt: article.spotlightImageUpdatedAt ?? article.spotlight_image_updated_at ?? null,
      zoom: 1,
      x: 50,
      y: 50,
    };
  }

  const standingUrl = stripPhotoUrlQuery(
    driverProfile?.standing_photo_url ?? driverProfile?.standingPhotoUrl ?? ''
  );
  const standingEnabled = normalizeBoolean(
    driverProfile?.standing_photo_enabled ?? driverProfile?.standingPhotoEnabled,
    true
  );
  if (standingUrl && standingEnabled) {
    return {
      source: 'standing-photo',
      url: standingUrl,
      updatedAt:
        driverProfile?.standing_photo_updated_at ??
        driverProfile?.standingPhotoUpdatedAt ??
        null,
      zoom: clampZoom(
        driverProfile?.standing_photo_zoom ?? driverProfile?.standingPhotoZoom
      ),
      x: clampAxis(driverProfile?.standing_photo_x ?? driverProfile?.standingPhotoX),
      y: clampAxis(driverProfile?.standing_photo_y ?? driverProfile?.standingPhotoY),
    };
  }

  const photoUrl = stripPhotoUrlQuery(
    driverProfile?.photo_url ?? driverProfile?.photoUrl ?? ''
  );
  if (photoUrl) {
    return {
      source: 'driver-photo',
      url: photoUrl,
      updatedAt: driverProfile?.updated_at ?? driverProfile?.updatedAt ?? null,
      zoom: 1,
      x: 50,
      y: 50,
    };
  }

  return {
    source: 'placeholder',
    url: SPOTLIGHT_PLACEHOLDER_URL,
    updatedAt: null,
    zoom: 1,
    x: 50,
    y: 50,
  };
}

export function spotlightDisplayUrl(resolved = {}) {
  const clean = stripPhotoUrlQuery(resolved.url || '');
  if (!clean) return SPOTLIGHT_PLACEHOLDER_URL;
  const version = photoCacheVersion(resolved.updatedAt) || Date.now();
  return withPhotoCacheBust(clean, version);
}

export function buildDisplayImage(article = {}, driverProfile = null) {
  const resolved = resolveSpotlightImage(article, driverProfile);
  return {
    ...resolved,
    sourceLabel: SPOTLIGHT_SOURCE_LABELS[resolved.source] || 'Placeholder',
    storedUrl: resolved.url,
    url: spotlightDisplayUrl(resolved),
  };
}

export async function enrichSpotlightArticles(articles, profiles = null) {
  const list = Array.isArray(articles) ? articles : [];
  const spotlightArticles = list.filter(
    (article) => article.articleType === 'driver-spotlight'
  );
  if (!spotlightArticles.length) return list;

  let driverProfiles = profiles;
  if (!driverProfiles) {
    const { getDriverProfiles } = await import('./_lib.js');
    driverProfiles = await getDriverProfiles();
  }

  const byDriverId = Object.fromEntries(
    (driverProfiles || []).map((profile) => [String(profile.driver_id), profile])
  );

  return list.map((article) => {
    if (article.articleType !== 'driver-spotlight') return article;
    const driverProfile = article.spotlightDriverId
      ? byDriverId[String(article.spotlightDriverId)] || null
      : null;
    return {
      ...article,
      displayImage: buildDisplayImage(article, driverProfile),
    };
  });
}
