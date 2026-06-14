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

  const LOGO_SRC = "/assets/logos/New%20Clean%20Logo.png";

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

  function brandLogo() {
    return `<a class="brand" href="/" aria-label="Blazing Pedals Truck Series home">
      <img
        class="brand-logo"
        src="${LOGO_SRC}"
        alt="Blazing Pedals Truck Series"
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
    } = options;

    const subtitleAttr = subtitleId ? ` id="${subtitleId}"` : "";
    const rightContent =
      right === "refresh"
        ? refreshPanel()
        : right === "custom"
          ? rightHtml
          : taglinePanel();

    return `
      ${brandLogo()}
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

  function init(options) {
    const header = document.querySelector("header.topbar");
    if (!header) return;
    header.innerHTML = renderHeader(options);
  }

  function initFooter() {
    if (!document.querySelector("header.topbar")) return;
    const footer = document.querySelector("body > footer");
    if (!footer || footer.dataset.bpFooter) return;
    footer.dataset.bpFooter = "1";
    footer.innerHTML = renderFooter();
  }

  window.BPPublicNav = { init, initFooter, renderHeader, renderFooter, NAV_ITEMS };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFooter);
  } else {
    initFooter();
  }
})();
