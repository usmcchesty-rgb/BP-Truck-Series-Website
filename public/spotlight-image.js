(function () {
  const PLACEHOLDER_URL = "/assets/drivers/placeholder.png";

  const SOURCE_LABELS = {
    "custom-spotlight": "Custom Spotlight Image",
    "standing-photo": "Standing Driver Photo",
    "driver-photo": "Driver Photo",
    placeholder: "Placeholder",
  };

  const PORTRAIT_SOURCES = new Set(["custom-spotlight", "standing-photo"]);

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

  function isPortraitDriverImage(displayImage = {}) {
    if (displayImage.isPortraitDriverImage === true) return true;
    return PORTRAIT_SOURCES.has(displayImage.source);
  }

  function standingCropStyle(displayImage = {}) {
    if (displayImage.source !== "standing-photo") return "";
    if (window.BPDriverStandingPhoto?.cropStyle) {
      return window.BPDriverStandingPhoto.cropStyle({
        standingPhotoZoom: displayImage.zoom,
        standingPhotoX: displayImage.x,
        standingPhotoY: displayImage.y,
      });
    }
    return `--standing-zoom:${displayImage.zoom ?? 1};--standing-x:${displayImage.x ?? 50};--standing-y:${displayImage.y ?? 50};`;
  }

  function portraitWrapClass(displayImage = {}) {
    const classes = ["news-spotlight-portrait-wrap"];
    if (displayImage.source === "standing-photo") {
      classes.push("news-spotlight-portrait-wrap--standing");
    }
    return classes.join(" ");
  }

  function buildDisplayImage(article = {}, driverProfile = null) {
    const resolved = resolveSpotlightImage(article, driverProfile);
    return {
      ...resolved,
      sourceLabel: sourceLabel(resolved.source),
      storedUrl: resolved.url,
      url: displayUrl(resolved),
      isPortraitDriverImage: PORTRAIT_SOURCES.has(resolved.source),
    };
  }

  function applyPortraitPreview(target, displayImage = {}, options = {}) {
    if (!target) return displayImage;
    const previewUrl = String(options.previewUrl || "").trim();
    const url = previewUrl || displayImage.url || PLACEHOLDER_URL;
    const wrapClass = portraitWrapClass(displayImage);
    const standingStyle = standingCropStyle(displayImage);

    target.className = `article-image-preview news-article-hero-wrap ${wrapClass}`;
    target.style.cssText = standingStyle;
    target.classList.remove("is-empty");

    let img = target.querySelector("img");
    if (!img) {
      target.textContent = "";
      img = document.createElement("img");
      img.className = "news-article-image news-spotlight-portrait-image";
      img.alt = options.alt || "Spotlight image preview";
      target.appendChild(img);
    } else {
      img.className = "news-article-image news-spotlight-portrait-image";
    }

    img.onerror = function () {
      this.onerror = null;
      this.src = PLACEHOLDER_URL;
    };
    if (img.src !== url) img.src = url;

    return displayImage;
  }

  function applyPreview(target, article = {}, driverProfile = null, options = {}) {
    if (!target) return null;
    const previewUrl = String(options.previewUrl || "").trim();
    const displayImage = buildDisplayImage(article, driverProfile);
    const resolved = previewUrl
      ? {
          ...displayImage,
          url: previewUrl,
          storedUrl: previewUrl,
          source: displayImage.source || "custom-spotlight",
          isPortraitDriverImage: true,
        }
      : displayImage;

    if (isPortraitDriverImage(resolved)) {
      return applyPortraitPreview(target, resolved, {
        previewUrl: previewUrl || displayImage.url,
        alt: options.alt,
      });
    }

    if (!window.NewsArticleImage) return displayImage;

    const imageShape = {
      featuredImageUrl: stripUrlQuery(resolved.storedUrl || resolved.url || ""),
      featuredImageUpdatedAt: resolved.updatedAt || null,
      featuredImageZoom: resolved.zoom ?? 1,
      featuredImageX: resolved.x ?? 50,
      featuredImageY: resolved.y ?? 50,
    };
    target.className = "article-image-preview";
    NewsArticleImage.applyPreview(target, imageShape, {
      previewUrl: previewUrl || displayImage.url,
      settings: imageShape,
    });
    return displayImage;
  }

  window.BPDriverSpotlightImage = {
    PLACEHOLDER_URL,
    SOURCE_LABELS,
    PORTRAIT_SOURCES,
    resolveSpotlightImage,
    buildDisplayImage,
    displayUrl,
    sourceLabel,
    isPortraitDriverImage,
    standingCropStyle,
    portraitWrapClass,
    applyPortraitPreview,
    applyPreview,
  };
})();
