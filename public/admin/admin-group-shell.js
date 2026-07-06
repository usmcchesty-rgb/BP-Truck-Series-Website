(function () {
  const SESSION_KEY = "bp_admin_pw";

  function $(sel) {
    return document.querySelector(sel);
  }

  async function verifyPassword(pw) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw, verifyOnly: true }),
    });
    return res.ok;
  }

  function getSessionPw() {
    return sessionStorage.getItem(SESSION_KEY) || "";
  }

  function parseHash() {
    const raw = String(location.hash || "").replace(/^#/, "");
    if (!raw) return { tabId: "", sub: "" };
    const parts = raw.split(":");
    return { tabId: parts[0] || "", sub: parts.slice(1).join(":") || "" };
  }

  function buildFrameSrc(tab, sub) {
    let src = tab.src;
    if (sub && tab.subHashMap && tab.subHashMap[sub]) {
      src += tab.subHashMap[sub];
    } else if (tab.defaultSubHash) {
      src += tab.defaultSubHash;
    }
    return src;
  }

  function resizeFrame(frame, height) {
    if (!frame) return;
    const next = Math.max(480, Math.ceil(Number(height) || 0));
    frame.style.height = `${next}px`;
    const wrap = frame.closest(".admin-group-frame-wrap");
    if (wrap) wrap.style.minHeight = `${next}px`;
  }

  function bindFrameResize(frame) {
    if (!frame || frame.dataset.resizeBound === "1") return;
    frame.dataset.resizeBound = "1";

    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin) return;
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type !== "bp-admin-embed-height") return;
      resizeFrame(frame, event.data.height);
    });

    frame.addEventListener("load", () => {
      resizeFrame(frame, 480);
      try {
        const doc = frame.contentDocument;
        if (doc) {
          const height = Math.max(
            doc.documentElement.scrollHeight,
            doc.body?.scrollHeight || 0
          );
          if (height > 0) resizeFrame(frame, height);
        }
      } catch {}
    });
  }

  function initGroupPage(config) {
    const tabs = config.tabs || [];
    const defaultTabId = config.defaultTab || tabs[0]?.id || "";
    const title = config.title || "Admin";
    const subtitle = config.subtitle || "";
    const tools = config.tools || [];

    const loginView = $("#loginView");
    const adminView = $("#adminView");
    const tabBar = $("#groupTabBar");
    const frame = $("#groupFrame");
    const pageTitle = $("#groupTitle");
    const pageSub = $("#groupSubtitle");
    const toolsRow = $("#groupTools");

    if (pageTitle) pageTitle.textContent = title;
    if (pageSub) pageSub.textContent = subtitle;

    if (frame) bindFrameResize(frame);

    if (toolsRow && tools.length) {
      toolsRow.innerHTML = tools
        .map((t) => `<a href="${t.href}">${t.label}</a>`)
        .join("");
      toolsRow.hidden = false;
    }

    function showLogin() {
      if (loginView) loginView.hidden = false;
      if (adminView) adminView.hidden = true;
      if (window.AdminNav) AdminNav.setLoggedIn(false);
    }

    function ensureMissionSummaryMount() {
      let mount = document.getElementById("groupMissionSummary");
      if (!mount && tabBar) {
        mount = document.createElement("div");
        mount.id = "groupMissionSummary";
        tabBar.insertAdjacentElement("afterend", mount);
      }
      return mount;
    }

    function initMissionSummary() {
      const mount = ensureMissionSummaryMount();
      if (!mount) return;

      const boot = () => {
        if (!window.AdminMissionSectionTasks || !window.AdminMissionTaskSummary) return;
        AdminMissionTaskSummary.init({
          section: config.missionSection || inferMissionSection(),
          mount,
          setTab(tabId) {
            setHash(tabId, "", false);
            renderTabs();
          },
        });
      };

      if (window.AdminMissionSectionTasks && window.AdminMissionTaskSummary) boot();
      else {
        document.getElementById("admin-mission-section-tasks-script")?.addEventListener("load", boot, { once: true });
        document.getElementById("admin-mission-summary-script")?.addEventListener("load", boot, { once: true });
      }
    }

    function inferMissionSection() {
      const path = String(location.pathname || "").replace(/\\/g, "/");
      if (path.endsWith("/content")) return "content";
      if (path.endsWith("/competition")) return "competition";
      if (path.endsWith("/race-operations")) return "race-operations";
      if (path.endsWith("/analytics")) return "analytics";
      return "dashboard";
    }

    function showAdmin() {
      if (loginView) loginView.hidden = true;
      if (adminView) adminView.hidden = false;
      if (window.AdminNav) AdminNav.setLoggedIn(true);
      initMissionSummary();
      renderTabs();
    }

    function activeTabFromHash() {
      const { tabId, sub } = parseHash();
      const match = tabs.find((t) => t.id === tabId);
      if (match) return { tab: match, sub };
      const fallback = tabs.find((t) => t.id === defaultTabId) || tabs[0];
      return { tab: fallback, sub: "" };
    }

    function setHash(tabId, sub, replace) {
      const next = sub ? `#${tabId}:${sub}` : `#${tabId}`;
      if (location.hash === next) return;
      const url = `${location.pathname}${location.search}${next}`;
      if (replace) history.replaceState(null, "", url);
      else history.pushState(null, "", url);
    }

    function renderTabs() {
      const { tab, sub } = activeTabFromHash();
      if (!tab || !tabBar || !frame) return;

      tabBar.innerHTML = tabs
        .map(
          (t) =>
            `<button type="button" class="admin-group-tab${t.id === tab.id ? " is-active" : ""}" data-tab-id="${t.id}">${t.label}</button>`
        )
        .join("");

      tabBar.querySelectorAll("[data-tab-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.tabId;
          setHash(id, "", false);
          renderTabs();
        });
      });

      const src = buildFrameSrc(tab, sub);
      if (frame.getAttribute("src") !== src) {
        frame.setAttribute("src", src);
      }

      if (!parseHash().tabId) {
        setHash(tab.id, sub, true);
      }

      if (window.AdminAttention) {
        window.AdminAttention.refresh({ skipFetch: true });
      }
    }

    async function login() {
      const msg = $("#loginMsg");
      const pw = $("#loginPw")?.value || "";
      if (!pw) {
        if (msg) {
          msg.textContent = "Enter the admin password.";
          msg.classList.add("error");
        }
        return;
      }
      if (msg) {
        msg.textContent = "Checking...";
        msg.classList.remove("error");
      }
      try {
        if (!(await verifyPassword(pw))) throw new Error("Bad password");
        sessionStorage.setItem(SESSION_KEY, pw);
        if ($("#loginPw")) $("#loginPw").value = "";
        if (msg) msg.textContent = "";
        showAdmin();
      } catch (e) {
        if (msg) {
          msg.textContent = e.message || "Login failed";
          msg.classList.add("error");
        }
      }
    }

    async function initSession() {
      const pw = getSessionPw();
      if (!pw) return showLogin();
      try {
        if (await verifyPassword(pw)) return showAdmin();
      } catch {}
      sessionStorage.removeItem(SESSION_KEY);
      showLogin();
    }

    window.login = login;
    window.addEventListener("hashchange", () => {
      if (adminView && !adminView.hidden) renderTabs();
    });

    $("#loginPw")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") login();
    });

    initSession();
  }

  window.AdminGroupShell = { initGroupPage };
})();
