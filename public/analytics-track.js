(function () {
  "use strict";

  const STORAGE_VISITOR = "bp_analytics_vid";
  const STORAGE_SESSION = "bp_analytics_sid";
  const DEBOUNCE_MS = 5000;
  const LAST_TRACK_KEY = "bp_analytics_last_track";

  function isAdminPage() {
    return /^\/admin(\/|$)/.test(location.pathname);
  }

  function randomId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "bp_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getVisitorId() {
    try {
      let id = localStorage.getItem(STORAGE_VISITOR);
      if (!id) {
        id = randomId();
        localStorage.setItem(STORAGE_VISITOR, id);
      }
      return id;
    } catch {
      return randomId();
    }
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem(STORAGE_SESSION);
      if (!id) {
        id = randomId();
        sessionStorage.setItem(STORAGE_SESSION, id);
      }
      return id;
    } catch {
      return randomId();
    }
  }

  function shouldSkipDuplicate(path) {
    try {
      const raw = sessionStorage.getItem(LAST_TRACK_KEY);
      if (!raw) return false;
      const last = JSON.parse(raw);
      if (!last || last.path !== path) return false;
      return Date.now() - Number(last.at || 0) < DEBOUNCE_MS;
    } catch {
      return false;
    }
  }

  function markTracked(path) {
    try {
      sessionStorage.setItem(
        LAST_TRACK_KEY,
        JSON.stringify({ path, at: Date.now() })
      );
    } catch {}
  }

  function detectDeviceType() {
    const ua = navigator.userAgent || "";
    if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) return "Tablet";
    if (/mobile|iphone|ipod|android|blackberry|phone/i.test(ua)) return "Mobile";
    if (!ua.trim()) return "Unknown";
    return "Desktop";
  }

  function trackPageView() {
    if (isAdminPage()) return;

    const path = location.pathname || "/";
    if (shouldSkipDuplicate(path)) return;
    markTracked(path);

    const payload = {
      action: "trackPageView",
      path,
      fullUrl: location.href,
      pageTitle: document.title || "",
      referrer: document.referrer || "",
      userAgent: navigator.userAgent || "",
      deviceType: detectDeviceType(),
      visitorId: getVisitorId(),
      sessionId: getSessionId(),
      isAdmin: false,
    };

    fetch("/api/settings?action=trackPageView", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", trackPageView, { once: true });
  } else {
    trackPageView();
  }
})();
