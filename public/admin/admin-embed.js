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
    "/admin/fantasy.html": "/admin/competition#fantasy",
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

  if (!isEmbed) {
    const path = normalizePath(location.pathname);
    if ((path === "/admin" || path.endsWith("/admin")) && location.hash === "#drivers") {
      location.replace("/admin/competition#drivers");
      return;
    }
    const target = REDIRECTS[path];
    if (target) {
      const [destPath, destHash = ""] = target.split("#");
      let groupHash = destHash;
      if (path.includes("race-control") && location.hash === "#parser-tests") {
        groupHash = `${destHash}:parser-tests`;
      }
      location.replace(`${destPath}#${groupHash}`);
      return;
    }
  } else {
    document.documentElement.classList.add("admin-embed");
  }

  window.AdminEmbed = {
    isEmbed,
    hideWhenEmbed(selector) {
      if (!isEmbed) return;
      document.querySelectorAll(selector).forEach((el) => {
        el.classList.add("admin-embed-hide");
      });
    },
  };
})();
