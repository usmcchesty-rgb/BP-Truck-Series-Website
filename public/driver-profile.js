const $ = (s) => document.querySelector(s);

const PLACEHOLDER_PHOTO = "/assets/drivers/placeholder.png";
const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDriverIdFromPath() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("driverId") || params.get("id");
  if (fromQuery) return decodeURIComponent(fromQuery).trim();

  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "drivers" && parts[1]) {
    return decodeURIComponent(parts[1]).trim();
  }
  return "";
}

function normalizeLookupName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function twitterHandleFromUrl(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.startsWith("@")) return text.slice(1);
  const match = text.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
  return match?.[1]?.replace(/^@/, "") || "";
}

function findProfileFallback(profiles, queryId) {
  const raw = String(queryId ?? "").trim();
  if (!raw || !Array.isArray(profiles) || !profiles.length) return null;

  let match = profiles.find((row) => String(row.driver_id) === raw);
  if (match) return match;

  const lookupName = normalizeLookupName(raw);

  if (raw.startsWith("@")) {
    const handle = raw.slice(1).toLowerCase();
    match = profiles.find((row) => {
      const twitter = String(row.twitter_url || row.twitterUrl || "").trim().toLowerCase();
      const twitterHandle = twitterHandleFromUrl(twitter);
      return (
        twitter === raw.toLowerCase() ||
        twitter.includes(`/${handle}`) ||
        twitter.includes(`@${handle}`) ||
        twitterHandle === handle
      );
    });
    if (match) return match;

    match = profiles.find((row) => {
      const names = [row.display_name, row.iracing_name].map(normalizeLookupName);
      return names.includes(handle) || names.includes(lookupName);
    });
    if (match) return match;
  }

  match = profiles.find((row) => {
    const names = [row.display_name, row.iracing_name].map(normalizeLookupName);
    return names.includes(lookupName);
  });
  return match || null;
}

async function fetchDriverProfile(requestedId) {
  const res = await fetch(`/api/drivers?driver_id=${encodeURIComponent(requestedId)}`);
  if (res.ok) {
    const profile = await res.json();
    if (profile?.driver_id) return profile;
  }

  const listRes = await fetch("/api/drivers");
  if (!listRes.ok) return null;
  const profiles = await listRes.json();
  return findProfileFallback(Array.isArray(profiles) ? profiles : [], requestedId);
}

function driverImage(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `/assets/drivers/${slug}.png`;
}

const CAR_IMAGE_BASE = "/assets/images/cars";
const CAR_IMAGE_EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg"];

function slugifyDriverName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCarNumber(value) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .replace(/^0+/, "") || "";
}

function driverBpNumber(profile) {
  return String(profile?.bp_number || profile?.car_number || "").trim();
}

function buildNameAssetBases(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return [];

  const slug = slugifyDriverName(trimmed);
  const titleCase = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("-")
        .map((part) => {
          if (!part) return part;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join("-")
    )
    .join(" ");

  return [...new Set([titleCase, trimmed, slug].filter(Boolean))];
}

function toCarAssetUrl(baseName, ext) {
  const encoded = String(baseName)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${CAR_IMAGE_BASE}/${encoded}${ext}`;
}

function buildLocalCarImageCandidates(profile) {
  const names = [
    profile.display_name,
    profile.iracing_name,
    profile.name,
  ].filter(Boolean);
  const nameBases = [];
  for (const name of names) {
    for (const base of buildNameAssetBases(name)) {
      nameBases.push(base);
    }
  }
  const uniqueBases = [...new Set(nameBases.filter(Boolean))];
  const carNum = normalizeCarNumber(driverBpNumber(profile));
  const driverId = String(profile.driver_id || "").trim();
  const orderedBases = [];

  // Prefer exact name bases before number-suffixed variants so
  // "Kody Miller2.png" is tried before "Kody Miller2-11.png".
  for (const base of uniqueBases) {
    orderedBases.push(base);
  }
  for (const base of uniqueBases) {
    if (carNum) {
      orderedBases.push(`${base}-${carNum}`);
      orderedBases.push(`${carNum}-${base}`);
    }
  }

  if (driverId) orderedBases.push(driverId);
  if (carNum) orderedBases.push(carNum);

  const candidates = [];
  for (const base of orderedBases) {
    if (!base) continue;
    for (const ext of CAR_IMAGE_EXTENSIONS) {
      candidates.push(toCarAssetUrl(base, ext));
    }
  }

  return [...new Set(candidates)];
}

function isUsableCarImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return false;
  if (/^https?:\/\/drive\.google\.com\/open\/?$/i.test(url)) return false;
  if (/^https?:\/\/drive\.google\.com\/open\?id=$/i.test(url)) return false;
  if (/drive\.google\.com\/open\/?$/i.test(url)) return false;
  return true;
}

function shouldLogCarImageDiagnostics() {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "car";
  } catch {
    return false;
  }
}

function logCarImageResolution(details) {
  if (shouldLogCarImageDiagnostics()) {
    console.info("[BP Driver Profile Car]", details);
    return;
  }

  if (!details.selectedUrl) {
    console.warn("[BP Driver Profile Car] no car image resolved", {
      carImageUrlFromProfile: details.carImageUrlFromProfile,
      localCandidates: details.localCandidates,
      failedCandidates: details.failedCandidates,
    });
  }
}

function probeImageUrl(url) {
  const src = String(url || "").trim();
  if (!src) return Promise.resolve("");

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => {
      fetch(src, { method: "HEAD" })
        .then((res) => resolve(res.ok ? src : ""))
        .catch(() => resolve(""));
    };
    img.src = src;
  });
}

async function resolveCarImageUrl(profile) {
  const carImageUrlFromProfile = profileText(profile, "car_image_url", "carImageUrl");
  const localCandidates = buildLocalCarImageCandidates(profile);
  const failedCandidates = [];
  let selectedUrl = "";

  if (isUsableCarImageUrl(carImageUrlFromProfile)) {
    const loaded = await probeImageUrl(carImageUrlFromProfile);
    if (loaded) {
      selectedUrl = loaded;
    } else {
      failedCandidates.push(carImageUrlFromProfile);
    }
  } else if (carImageUrlFromProfile) {
    failedCandidates.push(carImageUrlFromProfile);
  }

  if (!selectedUrl) {
    for (const candidate of localCandidates) {
      const loaded = await probeImageUrl(candidate);
      if (loaded) {
        selectedUrl = loaded;
        break;
      }
      failedCandidates.push(candidate);
    }
  }

  const details = {
    carImageUrlFromProfile: carImageUrlFromProfile || "",
    localCandidates,
    selectedUrl,
    failedCandidates,
  };
  logCarImageResolution(details);

  return { url: selectedUrl, debug: details };
}

function renderCarImageHeroSection(carImageUrl, driverName) {
  if (!carImageUrl) return "";

  return `<div class="driver-profile-car-wrap" data-car-wrap>
    <div class="driver-profile-car-hero" aria-label="Race car">
      <div class="driver-profile-car-hero-inner">
        <img
          class="driver-profile-car-hero-image"
          src="${escapeAttr(carImageUrl)}"
          alt="${escapeAttr(`${driverName} race car`)}"
          loading="eager"
          decoding="async"
        />
      </div>
    </div>
  </div>`;
}

function shouldLogCarAlignDiagnostics() {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "car-align";
  } catch {
    return false;
  }
}

function getLineRectsPrecise(h1) {
  const textNode = h1?.firstChild;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return [];

  const text = textNode.textContent || "";
  if (!text) return [];

  const range = document.createRange();
  const lineMap = new Map();

  for (let i = 0; i < text.length; i += 1) {
    range.setStart(textNode, i);
    range.setEnd(textNode, i + 1);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 1
    );

    rects.forEach((rect) => {
      const key = Math.round(rect.top);
      const line = lineMap.get(key) || {
        left: Infinity,
        right: -Infinity,
        top: rect.top,
        width: 0,
        height: rect.height,
      };
      line.left = Math.min(line.left, rect.left);
      line.right = Math.max(line.right, rect.right);
      line.width = line.right - line.left;
      lineMap.set(key, line);
    });
  }

  return Array.from(lineMap.values()).filter((line) => line.width > 0);
}

function getH1LineRects(h1) {
  if (!h1) return { raw: [], lines: [] };

  const precise = getLineRectsPrecise(h1);
  if (precise.length) {
    return { raw: precise, lines: precise };
  }

  const filterRects = (rects) =>
    rects.filter((rect) => rect.width > 0 && rect.height > 1);

  const fromElement = filterRects(Array.from(h1.getClientRects()));

  let fromRange = [];
  try {
    const range = document.createRange();
    range.selectNodeContents(h1);
    fromRange = filterRects(Array.from(range.getClientRects()));
  } catch {
    fromRange = [];
  }

  const raw = fromRange.length > fromElement.length ? fromRange : fromElement;
  if (!raw.length) return { raw: [], lines: [] };

  const lineHeight = parseFloat(window.getComputedStyle(h1).lineHeight) || 0;
  const topThreshold = Math.max(4, lineHeight * 0.35);

  const lines = [];

  raw.forEach((rect) => {
    const existing = lines.find((line) => Math.abs(line.top - rect.top) < topThreshold);
    if (existing) {
      existing.left = Math.min(existing.left, rect.left);
      existing.right = Math.max(existing.right, rect.right);
      existing.width = existing.right - existing.left;
      return;
    }

    lines.push({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
  });

  return { raw, lines };
}

function isWrappedDriverName(h1, lineRects) {
  if (lineRects.lines.length > 1) return true;

  const lineHeight = parseFloat(window.getComputedStyle(h1).lineHeight) || 0;
  if (!lineHeight) return false;

  const blockHeight = h1.getBoundingClientRect().height;
  return blockHeight > lineHeight * 1.25;
}

function alignDriverProfileCar(driverName) {
  const stack = document.querySelector(".driver-profile-name-stack");
  if (!stack) return;

  const h1 = stack.querySelector(".driver-profile-name");
  const carWrap = stack.querySelector("[data-car-wrap]");
  if (!h1 || !carWrap) return;

  const debug = shouldLogCarAlignDiagnostics();

  carWrap.style.transform = "none";
  void carWrap.offsetHeight;

  const { raw, lines } = getH1LineRects(h1);
  const lineCount = lines.length;
  const wrapped = isWrappedDriverName(h1, { lines });

  if (!wrapped || !raw.length) {
    carWrap.style.transform = "";
    carWrap.removeAttribute("data-car-align-wrap");

    if (debug) {
      console.log("[BP Driver Profile Car Align]", {
        driverName,
        lineCount,
        rectWidths: raw.map((rect) => rect.width),
        lineRects: lines,
        visualCenter: null,
        carCenter: null,
        appliedOffset: 0,
        wrapped: false,
      });
    }
    return;
  }

  const leftMost = Math.min(...raw.map((rect) => rect.left));
  const rightMost = Math.max(...raw.map((rect) => rect.right));
  const visualCenter = (leftMost + rightMost) / 2;
  const carRect = carWrap.getBoundingClientRect();
  const carCenter = carRect.left + carRect.width / 2;
  const appliedOffset = visualCenter - carCenter;

  if (Math.abs(appliedOffset) < 0.5) {
    carWrap.style.transform = "";
    carWrap.removeAttribute("data-car-align-wrap");
  } else {
    carWrap.style.transform = `translateX(${appliedOffset}px)`;
    carWrap.setAttribute("data-car-align-wrap", "1");
  }

  if (debug) {
    console.log("[BP Driver Profile Car Align]", {
      driverName,
      lineCount,
      rectWidths: raw.map((rect) => rect.width),
      lineRects: lines.map((rect) => ({
        left: rect.left,
        right: rect.right,
        width: rect.width,
        top: rect.top,
      })),
      leftMost,
      rightMost,
      visualCenter,
      carCenter,
      appliedOffset,
      wrapped: true,
    });
  }
}

let carAlignResizeTimer = null;
let carAlignObserver = null;

function scheduleDriverProfileCarAlignment(driverName) {
  if (carAlignObserver) {
    carAlignObserver.disconnect();
    carAlignObserver = null;
  }

  const run = () => alignDriverProfileCar(driverName);

  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });

  const stack = document.querySelector(".driver-profile-name-stack");
  if (!stack) return;

  const h1 = stack.querySelector(".driver-profile-name");
  const carImg = stack.querySelector(".driver-profile-car-hero-image");

  if (carImg && !carImg.complete) {
    carImg.addEventListener("load", run, { once: true });
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(run).catch(() => {});
  }

  if (typeof ResizeObserver !== "undefined") {
    carAlignObserver = new ResizeObserver(() => {
      clearTimeout(carAlignResizeTimer);
      carAlignResizeTimer = setTimeout(run, 50);
    });
    if (h1) carAlignObserver.observe(h1);
    carAlignObserver.observe(stack);
    const carWrap = stack.querySelector("[data-car-wrap]");
    if (carWrap) carAlignObserver.observe(carWrap);
  }

  if (!scheduleDriverProfileCarAlignment.resizeBound) {
    scheduleDriverProfileCarAlignment.resizeBound = true;
    window.addEventListener("resize", () => {
      clearTimeout(carAlignResizeTimer);
      carAlignResizeTimer = setTimeout(() => {
        const currentName = document.querySelector(".driver-profile-name")?.textContent?.trim();
        if (currentName) alignDriverProfileCar(currentName);
      }, 100);
    });
  }
}
scheduleDriverProfileCarAlignment.resizeBound = false;

function formatStatValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value).trim();
  return text || null;
}

function statTile(label, value, options = {}) {
  const formatted = formatStatValue(value);
  if (formatted === null && !options.allowZero) return "";
  if (formatted === null && options.allowZero && value !== 0) return "";
  const display = formatted ?? "0";
  return `<div class="driver-profile-stat">
    <span class="driver-profile-stat-label">${escapeHtml(label)}</span>
    <strong class="driver-profile-stat-value">${escapeHtml(display)}</strong>
  </div>`;
}

function metaItem(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `<div class="driver-profile-meta-item">
    <span class="driver-profile-meta-label">${escapeHtml(label)}</span>
    <span class="driver-profile-meta-value">${escapeHtml(text)}</span>
  </div>`;
}

function profileText(profile, ...keys) {
  for (const key of keys) {
    const value = profile?.[key];
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function streamerBadgeHtml(streamUrl) {
  const badge = `<span class="streamer-badge">STREAMER</span>`;
  const url = String(streamUrl || "").trim();
  if (!url) return badge;
  return `<a class="streamer-badge-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" aria-label="Watch stream">${badge}</a>`;
}

const SOCIAL_ICON_SVGS = {
  facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 3h3.5L16 7.9 13.5 8.2c-.9.1-1.3.5-1.3 1.4V12h3.2l-.4 3.6H12.2V21H8.6v-5.4H6V12h2.6V7.8c0-2.4 1.4-3.8 3.7-3.8.9 0 1.7.1 1.7.1z"/></svg>`,
  twitter: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4l8.1 10.8L4.2 20h2.3l6.4-7.5 5.2 7.5H20l-8.6-11.5L19.1 4h-2.3l-5.9 6.9L6.4 4H4zm2.6 1.5h1.5l10.8 15.5h-1.5L6.6 5.5z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7zm5 3.5A5.5 5.5 0 1 1 6.5 14 5.5 5.5 0 0 1 12 8.5zm0 2A3.5 3.5 0 1 0 15.5 14 3.5 3.5 0 0 0 12 10.5zM17.8 6.7a1.1 1.1 0 1 1-1.1 1.1 1.1 1.1 0 0 1 1.1-1.1z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.5 4c.3 2.2 1.6 3.9 3.8 4.2v2.8c-1.4 0-2.7-.4-3.8-1.1v5.8a5.1 5.1 0 1 1-5.1-5.1c.3 0 .7 0 1 .1v3a2.2 2.2 0 1 0 1.6 2.1V4h2.5z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C17.8 5 12 5 12 5s-5.8 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c2 .4 7.8.4 7.8.4s5.8 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>`,
  twitch: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 3h16v13.5l-4 4H12l-2 2H8v-2H4V3zm2 2v11h2v3l2-3h3l3-3V5H6zm9 2v6h-2V7h2zm-4 0v6H9V7h2z"/></svg>`,
};

function shouldLogSocialUrlDiagnostics() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "social") return true;
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function logSocialUrlDiagnostic(platform, raw, normalized, note = "") {
  if (!shouldLogSocialUrlDiagnostics()) return;
  console.info("[BP Driver Profile Social]", {
    platform,
    raw,
    normalized: normalized || null,
    note: note || undefined,
  });
}

function normalizeSocialHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "");
}

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isRelativeOrInternalPath(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (text.startsWith("/") || text.startsWith("./") || text.startsWith("../")) return true;
  if (/\/drivers\//i.test(text) || /^drivers\//i.test(text)) return true;
  return false;
}

function looksLikeDomainUrl(value) {
  const text = String(value || "").trim();
  if (!text || text.startsWith("@")) return false;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]|$)/i.test(text);
}

function buildPlatformSocialUrl(platform, handle) {
  const safeHandle = encodeURIComponent(handle).replace(/%40/g, "@");
  switch (platform) {
    case "twitter":
      return `https://x.com/${safeHandle}`;
    case "instagram":
      return `https://instagram.com/${safeHandle}`;
    case "tiktok":
      return `https://tiktok.com/@${safeHandle}`;
    case "twitch":
      return `https://twitch.tv/${safeHandle}`;
    case "youtube":
      return `https://youtube.com/@${safeHandle}`;
    case "facebook":
      return `https://facebook.com/${safeHandle}`;
    default:
      return "";
  }
}

function isValidSocialHandle(handle) {
  return /^[a-z0-9._-]+$/i.test(String(handle || "").trim());
}

function normalizeSocialUrl(value, platform) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (isRelativeOrInternalPath(raw)) {
    logSocialUrlDiagnostic(platform, raw, "", "rejected relative or internal path");
    return "";
  }

  if (isAbsoluteHttpUrl(raw)) {
    logSocialUrlDiagnostic(platform, raw, raw);
    return raw;
  }

  if (/^www\./i.test(raw)) {
    const normalized = `https://${raw}`;
    logSocialUrlDiagnostic(platform, raw, normalized);
    return normalized;
  }

  if (looksLikeDomainUrl(raw)) {
    const normalized = `https://${raw.replace(/^\/\//, "")}`;
    logSocialUrlDiagnostic(platform, raw, normalized);
    return normalized;
  }

  if (/^(twitch|youtube|instagram|facebook|twitter|x|tiktok)\./i.test(raw)) {
    const normalized = `https://${raw}`;
    logSocialUrlDiagnostic(platform, raw, normalized);
    return normalized;
  }

  const handle = normalizeSocialHandle(raw);
  if (!handle || !isValidSocialHandle(handle)) {
    logSocialUrlDiagnostic(platform, raw, "", "rejected invalid handle");
    return "";
  }

  const normalized = buildPlatformSocialUrl(platform, handle);
  if (!normalized || !isAbsoluteHttpUrl(normalized)) {
    logSocialUrlDiagnostic(platform, raw, "", "failed to build absolute URL");
    return "";
  }

  logSocialUrlDiagnostic(platform, raw, normalized);
  return normalized;
}

function socialButton(platform, url, label) {
  const href = normalizeSocialUrl(url, platform);
  if (!href || !isAbsoluteHttpUrl(href) || isRelativeOrInternalPath(href)) return "";
  const icon = SOCIAL_ICON_SVGS[platform] || "";
  return `<a class="driver-profile-social-btn driver-profile-social-btn--${platform}" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(label)}">${icon}</a>`;
}

function renderConnectSection(profile) {
  const entries = [
    ["facebook", profileText(profile, "facebook_url", "facebookUrl"), "Facebook"],
    ["twitter", profileText(profile, "twitter_url", "twitterUrl"), "X / Twitter"],
    ["instagram", profileText(profile, "instagram_url", "instagramUrl"), "Instagram"],
    ["tiktok", profileText(profile, "tiktok_url", "tiktokUrl"), "TikTok"],
    ["youtube", profileText(profile, "youtube_url", "youtubeUrl"), "YouTube"],
    ["twitch", profileText(profile, "twitch_url", "twitchUrl"), "Twitch"],
  ];

  const buttons = entries
    .map(([platform, rawUrl, label]) => socialButton(platform, rawUrl, label))
    .filter(Boolean);

  if (!buttons.length) return "";

  if (shouldLogSocialUrlDiagnostics()) {
    const summary = Object.fromEntries(
      entries
        .map(([platform, rawUrl]) => [platform, { raw: rawUrl, normalized: normalizeSocialUrl(rawUrl, platform) }])
        .filter(([, value]) => value.raw)
    );
    console.info("[BP Driver Profile Social] connect section summary", summary);
  }

  return `<section class="driver-profile-connect-section">
    <div class="driver-profile-section-head">
      <h2>Connect</h2>
    </div>
    <div class="driver-profile-social-row">${buttons.join("")}</div>
  </section>`;
}

function renderInfoSection(title, items) {
  const rows = items
    .map(([label, value]) => {
      const text = String(value || "").trim();
      if (!text) return "";
      return `<div class="driver-profile-info-item">
        <span class="driver-profile-info-label">${escapeHtml(label)}</span>
        <span class="driver-profile-info-value">${escapeHtml(text)}</span>
      </div>`;
    })
    .filter(Boolean);

  if (!rows.length) return "";

  return `<section class="driver-profile-info-section">
    <div class="driver-profile-section-head">
      <h2>${escapeHtml(title)}</h2>
    </div>
    <div class="driver-profile-info-grid">${rows.join("")}</div>
  </section>`;
}

function renderBioSection(profile) {
  const bio = profileText(profile, "bio");
  if (!bio) return "";

  return `<section class="driver-profile-bio-section">
    <div class="driver-profile-section-head">
      <h2>Bio</h2>
    </div>
    <p class="driver-profile-bio-text">${escapeHtml(bio)}</p>
  </section>`;
}

function renderDriverInfoSection(profile) {
  return renderInfoSection("Driver Info", [
    ["Years Sim Racing", profileText(profile, "years_sim_racing", "yearsSimRacing")],
    ["Driving Style", profileText(profile, "driving_style", "drivingStyle")],
    ["Favorite Track", profileText(profile, "favorite_track", "favoriteTrack")],
    [
      "Favorite NASCAR Driver",
      profileText(profile, "favorite_nascar_driver", "favoriteNascarDriver"),
    ],
  ]);
}

function renderCareerNotesSection(profile) {
  return renderInfoSection("Career Notes", [
    [
      "Biggest accomplishment in sim racing",
      profileText(profile, "sim_racing_accomplishment", "simRacingAccomplishment"),
    ],
    ["Goal for this season", profileText(profile, "season_goal", "seasonGoal")],
    [
      "Something fans may not know",
      profileText(profile, "fun_fact", "funFact"),
    ],
  ]);
}

function renderMetaRow(profile) {
  const items = [
    metaItem("Date of Birth", profile.dateOfBirth || profile.date_of_birth),
    metaItem("Hometown", profile.hometown),
    metaItem("Team", profile.team),
  ].filter(Boolean);

  if (!items.length) return "";
  return `<div class="driver-profile-meta-row">${items.join("")}</div>`;
}

function formatCellValue(value, formatter) {
  if (value === null || value === undefined || value === "") return "—";
  return formatter ? formatter(value) : String(value);
}

function formatOrdinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return "—";
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function formatFinish(value) {
  const finish = Number(value);
  if (!Number.isFinite(finish) || finish < 1) return "—";
  return formatOrdinal(finish);
}

function parseFinish(value) {
  const finish = Number(value);
  return Number.isFinite(finish) && finish >= 1 ? finish : null;
}

function sampleResultFromBucket(bucket) {
  if (!bucket || typeof bucket !== "object") return null;
  return Object.values(bucket).find((result) => result?.finish_pos != null) || null;
}

function pickOfficialRaceBucket(schedule) {
  const buckets = [];

  for (const [bucketKey, bucket] of Object.entries(schedule?.drivers || {})) {
    const sample = sampleResultFromBucket(bucket);
    if (!sample) continue;
    buckets.push({
      bucketKey,
      bucket,
      sample,
      session: String(sample.session || "").toUpperCase(),
      countStats: String(sample.count_stats || "").toUpperCase(),
      sessionNum: Number(sample.session_num ?? -999),
    });
  }

  if (!buckets.length) return null;

  const raceSession = buckets.find((entry) => entry.session === "RACE");
  if (raceSession) return raceSession;

  const countedSession = buckets.find((entry) => entry.countStats === "Y");
  if (countedSession) return countedSession;

  return buckets.sort((a, b) => b.sessionNum - a.sessionNum)[0];
}

function normalizeDriverRaceResult(result) {
  if (!result || typeof result !== "object") return null;

  const finish = parseFinish(result.finish_pos ?? result.finish);
  if (!finish) return null;

  const startingPos = Number(result.qualify_pos);
  const lapsLed = Number(result.laps_led);
  const incidents = Number(result.incidents);

  return {
    finish,
    startingPos: Number.isFinite(startingPos) && startingPos > 0 ? startingPos : null,
    lapsLed: Number.isFinite(lapsLed) ? lapsLed : null,
    incidents: Number.isFinite(incidents) ? incidents : null,
  };
}

function extractFinishRacesFromSchedules(schedules) {
  const races = [];

  for (const [scheduleKey, schedule] of Object.entries(schedules || {})) {
    const official = pickOfficialRaceBucket(schedule);
    if (!official) continue;

    const finishes = {};
    const driverResults = {};

    for (const [driverId, result] of Object.entries(official.bucket)) {
      const normalized = normalizeDriverRaceResult(result);
      if (!normalized) continue;
      finishes[String(driverId)] = normalized.finish;
      driverResults[String(driverId)] = normalized;
    }

    if (!Object.keys(finishes).length) continue;

    const winnerEntry = Object.entries(finishes).find(([, finish]) => finish === 1);

    races.push({
      scheduleKey,
      scheduleId: schedule.schedule_id ?? null,
      raceDate: schedule.race_date ?? null,
      finishes,
      driverResults,
      winnerDriverId: winnerEntry?.[0] ?? null,
    });
  }

  return races.sort((a, b) => {
    const ad = Number(a.raceDate) || 0;
    const bd = Number(b.raceDate) || 0;
    if (ad !== bd) return ad - bd;
    return Number(a.scheduleKey) - Number(b.scheduleKey);
  });
}

function isNonPointsRace(race) {
  const points = String(race?.points ?? "")
    .trim()
    .toLowerCase();
  const status = String(race?.status ?? "")
    .trim()
    .toLowerCase();
  const label = String(race?.track ?? "");
  if (points === "no" || status === "non-points") return true;
  return NON_POINTS_LABEL_PATTERN.test(label);
}

function enrichScheduleRaces(races) {
  let officialPointsRaceNumber = 0;

  return (races || []).map((race) => {
    const scheduleRow = Number(race?.raceNumber ?? race?.scheduleRow);
    const nonPoints = isNonPointsRace(race);

    if (nonPoints) {
      return {
        ...race,
        scheduleRow: Number.isFinite(scheduleRow) ? scheduleRow : null,
        nonPoints: true,
        officialPointsRaceNumber: null,
      };
    }

    officialPointsRaceNumber += 1;
    return {
      ...race,
      scheduleRow: Number.isFinite(scheduleRow) ? scheduleRow : null,
      nonPoints: false,
      officialPointsRaceNumber,
    };
  });
}

function extractScheduleIdFromLink(link) {
  const match = String(link || "").match(/schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

function buildCompletedPointsRaces(scheduleRaces) {
  return enrichScheduleRaces(scheduleRaces).filter(
    (race) => !race.nonPoints && race.winner && race.officialPointsRaceNumber != null
  );
}

function alignDriverRaceHistory(driverId, schedules, scheduleRaces) {
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  const completedPoints = buildCompletedPointsRaces(scheduleRaces);
  const finishByScheduleId = new Map(
    finishRaces
      .filter((race) => race.scheduleId != null)
      .map((race) => [String(race.scheduleId), race])
  );
  const usedFinishKeys = new Set();
  const aligned = [];

  for (const race of completedPoints) {
    const scheduleId =
      race.scheduleId != null
        ? String(race.scheduleId)
        : extractScheduleIdFromLink(race.link);
    let finishRace = scheduleId ? finishByScheduleId.get(scheduleId) : null;

    if (finishRace) {
      usedFinishKeys.add(String(finishRace.scheduleKey));
    } else {
      const remaining = finishRaces.filter(
        (entry) => !usedFinishKeys.has(String(entry.scheduleKey))
      );
      finishRace = remaining[0] || null;
      if (finishRace) usedFinishKeys.add(String(finishRace.scheduleKey));
    }

    const finish = finishRace?.finishes?.[String(driverId)];
    if (!Number.isFinite(finish)) continue;

    const result = finishRace?.driverResults?.[String(driverId)] || null;
    aligned.push({
      raceNumber: race.officialPointsRaceNumber,
      track: race.track,
      date: race.date,
      finish,
      startingPos: result?.startingPos ?? null,
      lapsLed: result?.lapsLed ?? null,
      incidents: result?.incidents ?? null,
    });
  }

  return aligned;
}

function computeBestFinish(driverId, schedules) {
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  let best = null;

  for (const race of finishRaces) {
    const finish = race.finishes?.[String(driverId)];
    if (!Number.isFinite(finish)) continue;
    if (best === null || finish < best) best = finish;
  }

  return best;
}

function buildStats(profile, standingsRow, schedules, scheduleRaces, statsContext = {}) {
  const leader = standingsRow?.leader || null;
  const pointsBehind =
    leader && standingsRow?.points != null
      ? Math.max(0, Number(leader.points) - Number(standingsRow.points))
      : null;
  const statsDriverId = statsContext.statsDriverId || profile.driver_id;
  const recentRaces = alignDriverRaceHistory(statsDriverId, schedules, scheduleRaces);
  const bestFinish = computeBestFinish(statsDriverId, schedules);

  return {
    position: standingsRow?.position ?? null,
    points: standingsRow?.points ?? null,
    pointsBehind,
    races: standingsRow?.races ?? null,
    wins: standingsRow?.wins ?? null,
    top5: standingsRow?.top5 ?? null,
    top10: standingsRow?.top10 ?? null,
    avgFinish: standingsRow?.avgFinish ?? null,
    lapsLed: standingsRow?.lapsLed ?? null,
    incidents: standingsRow?.incidents ?? null,
    bestFinish,
    recentRaces: [...recentRaces].reverse(),
    identity: statsContext.identity || null,
    statsSource: statsContext.statsSource || null,
  };
}

function isStatsDebugEnabled() {
  return new URLSearchParams(window.location.search).get("debug") === "stats";
}

function statsEmptyMessage(stats, section) {
  const identity = stats?.identity;
  const hasStarts =
    Number(stats?.races) > 0 ||
    Number(stats?.recentRaces?.length) > 0 ||
    Number.isFinite(Number(stats?.bestFinish));

  if (identity?.resolved === false) {
    if (isStatsDebugEnabled()) {
      return "Driver profile could not be linked to SimRacerHub identity.";
    }
    return section === "results"
      ? "No completed race results yet."
      : "Season stats are not available yet.";
  }

  if (!hasStarts) {
    return "No official starts yet.";
  }

  return section === "results"
    ? "No completed race results yet."
    : "Season stats are not available yet.";
}

function renderStatsDiagnostics(diagnostics) {
  if (!isStatsDebugEnabled() || !diagnostics) return "";
  const rows = Object.entries(diagnostics)
    .map(
      ([key, value]) =>
        `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value == null ? "—" : String(value))}</td></tr>`
    )
    .join("");
  return `<section class="driver-profile-stats-section driver-profile-stats-debug">
    <div class="driver-profile-section-head">
      <h2>Stats Identity Diagnostics</h2>
    </div>
    <div class="driver-profile-results-wrap">
      <table class="driver-profile-results-table">
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderStatsBar(stats, seasonLabel) {
  const items = [
    statTile("Points Position", stats.position ? formatOrdinal(stats.position) : null),
    statTile("Points", stats.points, { allowZero: true }),
    statTile("Behind Leader", stats.pointsBehind, { allowZero: true }),
    statTile("Races", stats.races, { allowZero: true }),
    statTile("Wins", stats.wins, { allowZero: true }),
    statTile("Top 5s", stats.top5, { allowZero: true }),
    statTile("Top 10s", stats.top10, { allowZero: true }),
    statTile("Average Finish", stats.avgFinish),
    statTile("Best Finish", stats.bestFinish ? formatOrdinal(stats.bestFinish) : null),
    statTile("Incidents", stats.incidents, { allowZero: true }),
    statTile("Laps Led", stats.lapsLed, { allowZero: true }),
  ].filter(Boolean);

  const title = seasonLabel ? `${seasonLabel} Season` : "Season Stats";

  if (!items.length) {
    return `<section class="driver-profile-stats-section">
      <div class="driver-profile-section-head">
        <h2>${escapeHtml(title)}</h2>
      </div>
      <p class="driver-profile-empty">${escapeHtml(statsEmptyMessage(stats, "season"))}</p>
    </section>`;
  }

  return `<section class="driver-profile-stats-section">
    <div class="driver-profile-section-head">
      <h2>${escapeHtml(title)}</h2>
    </div>
    <div class="driver-profile-stats-bar">${items.join("")}</div>
  </section>`;
}

function renderRecentResults(recentRaces, stats = null) {
  if (!recentRaces?.length) {
    return `<section class="driver-profile-results-section">
      <div class="driver-profile-section-head">
        <h2>Recent Results</h2>
      </div>
      <p class="driver-profile-empty">${escapeHtml(statsEmptyMessage(stats, "results"))}</p>
    </section>`;
  }

  const rows = recentRaces
    .map(
      (race) => `<tr>
        <td>Race ${escapeHtml(race.raceNumber)}</td>
        <td>${escapeHtml(race.track || "—")}</td>
        <td class="driver-profile-finish">${formatFinish(race.finish)}</td>
        <td>${formatCellValue(race.startingPos, formatOrdinal)}</td>
        <td>${formatCellValue(race.lapsLed)}</td>
        <td>${formatCellValue(race.incidents)}</td>
      </tr>`
    )
    .join("");

  return `<section class="driver-profile-results-section">
    <div class="driver-profile-section-head">
      <h2>Recent Results</h2>
    </div>
    <div class="driver-profile-results-wrap">
      <table class="driver-profile-results-table">
        <thead>
          <tr>
            <th>Race</th>
            <th>Track</th>
            <th>Finish</th>
            <th>Start Position</th>
            <th>Laps Led</th>
            <th>Incidents</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function driverNameSizeClasses(name) {
  const len = String(name || "").trim().length;
  const nameClass =
    len > 24
      ? "driver-profile-name--very-long"
      : len > 18
        ? "driver-profile-name--long"
        : "";
  const nameStackClass =
    len > 24
      ? "driver-profile-name-stack--very-long"
      : len > 18
        ? "driver-profile-name-stack--long"
        : "";
  return { nameClass, nameStackClass };
}

function renderHeroPhoto(profile, name) {
  const standing = window.BPDriverStandingPhoto;
  if (standing?.hasStandingPhoto(profile)) {
    const url = standing.displayUrl(profile);
    const style = standing.cropStyle(profile);
    return `<div class="driver-profile-hero-media driver-profile-hero-media--standing">
      <div class="driver-profile-standing-photo-wrap" style="${escapeAttr(style)}">
        <img
          class="driver-profile-standing-photo"
          src="${escapeAttr(url)}"
          alt="${escapeAttr(name)}"
          onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
        />
      </div>
    </div>`;
  }

  const photo = profile.photoUrl || profile.photo_url || driverImage(name);
  return `<div class="driver-profile-hero-media">
    <img
      class="driver-profile-photo"
      src="${escapeHtml(photo)}"
      alt="${escapeHtml(name)}"
      onerror="this.onerror=null;this.src='${PLACEHOLDER_PHOTO}'"
    />
  </div>`;
}

function renderProfile(profile, stats, seasonLabel, carImageUrl = "", diagnostics = null) {
  const panel = $("#driverProfilePanel");
  if (!panel || !profile) return;

  const name = profile.display_name || profile.iracing_name || "Driver";
  const number = driverBpNumber(profile);
  const { nameClass, nameStackClass } = driverNameSizeClasses(name);
  const nameClasses = ["driver-profile-name", nameClass].filter(Boolean).join(" ");
  const nameStackClasses = ["driver-profile-name-stack", nameStackClass]
    .filter(Boolean)
    .join(" ");

  document.title = `${name} — Blazing Pedals Truck Series`;

  panel.innerHTML = `
    <a class="driver-profile-back" href="/drivers.html">← Back to Drivers</a>

    <section class="driver-profile-hero">
      ${renderHeroPhoto(profile, name)}
      <div class="driver-profile-hero-info${carImageUrl ? " driver-profile-hero-info--with-car" : ""}">
        <div class="driver-profile-hero-share-row">
          <div class="driver-profile-identity">
            <div class="driver-profile-identity-namestack">
              <div class="driver-profile-identity-titlerow">
                ${
                  number
                    ? `<div class="driver-profile-number" aria-hidden="true">${escapeHtml(number)}</div>`
                    : ""
                }
                <div class="driver-profile-identity-namecol">
                  ${
                    carImageUrl
                      ? `<div class="${escapeAttr(nameStackClasses)}">
                          ${renderCarImageHeroSection(carImageUrl, name)}
                          <h1 class="${escapeAttr(nameClasses)}">${escapeHtml(name)}</h1>
                        </div>`
                      : `<div class="driver-profile-identity-text">
                          <h1 class="${escapeAttr(nameClasses)}">${escapeHtml(name)}</h1>
                        </div>`
                  }
                  ${
                    profile.iracing_name && profile.iracing_name !== name
                      ? `<p class="driver-profile-alias">${escapeHtml(profile.iracing_name)}</p>`
                      : ""
                  }
                </div>
              </div>
            </div>
          </div>
          <div id="driverProfileShareHost"></div>
        </div>
        ${
          profile.is_streamer === true
            ? `<div class="driver-profile-streamer">${streamerBadgeHtml(profile.stream_url)}</div>`
            : ""
        }
        ${renderMetaRow(profile)}
      </div>
    </section>

    ${renderBioSection(profile)}
    ${renderDriverInfoSection(profile)}
    ${renderCareerNotesSection(profile)}
    ${renderConnectSection(profile)}
    ${renderStatsBar(stats, seasonLabel)}
    ${renderRecentResults(stats.recentRaces, stats)}
    ${renderStatsDiagnostics(diagnostics)}
  `;

  if (carImageUrl) {
    scheduleDriverProfileCarAlignment(name);
  }

  const shareTitle = `${number ? `#${number} ` : ""}${name} — Blazing Pedals Truck Series`;
  const shareText = profile.bio
    ? String(profile.bio).trim().slice(0, 200)
    : `${name} driver profile — Blazing Pedals Truck Series.`;
  const shareImage = profile.photoUrl || profile.photo_url || window.BPShare?.DEFAULT_IMAGE;
  if (window.BPShare?.initPageShare) {
    window.BPShare.initPageShare("#driverProfileShareHost", {
      title: shareTitle,
      text: shareText,
      description: shareText,
      url: window.location.href,
      image: shareImage,
      type: "profile",
    });
  }
}

function renderNotFound() {
  const panel = $("#driverProfilePanel");
  if (!panel) return;
  panel.innerHTML = `
    <a class="driver-profile-back" href="/drivers.html">← Back to Drivers</a>
    <p class="muted">Driver profile not found.</p>
  `;
}

async function loadDriverProfile() {
  const panel = $("#driverProfilePanel");
  const requestedId = getDriverIdFromPath();
  if (!panel) return;

  if (!requestedId) {
    renderNotFound();
    return;
  }

  try {
    const [profile, standingsRes, scheduleRes] = await Promise.all([
      fetchDriverProfile(requestedId),
      fetch("/api/standings"),
      fetch("/api/schedule"),
    ]);

    if (!profile?.driver_id) {
      renderNotFound();
      return;
    }

    const standingsData = standingsRes.ok ? await standingsRes.json() : { rows: [], schedules: {} };
    const scheduleData = scheduleRes.ok ? await scheduleRes.json() : { races: [] };
    const rows = Array.isArray(standingsData.rows) ? standingsData.rows : [];
    const schedules = standingsData.schedules || {};
    const scheduleRaces = scheduleData.races || [];
    const identityApi = window.BPDriverStatsIdentity;
    const standingsMaps = identityApi?.buildStandingsIdentityLookupMaps
      ? identityApi.buildStandingsIdentityLookupMaps(rows)
      : null;
    const identity = identityApi?.resolveDriverStatsIdentity
      ? identityApi.resolveDriverStatsIdentity(profile, {
          standingsRows: rows,
          standingsMaps,
        })
      : { resolved: false, srhDriverId: null, matchedBy: null };
    const standingsRow = identityApi?.findStandingsRowForIdentity
      ? identityApi.findStandingsRowForIdentity(identity, rows, standingsMaps)
      : rows.find((row) => String(row.driverId) === String(profile.driver_id)) || null;
    const leader = rows.find((row) => Number(row.position) === 1) || null;
    const statsDriverId =
      identity.resolved && identity.srhDriverId ? identity.srhDriverId : profile.driver_id;

    const stats = buildStats(
      profile,
      standingsRow ? { ...standingsRow, leader } : null,
      schedules,
      scheduleRaces,
      {
        statsDriverId,
        identity,
        statsSource: identity.resolved ? "simracerhub_standings" : null,
      }
    );

    const diagnostics = identityApi?.buildDriverStatsIdentityDiagnostics
      ? identityApi.buildDriverStatsIdentityDiagnostics(profile, {
          standingsRows: rows,
          standingsMaps,
          schedules,
          recentRaces: stats.recentRaces,
        })
      : null;

    const seasonLabel =
      standingsData.settings?.seasonName || scheduleData.settings?.seasonName || "Season 11";

    const carImage = await resolveCarImageUrl(profile);
    renderProfile(profile, stats, seasonLabel, carImage.url, diagnostics);
  } catch (e) {
    console.error("Failed to load driver profile:", e);
    panel.innerHTML = `
      <a class="driver-profile-back" href="/drivers.html">← Back to Drivers</a>
      <p class="muted">Failed to load driver profile.</p>
    `;
  }
}

loadDriverProfile();
