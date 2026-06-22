// Shared Fantasy branding URL helpers — safe on public page and admin (no page init).

const FANTASY_DEFAULT_HERO_URLS = [
  '/assets/fantasy/hero-background.jpg',
  '/assets/fantasy/hero-background.png',
];

const FANTASY_DEFAULT_LOGO_URLS = [
  '/assets/fantasy/fantasy-logo.png',
  '/assets/fantasy/fantasy-logo.jpg',
];

function stripPhotoUrlQuery(photoUrl) {
  const url = String(photoUrl || '').trim();
  if (!url) return '';
  return url.split('?')[0].split('#')[0];
}

function photoCacheVersion(updatedAt) {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function withPhotoCacheBust(photoUrl, version) {
  const clean = stripPhotoUrlQuery(photoUrl);
  if (!clean) return clean;
  if (version == null || version === '') return clean;
  return `${clean}?v=${encodeURIComponent(version)}`;
}

function uniqueImageCandidates(urls) {
  const seen = new Set();
  const result = [];
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url) continue;
    const key = stripPhotoUrlQuery(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

function resolveFantasyHeroBackgroundCandidates(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeroBackgroundUrl || '');
  if (stored) {
    const version = photoCacheVersion(settings.fantasyHeroBackgroundUpdatedAt) || Date.now();
    return uniqueImageCandidates([
      withPhotoCacheBust(stored, version),
      ...FANTASY_DEFAULT_HERO_URLS,
    ]);
  }
  return [...FANTASY_DEFAULT_HERO_URLS];
}

function resolveFantasyHeaderLogoCandidates(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeaderLogoUrl || '');
  if (stored) {
    const version = photoCacheVersion(settings.fantasyHeaderLogoUpdatedAt) || Date.now();
    return uniqueImageCandidates([
      withPhotoCacheBust(stored, version),
      ...FANTASY_DEFAULT_LOGO_URLS,
    ]);
  }
  return [...FANTASY_DEFAULT_LOGO_URLS];
}

function resolveFantasyHeroBackgroundDisplayUrl(settings = {}) {
  return resolveFantasyHeroBackgroundCandidates(settings)[0] || '';
}

function resolveFantasyHeaderLogoDisplayUrl(settings = {}) {
  return resolveFantasyHeaderLogoCandidates(settings)[0] || '';
}

function loadFirstAvailableImageUrl(urls) {
  const list = (Array.isArray(urls) ? urls : [urls])
    .map((url) => String(url || '').trim())
    .filter(Boolean);

  return new Promise((resolve) => {
    if (!list.length) {
      resolve('');
      return;
    }

    let index = 0;
    const tryNext = () => {
      if (index >= list.length) {
        resolve('');
        return;
      }

      const url = list[index];
      index += 1;
      const probe = new Image();
      probe.onload = () => resolve(url);
      probe.onerror = () => tryNext();
      probe.src = url;
    };

    tryNext();
  });
}

function computePublicLogoWidthPx(placement = {}, viewportWidth) {
  const widthPercent = Number(placement.fantasyHeaderLogoWidthVw);
  const maxWidthPx = Number(placement.fantasyHeaderLogoMaxWidthPx);
  const pct = Number.isFinite(widthPercent) ? widthPercent : 32;
  const maxPx = Number.isFinite(maxWidthPx) ? maxWidthPx : 560;
  const viewport = viewportWidth > 0 ? viewportWidth : 1200;
  return Math.min((pct / 100) * viewport, maxPx);
}

function computePreviewLogoWidthPx(placement = {}, previewWidth, viewportWidth) {
  const preview = previewWidth > 0 ? previewWidth : 720;
  const viewport = viewportWidth > 0 ? viewportWidth : preview;
  const publicLogoPx = computePublicLogoWidthPx(placement, viewport);
  return (publicLogoPx / viewport) * preview;
}

function applyImageFromCandidates(img, candidates, callbacks = {}) {
  if (!img) return Promise.resolve('');

  return loadFirstAvailableImageUrl(candidates).then((url) => {
    if (url) {
      img.src = url;
      img.removeAttribute('hidden');
      callbacks.onLoaded?.(url, img);
    } else {
      img.removeAttribute('src');
      img.setAttribute('hidden', '');
      callbacks.onMissing?.(img);
    }
    return url;
  });
}

window.BPFantasyBrandingAssets = {
  defaultHeroUrls: FANTASY_DEFAULT_HERO_URLS,
  defaultLogoUrls: FANTASY_DEFAULT_LOGO_URLS,
  stripPhotoUrlQuery,
  photoCacheVersion,
  withPhotoCacheBust,
  resolveFantasyHeroBackgroundCandidates,
  resolveFantasyHeaderLogoCandidates,
  resolveFantasyHeroBackgroundDisplayUrl,
  resolveFantasyHeaderLogoDisplayUrl,
  loadFirstAvailableImageUrl,
  applyImageFromCandidates,
  computePublicLogoWidthPx,
  computePreviewLogoWidthPx,
};
