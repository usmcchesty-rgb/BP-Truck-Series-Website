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

function resolveFantasyHeroBackgroundCandidates(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeroBackgroundUrl || '');
  if (stored) {
    const version = photoCacheVersion(settings.fantasyHeroBackgroundUpdatedAt) || Date.now();
    return [withPhotoCacheBust(stored, version)];
  }
  return [...FANTASY_DEFAULT_HERO_URLS];
}

function resolveFantasyHeaderLogoCandidates(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeaderLogoUrl || '');
  if (stored) {
    const version = photoCacheVersion(settings.fantasyHeaderLogoUpdatedAt) || Date.now();
    return [withPhotoCacheBust(stored, version)];
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

function applyImageFromCandidates(img, candidates, callbacks = {}) {
  if (!img) return Promise.resolve('');

  return loadFirstAvailableImageUrl(candidates).then((url) => {
    if (url) {
      img.src = url;
      if (Object.prototype.hasOwnProperty.call(img, 'hidden')) img.hidden = false;
      callbacks.onLoaded?.(url, img);
    } else {
      img.removeAttribute('src');
      if (Object.prototype.hasOwnProperty.call(img, 'hidden')) img.hidden = true;
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
};
