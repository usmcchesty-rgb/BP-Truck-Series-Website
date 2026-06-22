(function () {
  const ROOT_ID = "admin-nav-root";
  const SESSION_KEY = "bp_admin_pw";

  const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard / Settings", href: "/admin" },
    { id: "drivers", label: "Drivers", href: "/admin#drivers" },
    { id: "track-images", label: "Track Images", href: "/admin/track-images" },
    { id: "driver-photos", label: "Driver Photos", href: "/admin/driver-photos" },
    { id: "power-rankings", label: "Power Rankings", href: "/admin/power-rankings" },
    { id: "fantasy", label: "Fantasy", href: "/admin/fantasy.html" },
    { id: "news", label: "News", href: "/admin/news" },
    { id: "transcripts", label: "Transcripts", href: "/admin/transcripts" },
  ];

  const STYLE_ID = "admin-shell-nav-styles";

  const LAYOUT_STYLE_ID = "admin-layout-styles";

  function injectLayoutStyles() {
    if (document.getElementById(LAYOUT_STYLE_ID)) return;
    const link = document.createElement("link");
    link.id = LAYOUT_STYLE_ID;
    link.rel = "stylesheet";
    link.href = "/admin/admin-layout.css";
    document.head.appendChild(link);
  }

  function injectStyles() {
    injectLayoutStyles();
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .admin-shell-nav {
        background: linear-gradient(180deg, #0d0d0d 0%, #050505 100%);
        border-bottom: 2px solid #e50914;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
        position: sticky;
        top: 0;
        z-index: 1000;
      }
      .admin-shell-nav__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 16px 8px;
        border-bottom: 1px solid #2a2a2a;
      }
      .admin-shell-nav__brand {
        font: 900 18px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif;
        color: #fff;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .admin-shell-nav__brand span {
        color: #e50914;
      }
      .admin-shell-nav__actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .admin-shell-nav__public {
        display: inline-block;
        color: #fff;
        text-decoration: none;
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 6px 10px;
        border: 1px solid #444;
        background: linear-gradient(#1a1a1a, #080808);
        clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
        white-space: nowrap;
      }
      .admin-shell-nav__public:hover {
        border-color: #888;
        color: #fff;
      }
      .admin-shell-nav__logout {
        margin: 0;
        padding: 6px 12px;
        font-size: 10px;
        clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
      }
      .admin-shell-nav__links {
        display: flex;
        flex-wrap: wrap;
        gap: 0;
        align-items: stretch;
        padding: 0 12px 10px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
      }
      .admin-shell-nav__link {
        position: relative;
        display: inline-block;
        margin: 0;
        padding: 7px 18px 7px 10px;
        color: #ddd;
        text-decoration: none;
        font-size: 10px;
        font-weight: 900;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        white-space: nowrap;
        line-height: 1.2;
        border: 1px solid #333;
        border-radius: 0;
        background: linear-gradient(#1c1c1c, #080808);
        clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%);
      }
      .admin-shell-nav__link:first-child {
        padding-left: 18px;
        z-index: 2;
      }
      .admin-shell-nav__link:last-child {
        padding-right: 18px;
      }
      .admin-shell-nav__link + .admin-shell-nav__link {
        margin-left: -8px;
        padding-left: 18px;
        border-left: 0;
        z-index: 1;
      }
      .admin-shell-nav__link:hover {
        z-index: 4;
        color: #fff;
        background: linear-gradient(#d40000, #680000);
        border-color: #ff2424;
        box-shadow: 0 0 10px rgba(229, 9, 20, 0.25);
      }
      .admin-shell-nav__link.is-active {
        z-index: 3;
        color: #fff;
        background: linear-gradient(#d40000, #680000);
        border-color: #ff2424;
        box-shadow: 0 0 12px rgba(229, 9, 20, 0.35);
      }
      @media (max-width: 640px) {
        .admin-shell-nav__top {
          flex-wrap: wrap;
          padding: 10px 12px 8px;
        }
        .admin-shell-nav__brand {
          font-size: 16px;
        }
        .admin-shell-nav__links {
          flex-wrap: nowrap;
          padding-bottom: 8px;
        }
        .admin-shell-nav__link {
          padding: 7px 10px;
          font-size: 9px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function normalizeAdminPath(pathname) {
    let path = String(pathname || "").replace(/\\/g, "/");
    if (path.endsWith("/index.html")) path = path.slice(0, -"/index.html".length);
    if (path.endsWith("/")) path = path.slice(0, -1);
    return path;
  }

  function getCurrentPageId() {
    const path = normalizeAdminPath(location.pathname);
    const hash = String(location.hash || "").toLowerCase();

    if (path === "/admin" || path.endsWith("/admin")) {
      return hash === "#drivers" ? "drivers" : "dashboard";
    }
    if (path.endsWith("/driver-photos")) return "driver-photos";
    if (path.endsWith("/power-rankings")) return "power-rankings";
    if (path.endsWith("/fantasy.html")) return "fantasy";
    if (path.endsWith("/news")) return "news";
    if (path.endsWith("/transcripts")) return "transcripts";
    if (path.endsWith("/track-images")) return "track-images";
    return "";
  }

  function renderNav(root, items, activeId) {
    const linksHtml = items
      .map(
        (item) =>
          `<a class="admin-shell-nav__link${item.id === activeId ? " is-active" : ""}" data-nav-id="${item.id}" href="${item.href}">${item.label}</a>`
      )
      .join("");

    root.innerHTML = `
      <header class="admin-shell-nav">
        <div class="admin-shell-nav__top">
          <div class="admin-shell-nav__brand">BP <span>ADMIN</span></div>
          <div class="admin-shell-nav__actions">
            <a class="admin-shell-nav__public" href="/">View Public Site</a>
            <button id="logoutBtn" class="btn admin-shell-nav__logout" type="button" hidden>Logout</button>
          </div>
        </div>
        <nav class="admin-shell-nav__links" aria-label="Admin sections">${linksHtml}</nav>
      </header>
    `;

    wireLogoutButton();
  }

  function wireLogoutButton() {
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn || logoutBtn.dataset.navBound === "wired") return;
    logoutBtn.dataset.navBound = "wired";
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem(SESSION_KEY);
      if (typeof window.logout === "function") {
        window.logout();
        return;
      }
      window.location.href = "/admin";
    });
    syncLogoutVisibility();
  }

  function syncLogoutVisibility() {
    const logoutBtn = document.getElementById("logoutBtn");
    if (!logoutBtn || logoutBtn.dataset.navBound === "page") return;
    logoutBtn.hidden = !sessionStorage.getItem(SESSION_KEY);
  }

  function updateActiveLinks(root, activeId) {
    root.querySelectorAll("[data-nav-id]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.navId === activeId);
    });
  }

  async function init() {
    const mount = document.getElementById(ROOT_ID);
    if (!mount) return;

    injectStyles();

    const baseItems = NAV_ITEMS.filter((item) => !item.optional);
    const activeId = getCurrentPageId();
    renderNav(mount, baseItems, activeId);

    window.addEventListener("hashchange", () => {
      updateActiveLinks(mount, getCurrentPageId());
    });

    window.AdminNav = {
      setLoggedIn(loggedIn) {
        const logoutBtn = document.getElementById("logoutBtn");
        if (!logoutBtn) return;
        logoutBtn.dataset.navBound = "page";
        logoutBtn.hidden = !loggedIn;
      },
      refreshActive() {
        updateActiveLinks(mount, getCurrentPageId());
      },
    };
  }

  init();
})();
