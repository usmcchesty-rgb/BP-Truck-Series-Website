(function () {
  const TRACK_IMAGE_ALIASES = {
    "charlotte-motor-speedway-oval":
      "/assets/tracks/charlotte-motor-speedway-oval-night.png",
    "charlotte-oval": "/assets/tracks/charlotte-motor-speedway-oval-night.png",
    indianapolis: "/assets/tracks/indianapolis-motor-speedway-nascar-oval.png",
  };

  let publicBaseUrl = null;
  let trackImageVersions = {};
  let configLoaded = false;

  function normalizeTrackSlug(track) {
    let s = String(track || "").trim().toLowerCase();
    s = s.replace(/&/g, "and");
    s = s.replace(/'/g, "");
    s = s.replace(/[^a-z0-9]+/g, "-");
    s = s.replace(/^-+|-+$/g, "");
    return s;
  }

  function withCacheBust(url, version) {
    const clean = String(url || "").split("?")[0];
    if (!clean) return clean;
    if (version == null || version === "") return clean;
    return `${clean}?v=${encodeURIComponent(version)}`;
  }

  function setPublicBaseUrl(url) {
    publicBaseUrl = String(url || "").trim().replace(/\/$/, "") || null;
    configLoaded = true;
  }

  function setTrackImageVersions(versions) {
    if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
      trackImageVersions = {};
      return;
    }
    trackImageVersions = { ...versions };
  }

  function trackImageCandidates(track) {
    const slug = normalizeTrackSlug(track);
    if (!slug) return [];

    const candidates = [];
    if (publicBaseUrl) {
      const supabaseUrl = withCacheBust(
        `${publicBaseUrl}/${encodeURIComponent(`${slug}.png`)}`,
        trackImageVersions[slug],
      );
      candidates.push(supabaseUrl);
    }

    const localUrl = withCacheBust(
      `/assets/tracks/${slug}.png`,
      trackImageVersions[slug],
    );
    candidates.push(localUrl);

    for (const [aliasSlug, path] of Object.entries(TRACK_IMAGE_ALIASES)) {
      if (slug.includes(aliasSlug) && !candidates.includes(path)) {
        candidates.push(path);
      }
    }
    return candidates;
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) return null;
      const data = await res.json();
      setPublicBaseUrl(data.trackImagesPublicBaseUrl || null);
      setTrackImageVersions(data.trackImageVersions || {});
      return publicBaseUrl;
    } catch {
      configLoaded = true;
      return null;
    }
  }

  function applySettings(settings) {
    if (settings?.trackImagesPublicBaseUrl) {
      setPublicBaseUrl(settings.trackImagesPublicBaseUrl);
    }
    if (settings?.trackImageVersions) {
      setTrackImageVersions(settings.trackImageVersions);
    }
  }

  window.BPTrackImages = {
    normalizeTrackSlug,
    trackImageCandidates,
    loadConfig,
    applySettings,
    setPublicBaseUrl,
    setTrackImageVersions,
    TRACK_IMAGE_ALIASES,
  };
})();
