(function () {
  const DISPLAY_FILL = "fill";
  const DISPLAY_CONTAIN = "contain";
  const WRAP_FILL_CLASS = "news-image-wrap--fill";
  const WRAP_CONTAIN_CLASS = "news-image-wrap--contain";
  const IMG_FILL_CLASS = "news-image--fill";
  const IMG_CONTAIN_CLASS = "news-image--contain";

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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeDisplayMode(article = {}) {
    const raw = String(
      article.featuredImageDisplayMode ?? article.featured_image_display_mode ?? DISPLAY_FILL,
    )
      .trim()
      .toLowerCase();
    return raw === DISPLAY_CONTAIN ? DISPLAY_CONTAIN : DISPLAY_FILL;
  }

  function isContainMode(article = {}) {
    return normalizeDisplayMode(article) === DISPLAY_CONTAIN;
  }

  function mergeArticle(article = {}, extra = {}) {
    return { ...article, ...extra };
  }

  function modeClasses(article = {}) {
    const contain = isContainMode(article);
    return {
      contain,
      wrapClass: contain ? WRAP_CONTAIN_CLASS : WRAP_FILL_CLASS,
      imgClass: contain ? IMG_CONTAIN_CLASS : IMG_FILL_CLASS,
    };
  }

  function isDriverSpotlightArticle(article = {}) {
    return article.articleType === "driver-spotlight";
  }

  function isSpotlightPortrait(article = {}) {
    if (!isDriverSpotlightArticle(article)) return false;
    if (!hasImage(article)) return false;
    const displayImage = article.displayImage;
    if (!displayImage) return true;
    if (window.BPDriverSpotlightImage?.isPortraitDriverImage) {
      return window.BPDriverSpotlightImage.isPortraitDriverImage(displayImage);
    }
    return (
      displayImage.isPortraitDriverImage === true ||
      displayImage.source === "custom-spotlight" ||
      displayImage.source === "standing-photo" ||
      displayImage.source === "driver-photo"
    );
  }

  function normalize(article = {}) {
    const displayMode = normalizeDisplayMode(article);

    if (article.displayImage?.url) {
      const zoom = Number(article.displayImage.zoom);
      const x = Number(article.displayImage.x);
      const y = Number(article.displayImage.y);
      return {
        featuredImageUrl: stripUrlQuery(
          article.displayImage.storedUrl || article.displayImage.url || "",
        ),
        featuredImageUpdatedAt: article.displayImage.updatedAt || null,
        featuredImageZoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
        featuredImageX: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
        featuredImageY: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
        featuredImageDisplayMode: displayMode,
        displayImage: article.displayImage,
      };
    }

    const zoom = Number(article.featuredImageZoom ?? article.featured_image_zoom);
    const x = Number(article.featuredImageX ?? article.featured_image_x);
    const y = Number(article.featuredImageY ?? article.featured_image_y);
    return {
      featuredImageUrl: stripUrlQuery(
        article.featuredImageUrl ?? article.featured_image_url ?? "",
      ),
      featuredImageUpdatedAt:
        article.featuredImageUpdatedAt ?? article.featured_image_updated_at ?? null,
      featuredImageZoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
      featuredImageX: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
      featuredImageY: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
      featuredImageDisplayMode: displayMode,
      displayImage: article.displayImage || null,
    };
  }

  function displayUrl(article = {}) {
    const data = normalize(article);
    if (!data.featuredImageUrl) return "";
    const version = cacheVersion(data.featuredImageUpdatedAt) || Date.now();
    return withCacheBust(data.featuredImageUrl, version);
  }

  function hasImage(article = {}) {
    return Boolean(normalize(article).featuredImageUrl);
  }

  function wrapClassForMode(baseClass, article = {}) {
    const mode = modeClasses(article);
    return [baseClass, mode.wrapClass].filter(Boolean).join(" ");
  }

  function imgClassForMode(baseClass, article = {}) {
    const mode = modeClasses(article);
    return [baseClass, mode.imgClass].filter(Boolean).join(" ");
  }

  function cropStyle(article = {}, extra = {}) {
    const merged = mergeArticle(article, extra);
    if (isContainMode(merged)) return "";
    const data = normalize(merged);
    return `--img-zoom:${data.featuredImageZoom};--img-x:${data.featuredImageX};--img-y:${data.featuredImageY};`;
  }

  function applyModeClasses(target, article = {}, img = null) {
    if (!target) return;
    const mode = modeClasses(article);
    target.classList.toggle(WRAP_CONTAIN_CLASS, mode.contain);
    target.classList.toggle(WRAP_FILL_CLASS, !mode.contain);
    if (img) {
      img.classList.toggle(IMG_CONTAIN_CLASS, mode.contain);
      img.classList.toggle(IMG_FILL_CLASS, !mode.contain);
    }
  }

  function standingCropStyle(displayImage = {}) {
    if (window.BPDriverSpotlightImage?.standingCropStyle) {
      return window.BPDriverSpotlightImage.standingCropStyle(displayImage);
    }
    if (window.BPDriverStandingPhoto?.cropStyle) {
      return window.BPDriverStandingPhoto.cropStyle({
        standingPhotoZoom: displayImage.zoom,
        standingPhotoX: displayImage.x,
        standingPhotoY: displayImage.y,
      });
    }
    return "";
  }

  function portraitWrapClass(displayImage = {}) {
    if (window.BPDriverSpotlightImage?.portraitWrapClass) {
      return window.BPDriverSpotlightImage.portraitWrapClass(displayImage);
    }
    const classes = ["news-spotlight-portrait-wrap"];
    if (displayImage.source === "standing-photo") {
      classes.push("news-spotlight-portrait-wrap--standing");
    }
    return classes.join(" ");
  }

  function renderPortraitImageHtml(article = {}, options = {}) {
    const previewUrl = String(options.previewUrl || "").trim();
    const displayImage = article.displayImage || {};
    const url = previewUrl || displayUrl(article);
    if (!url) return options.placeholderHtml || "";

    const wrapClass = [
      options.wrapClass || "news-article-hero-wrap",
      portraitWrapClass(displayImage),
    ].join(" ");
    const imgClass = `${options.imgClass || "news-article-image"} news-spotlight-portrait-image`;
    const alt = escapeHtml(options.alt || article.headline || "Article image");
    const onerror =
      article.articleType === "driver-spotlight"
        ? ' onerror="this.onerror=null;this.src=\'/assets/drivers/placeholder.png\'"'
        : "";

    return `<div class="${wrapClass}"><img class="${imgClass}" src="${escapeHtml(url)}" alt="${alt}"${onerror}></div>`;
  }

  function renderImageHtml(article = {}, options = {}) {
    const previewUrl = String(options.previewUrl || "").trim();
    const merged = mergeArticle(article, options.settings || {});
    const normalized = normalize(merged);
    const renderArticle = mergeArticle(merged, normalized);
    const url = previewUrl || displayUrl(renderArticle);
    if (!url) return options.placeholderHtml || "";

    const wrapClass = wrapClassForMode(
      options.wrapClass || "news-article-image-wrap",
      renderArticle,
    );
    const imgClass = imgClassForMode(options.imgClass || "news-article-image-el", renderArticle);
    const alt = escapeHtml(options.alt || article.headline || "Article image");
    const style = cropStyle(renderArticle);
    const onerror =
      article.articleType === "driver-spotlight"
        ? ' onerror="this.onerror=null;this.src=\'/assets/drivers/placeholder.png\'"'
        : "";

    return `<div class="${wrapClass}"${style ? ` style="${style}"` : ""}><img class="${imgClass}" src="${escapeHtml(url)}" alt="${alt}"${onerror}></div>`;
  }

  function renderFeaturedMedia(article = {}, options = {}) {
    if (!hasImage(article) && !options.previewUrl) {
      return `<div class="news-featured-placeholder" aria-hidden="true"></div>`;
    }
    return renderImageHtml(article, {
      wrapClass: "news-featured-image-wrap",
      imgClass: "news-featured-image",
      alt: article.headline || "Featured article",
      ...options,
    });
  }

  function renderCardMedia(article = {}, options = {}) {
    if (!hasImage(article) && !options.previewUrl) {
      return `<div class="news-card-thumb" aria-hidden="true"><span>BP</span></div>`;
    }
    return renderImageHtml(article, {
      wrapClass: "news-card-image-wrap",
      imgClass: "news-card-image",
      alt: article.headline || "Article image",
      ...options,
    });
  }

  function renderArticleHero(article = {}, options = {}) {
    if (!hasImage(article) && !options.previewUrl) return "";
    if (isDriverSpotlightArticle(article)) {
      return renderPortraitImageHtml(article, {
        wrapClass: "news-article-hero-wrap",
        imgClass: "news-article-image",
        alt: article.headline || "Article image",
        ...options,
      });
    }
    return renderImageHtml(article, {
      wrapClass: "news-article-hero-wrap",
      imgClass: "news-article-image",
      alt: article.headline || "Article image",
      ...options,
    });
  }

  function applyPreview(target, article = {}, options = {}) {
    if (!target) return;
    const previewUrl = String(options.previewUrl || "").trim();
    const merged = mergeArticle(article, options.settings || {});
    const normalized = normalize(merged);
    const renderArticle = mergeArticle(merged, normalized);
    const url = previewUrl || displayUrl(renderArticle);

    applyModeClasses(target, renderArticle);
    if (isContainMode(renderArticle)) {
      target.style.cssText = "";
    } else {
      target.style.cssText = cropStyle(renderArticle);
    }

    if (url) {
      target.classList.remove("is-empty");
      let img = target.querySelector("img");
      if (!img) {
        target.textContent = "";
        img = document.createElement("img");
        img.alt = "Article image preview";
        target.appendChild(img);
      }
      applyModeClasses(target, renderArticle, img);
      img.onerror = function () {
        this.onerror = null;
        this.src = "/assets/drivers/placeholder.png";
      };
      if (img.src !== url) img.src = url;
    } else {
      const img = target.querySelector("img");
      if (img) img.remove();
      target.classList.add("is-empty");
      target.textContent = "No image";
    }
  }

  window.NewsArticleImage = {
    DISPLAY_FILL,
    DISPLAY_CONTAIN,
    WRAP_FILL_CLASS,
    WRAP_CONTAIN_CLASS,
    IMG_FILL_CLASS,
    IMG_CONTAIN_CLASS,
    normalize,
    normalizeDisplayMode,
    isContainMode,
    modeClasses,
    hasImage,
    displayUrl,
    cropStyle,
    wrapClassForMode,
    imgClassForMode,
    applyModeClasses,
    isDriverSpotlightArticle,
    isSpotlightPortrait,
    renderFeaturedMedia,
    renderCardMedia,
    renderArticleHero,
    renderImageHtml,
    renderPortraitImageHtml,
    applyPreview,
  };
  window.BPNewsArticleImage = window.NewsArticleImage;
})();
