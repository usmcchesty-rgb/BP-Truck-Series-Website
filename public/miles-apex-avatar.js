(function () {
  const DEFAULTS = {
    milesApexImageUrl: "",
    milesApexImageUpdatedAt: null,
    milesApexImageZoom: 1,
    milesApexImageX: 50,
    milesApexImageY: 50,
  };

  let cachedSettings = null;

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

  function normalizeSettings(settings = {}) {
    const zoom = Number(settings.milesApexImageZoom);
    const x = Number(settings.milesApexImageX);
    const y = Number(settings.milesApexImageY);
    return {
      milesApexImageUrl: stripUrlQuery(settings.milesApexImageUrl || ""),
      milesApexImageUpdatedAt: settings.milesApexImageUpdatedAt || null,
      milesApexImageZoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
      milesApexImageX: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
      milesApexImageY: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
    };
  }

  function displayUrl(settings = {}) {
    const normalized = normalizeSettings(settings);
    if (!normalized.milesApexImageUrl) return "";
    const version =
      cacheVersion(normalized.milesApexImageUpdatedAt) || Date.now();
    return withCacheBust(normalized.milesApexImageUrl, version);
  }

  function cropStyle(settings = {}) {
    const crop = normalizeSettings(settings);
    return `--avatar-zoom:${crop.milesApexImageZoom};--avatar-x:${crop.milesApexImageX};--avatar-y:${crop.milesApexImageY};`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAvatarHtml(settings = {}, options = {}) {
    const sizeClass = options.size ? ` miles-apex-avatar--${options.size}` : "";
    const style = cropStyle(settings);
    const url = displayUrl(settings);
    if (url) {
      return `<span class="miles-apex-avatar${sizeClass}" style="${style}"><img src="${escapeHtml(url)}" alt="${escapeHtml(options.alt || "Miles Apex")}"></span>`;
    }
    return `<span class="miles-apex-avatar miles-apex-avatar--initials${sizeClass}" aria-hidden="true">MA</span>`;
  }

  function readTimeMinutes(text) {
    const words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (!words) return 1;
    return Math.max(1, Math.ceil(words / 225));
  }

  function formatShortDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatReadTime(minutes) {
    const mins = Math.max(1, Number(minutes) || 1);
    return `${mins} min read`;
  }

  function articleReadMinutes(article = {}) {
    const text = [article.headline, article.subheadline, article.summary, article.body]
      .filter(Boolean)
      .join(" ");
    return readTimeMinutes(text);
  }

  function renderByline(settings = {}, options = {}) {
    const author = options.author || "Miles Apex";
    const date = options.date ? formatShortDate(options.date) : "";
    const readTime = options.readMinutes
      ? formatReadTime(options.readMinutes)
      : options.readTime || "";
    const parts = [author, date, readTime].filter(Boolean);
    return `
      <div class="news-byline">
        ${renderAvatarHtml(settings, { size: options.avatarSize, alt: author })}
        <span class="news-byline-text">${parts.map((part) => `<span>${escapeHtml(part)}</span>`).join('<span class="news-byline-sep" aria-hidden="true">·</span>')}</span>
      </div>
    `;
  }

  function renderAuthorRow(settings = {}, options = {}) {
    const author = options.author || "Miles Apex";
    const date = options.date ? formatShortDate(options.date) : "";
    const readTime = options.readMinutes
      ? formatReadTime(options.readMinutes)
      : "";
    return `
      <div class="news-author-row">
        ${renderAvatarHtml(settings, { size: "lg", alt: author })}
        <div class="news-author-copy">
          <strong>${escapeHtml(author)}</strong>
          <span class="news-author-role">Motorsports Journalist</span>
          <span class="news-author-meta">${[date, readTime].filter(Boolean).map((part) => escapeHtml(part)).join(" · ")}</span>
        </div>
      </div>
    `;
  }

  function applyPreview(target, settings = {}, options = {}) {
    if (!target) return;
    const previewUrl = String(options.previewUrl || "").trim();
    const url = previewUrl || displayUrl(settings);
    const crop = normalizeSettings({ ...settings, ...options.settings });
    target.style.setProperty("--avatar-zoom", String(crop.milesApexImageZoom));
    target.style.setProperty("--avatar-x", String(crop.milesApexImageX));
    target.style.setProperty("--avatar-y", String(crop.milesApexImageY));
    if (url) {
      target.classList.remove("miles-apex-avatar--initials");
      let img = target.querySelector("img");
      if (!img) {
        target.textContent = "";
        img = document.createElement("img");
        img.alt = "Miles Apex";
        target.appendChild(img);
      }
      if (img.src !== url) img.src = url;
    } else {
      const img = target.querySelector("img");
      if (img) img.remove();
      target.classList.add("miles-apex-avatar--initials");
      target.textContent = "MA";
    }
  }

  function mergeSettings(base = {}, patch = {}) {
    const merged = normalizeSettings({ ...DEFAULTS, ...base, ...patch });
    const url = stripUrlQuery(patch.milesApexImageUrl || base.milesApexImageUrl || "");
    if (url) merged.milesApexImageUrl = url;
    if (patch.milesApexImageUpdatedAt || base.milesApexImageUpdatedAt) {
      merged.milesApexImageUpdatedAt =
        patch.milesApexImageUpdatedAt || base.milesApexImageUpdatedAt;
    }
    return merged;
  }

  function clearCache() {
    cachedSettings = null;
  }

  async function loadSettings(force = false) {
    if (cachedSettings && !force) return cachedSettings;
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("settings fetch failed");
      cachedSettings = normalizeSettings({ ...DEFAULTS, ...(await res.json()) });
    } catch {
      cachedSettings = normalizeSettings(DEFAULTS);
    }
    return cachedSettings;
  }

  window.MilesApexAvatar = {
    loadSettings,
    normalizeSettings,
    mergeSettings,
    displayUrl,
    cropStyle,
    renderAvatarHtml,
    renderByline,
    renderAuthorRow,
    applyPreview,
    clearCache,
    readTimeMinutes,
    formatShortDate,
    formatReadTime,
    articleReadMinutes,
  };
})();
