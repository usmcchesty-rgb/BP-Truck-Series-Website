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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalize(article = {}) {
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

  function cropStyle(article = {}, extra = {}) {
    const data = normalize({ ...article, ...extra });
    return `--img-zoom:${data.featuredImageZoom};--img-x:${data.featuredImageX};--img-y:${data.featuredImageY};`;
  }

  function renderImageHtml(article = {}, options = {}) {
    const previewUrl = String(options.previewUrl || "").trim();
    const url = previewUrl || displayUrl(article);
    if (!url) return options.placeholderHtml || "";

    const wrapClass = options.wrapClass || "news-article-image-wrap";
    const imgClass = options.imgClass || "news-article-image-el";
    const alt = escapeHtml(options.alt || article.headline || "Article image");
    const style = cropStyle(article, options.settings);
    const onerror =
      article.articleType === "driver-spotlight"
        ? ' onerror="this.onerror=null;this.src=\'/assets/drivers/placeholder.png\'"'
        : "";

    return `<div class="${wrapClass}" style="${style}"><img class="${imgClass}" src="${escapeHtml(url)}" alt="${alt}"${onerror}></div>`;
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
    const url = previewUrl || displayUrl(article);
    const style = cropStyle(article, options.settings);
    target.style.cssText = style;

    if (url) {
      target.classList.remove("is-empty");
      let img = target.querySelector("img");
      if (!img) {
        target.textContent = "";
        img = document.createElement("img");
        img.alt = "Article image preview";
        target.appendChild(img);
      }
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
    normalize,
    hasImage,
    displayUrl,
    cropStyle,
    renderFeaturedMedia,
    renderCardMedia,
    renderArticleHero,
    renderImageHtml,
    applyPreview,
  };
})();
