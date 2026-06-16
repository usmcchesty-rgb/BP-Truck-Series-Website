(function () {
  const PLACEHOLDER_URL = "/assets/drivers/placeholder.png";

  const SOURCE_LABELS = {
    "custom-spotlight": "Custom Spotlight Image",
    "standing-photo": "Standing Driver Photo",
    "driver-photo": "Driver Photo",
    placeholder: "Placeholder",
  };

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

  function isStandingEnabled(profile = {}) {
    const enabled = profile.standingPhotoEnabled ?? profile.standing_photo_enabled;
    return enabled !== false;
  }

  function standingNormalize(profile = {}) {
    if (window.BPDriverStandingPhoto?.normalize) {
      return window.BPDriverStandingPhoto.normalize(profile);
    }
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

  function driverSlugPhotoUrl(profile = {}) {
    const name =
      profile.display_name ||
      profile.displayName ||
      profile.iracing_name ||
      profile.iracingName ||
      "";
    const slug = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return slug ? `/assets/drivers/${slug}.png` : PLACEHOLDER_URL;
  }

  function resolveSpotlightImage(article = {}, driverProfile = null) {
    const customUrl = stripUrlQuery(
      article.spotlightImageUrl ?? article.spotlight_image_url ?? "",
    );
    if (customUrl) {
      return {
        source: "custom-spotlight",
        url: customUrl,
        updatedAt:
          article.spotlightImageUpdatedAt ?? article.spotlight_image_updated_at ?? null,
        zoom: 1,
        x: 50,
        y: 50,
      };
    }

    const standing = standingNormalize(driverProfile || {});
    if (standing.standingPhotoUrl && isStandingEnabled(driverProfile || {})) {
      return {
        source: "standing-photo",
        url: standing.standingPhotoUrl,
        updatedAt: standing.standingPhotoUpdatedAt,
        zoom: standing.standingPhotoZoom,
        x: standing.standingPhotoX,
        y: standing.standingPhotoY,
      };
    }

    const photoUrl = stripUrlQuery(
      driverProfile?.photoUrl ?? driverProfile?.photo_url ?? "",
    );
    if (photoUrl) {
      return {
        source: "driver-photo",
        url: photoUrl,
        updatedAt: driverProfile?.updated_at ?? driverProfile?.updatedAt ?? null,
        zoom: 1,
        x: 50,
        y: 50,
      };
    }

    return {
      source: "placeholder",
      url: PLACEHOLDER_URL,
      updatedAt: null,
      zoom: 1,
      x: 50,
      y: 50,
    };
  }

  function displayUrl(resolved = {}) {
    const clean = stripUrlQuery(resolved.url || "");
    if (!clean) return PLACEHOLDER_URL;
    const version = cacheVersion(resolved.updatedAt) || Date.now();
    return withCacheBust(clean, version);
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || SOURCE_LABELS.placeholder;
  }

  function buildDisplayImage(article = {}, driverProfile = null) {
    const resolved = resolveSpotlightImage(article, driverProfile);
    return {
      ...resolved,
      sourceLabel: sourceLabel(resolved.source),
      storedUrl: resolved.url,
      url: displayUrl(resolved),
    };
  }

  function toNewsArticleImageShape(displayImage = {}) {
    return {
      featuredImageUrl: stripUrlQuery(displayImage.storedUrl || displayImage.url || ""),
      featuredImageUpdatedAt: displayImage.updatedAt || null,
      featuredImageZoom: displayImage.zoom ?? 1,
      featuredImageX: displayImage.x ?? 50,
      featuredImageY: displayImage.y ?? 50,
    };
  }

  function applyPreview(target, article = {}, driverProfile = null, options = {}) {
    if (!target || !window.NewsArticleImage) return null;
    const previewUrl = String(options.previewUrl || "").trim();
    const displayImage = buildDisplayImage(article, driverProfile);
    const imageShape = toNewsArticleImageShape(
      previewUrl
        ? {
            ...displayImage,
            url: previewUrl,
            storedUrl: previewUrl,
          }
        : displayImage,
    );
    NewsArticleImage.applyPreview(target, imageShape, {
      previewUrl: previewUrl || displayImage.url,
      settings: imageShape,
    });
    return displayImage;
  }

  window.BPDriverSpotlightImage = {
    PLACEHOLDER_URL,
    SOURCE_LABELS,
    resolveSpotlightImage,
    buildDisplayImage,
    displayUrl,
    sourceLabel,
    toNewsArticleImageShape,
    applyPreview,
  };
})();
