(function () {
  const NAV_ITEMS = [
    { key: "home", label: "Home", href: "/" },
    { key: "standings", label: "Standings", href: "/standings.html" },
    { key: "schedule", label: "Schedule", href: "/schedule.html" },
    { key: "results", label: "Results", href: "/results.html" },
    { key: "drivers", label: "Drivers", href: "/drivers.html" },
    { key: "streamers", label: "Streamers", href: "/streamers.html" },
    { key: "power-rankings", label: "Power Rankings", href: "/power-rankings.html" },
    { key: "news", label: "News", href: "/news.html" },
  ];

  const DEFAULT_LOGO_SRC = "/assets/logos/New%20Clean%20Logo.png";
  const DEFAULT_LOGO_ALT = "Blazing Pedals Truck Series";

  function stripUrlQuery(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    return value.split("?")[0].split("#")[0];
  }

  function cacheVersion(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function withCacheBust(url, version) {
    const clean = stripUrlQuery(url);
    if (!clean) return clean;
    if (version == null || version === "") return clean;
    return `${clean}?v=${encodeURIComponent(version)}`;
  }

  function resolveHeaderLogoUrl(settings) {
    const custom = stripUrlQuery(settings?.headerLogoUrl || "");
    return custom || DEFAULT_LOGO_SRC;
  }

  function resolveHeaderLogoAlt(settings) {
    const alt = String(settings?.headerLogoAltText || "").trim();
    return alt || DEFAULT_LOGO_ALT;
  }

  function resolveHeaderLogoDisplayUrl(settings) {
    const url = resolveHeaderLogoUrl(settings);
    if (!settings?.headerLogoUrl) return url;
    const version = cacheVersion(settings.headerLogoUpdatedAt) || Date.now();
    return withCacheBust(url, version);
  }

  function navLinks(active) {
    return NAV_ITEMS.map((item) => {
      const cls = item.key === active ? ' class="active"' : "";
      return `<a href="${item.href}"${cls}>${item.label.toUpperCase()}</a>`;
    }).join("");
  }

  function taglinePanel() {
    return `<div class="refresh"><strong>NASCAR STYLE LEAGUE</strong>EST. 2021</div>`;
  }

  function refreshPanel() {
    return `<div class="refresh"><div>LAST UPDATED</div><strong id="lastUpdated">Loading...</strong><button id="refreshBtn" type="button" aria-label="Refresh">↻</button></div>`;
  }

  function brandLogo(logoSrc, logoAlt) {
    const src = logoSrc || DEFAULT_LOGO_SRC;
    const alt = logoAlt || DEFAULT_LOGO_ALT;
    return `<a class="brand" href="/" aria-label="Blazing Pedals Truck Series home">
      <img
        class="brand-logo"
        src="${src}"
        alt="${alt.replace(/"/g, "&quot;")}"
        decoding="async"
      />
    </a>`;
  }

  function renderHeader(options) {
    const {
      active = "",
      title = "BLAZING PEDALS TRUCK SERIES",
      subtitle = "SEASON 11",
      subtitleId = "",
      right = "tagline",
      rightHtml = "",
      logoSrc = DEFAULT_LOGO_SRC,
      logoAlt = DEFAULT_LOGO_ALT,
    } = options;

    const subtitleAttr = subtitleId ? ` id="${subtitleId}"` : "";
    const rightContent =
      right === "refresh"
        ? refreshPanel()
        : right === "custom"
          ? rightHtml
          : taglinePanel();

    return `
      ${brandLogo(logoSrc, logoAlt)}
      <div class="title">
        <h1>${title}</h1>
        <p class="page-season"${subtitleAttr}>${subtitle}</p>
      </div>
      <nav class="site-nav" aria-label="Main navigation">${navLinks(active)}</nav>
      ${rightContent}
    `;
  }

  function renderFooter() {
    return `<div class="footer-inner">
      <span class="footer-slogan">FAST DRIVERS. CLOSE RACING. <span>BIG FUN.</span></span>
      <a href="/admin/" class="footer-admin">Admin</a>
    </div>`;
  }

  function applyHeaderLogo(settings) {
    const img = document.querySelector(".brand-logo");
    if (!img) return;
    img.src = resolveHeaderLogoDisplayUrl(settings);
    img.alt = resolveHeaderLogoAlt(settings);
  }

  async function loadHeaderLogoFromSettings() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const settings = await res.json();
      applyHeaderLogo(settings);
    } catch (_) {}
  }

  function init(options) {
    const header = document.querySelector("header.topbar");
    if (!header) return;
    header.innerHTML = renderHeader(options);
    loadHeaderLogoFromSettings();
  }

  function initFooter() {
    if (!document.querySelector("header.topbar")) return;
    const footer = document.querySelector("body > footer");
    if (!footer || footer.dataset.bpFooter) return;
    footer.dataset.bpFooter = "1";
    footer.innerHTML = renderFooter();
  }

  window.BPPublicNav = {
    init,
    initFooter,
    renderHeader,
    renderFooter,
    applyHeaderLogo,
    resolveHeaderLogoDisplayUrl,
    NAV_ITEMS,
    DEFAULT_LOGO_SRC,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFooter);
  } else {
    initFooter();
  }
})();
