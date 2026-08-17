(function () {
  const params = new URLSearchParams(location.search);
  const isEmbed = params.get("embed") === "1";

  const REDIRECTS = {
    "/admin/news.html": "/admin/content#news",
    "/admin/news": "/admin/content#news",
    "/admin/social-sharing.html": "/admin/content#social-sharing",
    "/admin/social-sharing": "/admin/content#social-sharing",
    "/admin/track-images.html": "/admin/content#track-images",
    "/admin/track-images": "/admin/content#track-images",
    "/admin/driver-photos.html": "/admin/content#driver-photos",
    "/admin/driver-photos": "/admin/content#driver-photos",
    "/admin/power-rankings.html": "/admin/competition#power-rankings",
    "/admin/power-rankings": "/admin/competition#power-rankings",
    "/admin/standings-graphic.html": "/admin/competition#standings-graphic",
    "/admin/standings-graphic": "/admin/competition#standings-graphic",
    "/admin/fantasy.html": "/admin/competition#fantasy",
    "/admin/provisionals.html": "/admin/competition#provisionals",
    "/admin/provisionals": "/admin/competition#provisionals",
    "/admin/race-control.html": "/admin/race-operations#race-control",
    "/admin/race-control": "/admin/race-operations#race-control",
    "/admin/transcripts.html": "/admin/race-operations#transcripts",
    "/admin/transcripts": "/admin/race-operations#transcripts",
  };

  function normalizePath(pathname) {
    let path = String(pathname || "").replace(/\\/g, "/");
    if (path.endsWith("/index.html")) path = path.slice(0, -"/index.html".length);
    if (path.endsWith("/")) path = path.slice(0, -1);
    return path;
  }

  function injectEmbedAssets() {
    document.documentElement.classList.add("admin-embed");

    if (!document.getElementById("admin-embed-critical")) {
      const critical = document.createElement("style");
      critical.id = "admin-embed-critical";
      critical.textContent =
        "#admin-nav-root,#admin-mission-control-root,.admin-shell-sticky{display:none!important}";
      document.head.appendChild(critical);
    }

    if (!document.getElementById("admin-embed-styles")) {
      const link = document.createElement("link");
      link.id = "admin-embed-styles";
      link.rel = "stylesheet";
      link.href = "/admin/admin-embed.css";
      document.head.appendChild(link);
    }
  }

  function reportEmbedHeight() {
    if (!isEmbed || window.parent === window) return;
    const height = Math.ceil(
      Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        document.documentElement.offsetHeight,
        document.body.offsetHeight
      )
    );
    window.parent.postMessage(
      { type: "bp-admin-embed-height", height, path: location.pathname },
      location.origin
    );
  }

  function bindEmbedHeightReporting() {
    if (!isEmbed || window.parent === window) return;

    window.addEventListener("load", reportEmbedHeight);
    window.addEventListener("resize", reportEmbedHeight);

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => reportEmbedHeight());
      ro.observe(document.documentElement);
      if (document.body) ro.observe(document.body);
    }

    const mo = new MutationObserver(() => reportEmbedHeight());
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    setTimeout(reportEmbedHeight, 100);
    setTimeout(reportEmbedHeight, 500);
    setTimeout(reportEmbedHeight, 1500);
  }

  if (!isEmbed) {
    const path = normalizePath(location.pathname);
    if ((path === "/admin" || path.endsWith("/admin")) && location.hash === "#drivers") {
      location.replace("/admin/competition#drivers");
    } else {
      const target = REDIRECTS[path];
      if (target) {
        const [destPath, destHash = ""] = target.split("#");
        let groupHash = destHash;
        if (path.includes("race-control") && location.hash === "#parser-tests") {
          groupHash = `${destHash}:parser-tests`;
        }
        location.replace(`${destPath}#${groupHash}`);
      }
    }
  } else {
    injectEmbedAssets();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindEmbedHeightReporting);
    } else {
      bindEmbedHeightReporting();
    }
  }

  window.AdminEmbed = {
    isEmbed,
    isEmbedMode() {
      return isEmbed || document.documentElement.classList.contains("admin-embed");
    },
    hideWhenEmbed(selector) {
      if (!isEmbed) return;
      document.querySelectorAll(selector).forEach((el) => {
        el.classList.add("admin-embed-hide");
      });
    },
    reportHeight: reportEmbedHeight,
  };
})();
