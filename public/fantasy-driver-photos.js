(function () {
  const PLACEHOLDER_PHOTO = '/assets/drivers/placeholder.png';

  function escapeAttr(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  function normalizeLookupName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function nameMatchKeys(name) {
    const normalized = normalizeLookupName(name);
    const keys = new Set([normalized]);
    const noSuffix = normalized.replace(/(\D)\d+$/, '$1').trim();
    if (noSuffix) keys.add(noSuffix);
    return [...keys];
  }

  function driverSlugImage(name) {
    const slug = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return slug ? `/assets/drivers/${slug}.png` : '';
  }

  function driverSlugImageStripSuffix(name) {
    const slug = driverSlugImage(name);
    const stripped = slug.replace(/-\d+$/, '');
    return stripped && stripped !== slug ? stripped : '';
  }

  function findProfileByName(profiles, name, driverId) {
    if (!Array.isArray(profiles) || !profiles.length) return null;

    if (driverId) {
      const match = profiles.find((row) => String(row.driver_id) === String(driverId));
      if (match) return match;
    }

    const lookupKeys = nameMatchKeys(name);
    if (!lookupKeys.length) return null;

    return (
      profiles.find((row) => {
        const rowKeys = [row.display_name, row.iracing_name, row.driver_name].flatMap((field) =>
          nameMatchKeys(field)
        );
        return lookupKeys.some((key) => rowKeys.includes(key));
      }) || null
    );
  }

  async function resolveDriverProfile(fantasyDriver = {}, queryId = '', queryName = '') {
    const name = fantasyDriver.driverName || queryName || '';
    const id = fantasyDriver.driverId || fantasyDriver.id || fantasyDriver.driver_id || queryId || '';

    if (id) {
      try {
        const res = await fetch(`/api/drivers?driver_id=${encodeURIComponent(id)}`);
        if (res.ok) {
          const profile = await res.json();
          if (profile?.driver_id) return profile;
        }
      } catch {
        /* fall through */
      }
    }

    if (name || id) {
      try {
        const res = await fetch('/api/drivers');
        if (res.ok) {
          const profiles = await res.json();
          return findProfileByName(Array.isArray(profiles) ? profiles : [], name, id);
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  function resolveDriverPhotoUrl(profile, name) {
    return profile?.photoUrl || profile?.photo_url || driverSlugImage(name) || PLACEHOLDER_PHOTO;
  }

  function buildPhotoSources(profile, name) {
    const sources = [];
    const apiUrl = profile?.photoUrl || profile?.photo_url;
    if (apiUrl) sources.push(apiUrl);

    const slug = driverSlugImage(name);
    const slugAlt = driverSlugImageStripSuffix(name);

    [slug, slugAlt].forEach((src) => {
      if (src && !sources.includes(src)) sources.push(src);
    });

    if (!sources.length) sources.push(PLACEHOLDER_PHOTO);
    return sources;
  }

  function handleImageError(img) {
    if (!img) return;
    const fallbacks = String(img.dataset.fantasyPhotoSlugs || '')
      .split('|')
      .filter(Boolean);
    const tried = Number(img.dataset.fantasyPhotoTried || '0');

    if (tried < fallbacks.length) {
      img.dataset.fantasyPhotoTried = String(tried + 1);
      img.src = fallbacks[tried];
      return;
    }

    img.onerror = null;
    img.src = img.dataset.fantasyPhotoPlaceholder || PLACEHOLDER_PHOTO;
  }

  function renderDriverPhotoImg({ profile, name, className = '', alt = '' }) {
    const sources = buildPhotoSources(profile, name);
    const primary = sources[0] || PLACEHOLDER_PHOTO;
    const fallbacks = sources.slice(1).join('|');
    const cls = className ? ` class="${escapeAttr(className)}"` : '';

    return `<img${cls} src="${escapeAttr(primary)}" alt="${escapeAttr(alt || name)}" data-fantasy-photo-slugs="${escapeAttr(fallbacks)}" data-fantasy-photo-placeholder="${PLACEHOLDER_PHOTO}" data-fantasy-photo-tried="0" onerror="BPFantasyDriverPhotos.handleImageError(this)" />`;
  }

  window.BPFantasyDriverPhotos = {
    PLACEHOLDER_PHOTO,
    normalizeLookupName,
    nameMatchKeys,
    driverSlugImage,
    driverSlugImageStripSuffix,
    findProfileByName,
    resolveDriverProfile,
    resolveDriverPhotoUrl,
    buildPhotoSources,
    handleImageError,
    renderDriverPhotoImg,
  };
})();
