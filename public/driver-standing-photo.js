(function () {
  function stripUrlQuery(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    return value.split("?")[0].split("#")[0];
  }

  function cacheVersion(updatedAt) {
    if (!updatedAt) return null;
    const ms = new Date(updatedAt).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function withCacheBust(url, version) {
    const clean = stripUrlQuery(url);
    if (!clean) return clean;
    if (version == null || version === "") return clean;
    return `${clean}?v=${encodeURIComponent(version)}`;
  }

  function normalize(profile = {}) {
    const zoom = Number(profile.standingPhotoZoom ?? profile.standing_photo_zoom);
    const x = Number(profile.standingPhotoX ?? profile.standing_photo_x);
    const y = Number(profile.standingPhotoY ?? profile.standing_photo_y);
    return {
      standingPhotoUrl: stripUrlQuery(
        profile.standingPhotoUrl ?? profile.standing_photo_url ?? "",
      ),
      standingPhotoUpdatedAt:
        profile.standingPhotoUpdatedAt ?? profile.standing_photo_updated_at ?? null,
      standingPhotoZoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
      standingPhotoX: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
      standingPhotoY: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
    };
  }

  function hasStandingPhoto(profile = {}) {
    return Boolean(normalize(profile).standingPhotoUrl);
  }

  function displayUrl(profile = {}) {
    const data = normalize(profile);
    if (!data.standingPhotoUrl) return "";
    const version = cacheVersion(data.standingPhotoUpdatedAt) || Date.now();
    return withCacheBust(data.standingPhotoUrl, version);
  }

  function cropStyle(profile = {}, extra = {}) {
    const data = normalize({ ...profile, ...extra });
    return `--standing-zoom:${data.standingPhotoZoom};--standing-x:${data.standingPhotoX};--standing-y:${data.standingPhotoY};`;
  }

  window.BPDriverStandingPhoto = {
    normalize,
    hasStandingPhoto,
    displayUrl,
    cropStyle,
    withCacheBust,
  };
})();
