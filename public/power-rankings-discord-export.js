(function () {
  const PLACEHOLDER = "/assets/drivers/placeholder.png";
  const EXPORT_WIDTH = 1920;
  const EXPORT_HEIGHT = 1080;
  const CANVAS_SCALE = 1;
  const MOVEMENT_NEW_SENTINEL = 100;
  const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;
  const BP_LOGO = "/assets/logos/New%20Clean%20Logo.png";
  const PROPHET_LOGO = "/assets/logos/pedal-prophet-logo.png";
  const TRUCK_COLOR_CACHE_KEY = "bp_pr_truck_colors_v1";
  const DEFAULT_CAR_FILL = "#ffffff";
  const DEFAULT_CAR_OUTLINE = "#1a4fd6";

  let scheduleTrackMapCache = null;
  const truckColorCache = new Map();

  try {
    const stored = JSON.parse(localStorage.getItem(TRUCK_COLOR_CACHE_KEY) || "{}");
    Object.entries(stored).forEach(([key, value]) => {
      if (value?.fill && value?.outline) truckColorCache.set(key, value);
    });
  } catch {
    /* ignore corrupt cache */
  }

  function persistTruckColorCache() {
    try {
      const obj = Object.fromEntries(truckColorCache.entries());
      localStorage.setItem(TRUCK_COLOR_CACHE_KEY, JSON.stringify(obj));
    } catch {
      /* quota / private mode */
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatPublishedDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatPublishedUpper(value) {
    const formatted = formatPublishedDate(value);
    return formatted ? `PUBLISHED ${formatted.toUpperCase()}` : "";
  }

  function normalizeSeasonLabel(seasonName) {
    const raw = String(seasonName || "Season 11").trim() || "Season 11";
    return raw.toUpperCase();
  }

  function slugifyName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function stripUrlQuery(url) {
    return String(url || "")
      .trim()
      .split("?")[0]
      .split("#")[0];
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

  function buildPointsRaceTrackMap(races) {
    let officialPointsRaceNumber = 0;
    const map = {};
    for (const race of races || []) {
      if (isNonPointsRace(race)) continue;
      officialPointsRaceNumber += 1;
      map[officialPointsRaceNumber] = String(race.track || "").trim();
    }
    return map;
  }

  async function resolveTrackName(raceNumber, week = {}) {
    const fromWeek = String(week.trackName || week.track || "").trim();
    if (fromWeek) return fromWeek;

    if (!scheduleTrackMapCache) {
      try {
        const res = await fetch("/api/schedule");
        const data = await res.json();
        scheduleTrackMapCache = buildPointsRaceTrackMap(data.races || []);
      } catch {
        scheduleTrackMapCache = {};
      }
    }

    return scheduleTrackMapCache[Number(raceNumber)] || "";
  }

  function movementTypeFromStored(movement) {
    if (Number(movement) === MOVEMENT_NEW_SENTINEL) return "new";
    const value = Number(movement);
    if (!Number.isFinite(value) || value === 0) return "unchanged";
    if (value > 0) return "up";
    return "down";
  }

  function formatMovementDisplay(movement, movementType) {
    const type = movementType || movementTypeFromStored(movement);
    if (type === "new") return { text: "NEW", class: "new" };
    const value = Number(movement);
    if (!Number.isFinite(value) || value === MOVEMENT_NEW_SENTINEL || value === 0) {
      return { text: "—", class: "unchanged" };
    }
    if (value > 0) return { text: `▲${value}`, class: "positive" };
    return { text: `▼${Math.abs(value)}`, class: "negative" };
  }

  function parseMovementInput(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return { movement: 0, movementType: "unchanged" };
    const upper = raw.toUpperCase();
    if (upper === "NEW" || upper === "NR") {
      return { movement: MOVEMENT_NEW_SENTINEL, movementType: "new" };
    }
    if (upper === "—" || upper === "-" || upper === "0") {
      return { movement: 0, movementType: "unchanged" };
    }
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return {
      movement: numeric,
      movementType:
        numeric === MOVEMENT_NEW_SENTINEL
          ? "new"
          : numeric > 0
            ? "up"
            : numeric < 0
              ? "down"
              : "unchanged",
    };
  }

  function driverPhotoUrl(profile, name) {
    const photo = stripUrlQuery(profile?.photo_url || profile?.photoUrl || "");
    if (photo) return photo;
    const slug = slugifyName(
      profile?.display_name || profile?.displayName || profile?.iracing_name || name,
    );
    return slug ? `/assets/drivers/${slug}.png` : PLACEHOLDER;
  }

  function driverCarImageUrl(profile) {
    return stripUrlQuery(profile?.car_image_url || profile?.carImageUrl || "");
  }

  function normalizeEntry(entry) {
    const movementParsed = parseMovementInput(entry.movementInput ?? entry.movement);
    const movementType = entry.movementType || movementParsed?.movementType;
    const movementValue =
      entry.movement != null && entry.movement !== ""
        ? Number(entry.movement)
        : movementParsed?.movement ?? 0;
    const movement = formatMovementDisplay(movementValue, movementType);

    return {
      rank: Number(entry.rank),
      driverId: entry.driverId || entry.driver_id || "",
      driverName: entry.driverName || "Unknown Driver",
      carNumber: entry.carNumber || "",
      carImageUrl: entry.carImageUrl || "",
      photoUrl: entry.photoUrl || PLACEHOLDER,
      movementText: entry.movementText || movement.text,
      movementClass: entry.movementClass || movement.class,
      subtitle: entry.subtitle || "",
      writeup: entry.writeup || "",
    };
  }

  function cardTierClass(rank) {
    if (rank === 1) return "pr-de-card--gold";
    if (rank === 2) return "pr-de-card--silver";
    if (rank === 3) return "pr-de-card--bronze";
    return "";
  }

  function subtitleToneClass(entry) {
    const rank = Number(entry.rank);
    if (rank === 1) return "pr-de-subtitle--gold";
    if (rank === 2) return "pr-de-subtitle--silver";
    if (rank === 3) return "pr-de-subtitle--bronze";
    if (entry.movementClass === "positive") return "pr-de-subtitle--positive";
    if (entry.movementClass === "negative") return "pr-de-subtitle--negative";
    if (entry.movementClass === "new") return "pr-de-subtitle--new";
    return "";
  }

  function carColorStyleAttr(colors) {
    const fill = colors?.fill || DEFAULT_CAR_FILL;
    const outline = colors?.outline || DEFAULT_CAR_OUTLINE;
    const keyline = colors?.keyline || "";
    return ` style="--pr-car-fill:${fill};--pr-car-outline:${outline};${keyline ? `--pr-car-keyline:${keyline};` : ""}"`;
  }

  function renderCardHtml(entry) {
    const normalized = normalizeEntry(entry);
    const tier = cardTierClass(normalized.rank);
    const subtitleTone = subtitleToneClass(normalized);
    const moveClass = normalized.movementClass || "unchanged";

    return `<article class="pr-de-card ${tier}" data-driver-id="${escapeHtml(normalized.driverId)}" data-car-image="${escapeHtml(normalized.carImageUrl)}">
      <div class="pr-de-card-top">
        <span class="pr-de-rank">${normalized.rank}</span>
        <span class="pr-de-move ${escapeHtml(moveClass)}">${escapeHtml(normalized.movementText)}</span>
      </div>
      <div class="pr-de-card-mid">
        <span class="pr-de-car-num"${carColorStyleAttr()}>${escapeHtml(normalized.carNumber || "—")}</span>
        <img class="pr-de-photo" src="${escapeHtml(normalized.photoUrl)}" alt="" crossorigin="anonymous" />
      </div>
      <p class="pr-de-name">${escapeHtml(normalized.driverName)}</p>
      <p class="pr-de-subtitle ${subtitleTone}">${escapeHtml(normalized.subtitle)}</p>
    </article>`;
  }

  function renderHonorableHtml(mention) {
    const normalized = normalizeEntry({
      ...mention,
      rank: 0,
      movement: 0,
      movementType: "unchanged",
      subtitle: "",
    });

    return `<div class="pr-de-honorable-item" data-driver-id="${escapeHtml(normalized.driverId)}" data-car-image="${escapeHtml(normalized.carImageUrl)}">
      <span class="pr-de-honorable-num"${carColorStyleAttr()}>${escapeHtml(normalized.carNumber || "—")}</span>
      <img class="pr-de-honorable-photo" src="${escapeHtml(normalized.photoUrl)}" alt="" crossorigin="anonymous" />
      <p class="pr-de-honorable-name">${escapeHtml(normalized.driverName)}</p>
    </div>`;
  }

  function renderExportBanner(week) {
    const raceNumber = Number(week.raceNumber);
    const season = normalizeSeasonLabel(week.seasonName);
    const raceLabel = `RACE ${raceNumber} RANKINGS`;
    const published = formatPublishedUpper(week.publishedDate);

    return `<header class="pr-de-header">
      <div class="pr-de-header-bp">
        <img class="pr-de-bp-logo" src="${BP_LOGO}" alt="" crossorigin="anonymous" />
        <p class="pr-de-season">${escapeHtml(season)}</p>
      </div>
      <div class="pr-de-title-wrap">
        <h1 class="pr-de-kicker">POWER RANKINGS</h1>
      </div>
      <div class="pr-de-header-prophet">
        <img class="pr-de-prophet-logo" src="${PROPHET_LOGO}" alt="" crossorigin="anonymous" />
        <p class="pr-de-prophet-tag">Power Rankings &amp; Race Analysis</p>
      </div>
    </header>
    <div class="pr-de-subbar">
      <div class="pr-de-subbar-left">${escapeHtml(raceLabel)}</div>
      <div class="pr-de-subbar-right">${escapeHtml(published)}</div>
    </div>`;
  }

  function buildExportHtml(week) {
    const entries = (week.entries || [])
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, 10);

    const mentions = (week.honorableMentions || []).filter(
      (m) => m.driverName || m.driverId,
    );

    const honorableBlock = mentions.length
      ? `<section class="pr-de-honorable">
          <h2 class="pr-de-honorable-head">Honorable Mentions</h2>
          <div class="pr-de-honorable-list">
            ${mentions.map(renderHonorableHtml).join("")}
          </div>
        </section>`
      : "";

    return `<div class="pr-discord-export-root${mentions.length ? " pr-discord-export-root--with-honorable" : ""}">
      ${renderExportBanner(week)}
      <div class="pr-de-grid">
        ${entries.map(renderCardHtml).join("")}
      </div>
      ${honorableBlock}
      <p class="pr-de-footer">FAST DRIVERS. CLOSE RACING. BIG FUN.</p>
    </div>`;
  }

  function getExportHost() {
    let host = document.getElementById("prDiscordExportHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "prDiscordExportHost";
      host.className = "pr-discord-export-host";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
    }
    return host;
  }

  function isCrossOrigin(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      return parsed.origin !== window.location.origin;
    } catch {
      return false;
    }
  }

  function relativeLuminance(r, g, b) {
    const channel = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrastRatio(l1, l2) {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function rgbToHex(r, g, b) {
    const part = (n) => n.toString(16).padStart(2, "0");
    return `#${part(r)}${part(g)}${part(b)}`;
  }

  function parseHex(hex) {
    const clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return null;
    const num = Number.parseInt(clean, 16);
    if (!Number.isFinite(num)) return null;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function colorDistance(a, b) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  function isIgnorablePixel(r, g, b, a) {
    if (a < 120) return true;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2 / 255;
    if (lightness < 0.07 || lightness > 0.94) return true;
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.12 && lightness > 0.2 && lightness < 0.85) return true;
    return false;
  }

  function extractDominantColorsFromImageData(data) {
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (isIgnorablePixel(r, g, b, a)) continue;
      const key = `${Math.round(r / 24) * 24},${Math.round(g / 24) * 24},${Math.round(b / 24) * 24}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;

    const toRgb = (key) => {
      const [r, g, b] = key.split(",").map((v) => Number(v));
      return { r, g, b };
    };

    const primary = toRgb(sorted[0][0]);
    let secondary = primary;
    for (let i = 1; i < sorted.length; i += 1) {
      const candidate = toRgb(sorted[i][0]);
      if (colorDistance(primary, candidate) >= 48) {
        secondary = candidate;
        break;
      }
    }

    if (colorDistance(primary, secondary) < 48) {
      secondary = {
        r: Math.min(255, Math.max(0, 255 - primary.r)),
        g: Math.min(255, Math.max(0, 255 - primary.g)),
        b: Math.min(255, Math.max(0, 255 - primary.b)),
      };
    }

    return {
      fill: rgbToHex(primary.r, primary.g, primary.b),
      outline: rgbToHex(secondary.r, secondary.g, secondary.b),
    };
  }

  function finalizeCarColors(colors) {
    const fillRgb = parseHex(colors.fill);
    const outlineRgb = parseHex(colors.outline);
    if (!fillRgb || !outlineRgb) {
      return {
        fill: DEFAULT_CAR_FILL,
        outline: DEFAULT_CAR_OUTLINE,
        keyline: "1px 1px 0 #000,-1px -1px 0 #000",
      };
    }

    const fillLum = relativeLuminance(fillRgb.r, fillRgb.g, fillRgb.b);
    const outlineLum = relativeLuminance(outlineRgb.r, outlineRgb.g, outlineRgb.b);
    const ratio = contrastRatio(fillLum, outlineLum);
    let keyline = "";
    if (ratio < 2.8) {
      keyline =
        fillLum > 0.45
          ? "1px 1px 0 #000,-1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000"
          : "1px 1px 0 #fff,-1px 1px 0 #fff,-1px -1px 0 #fff,1px -1px 0 #fff";
    }

    return { fill: colors.fill, outline: colors.outline, keyline };
  }

  function cacheKeyForCarImage(url, driverId) {
    const image = stripUrlQuery(url);
    if (image) return image;
    if (driverId) return `driver:${driverId}`;
    return "";
  }

  async function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (isCrossOrigin(url)) img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load ${url}`));
      img.src = url;
    });
  }

  async function resolveTruckColors(carImageUrl, driverId) {
    const key = cacheKeyForCarImage(carImageUrl, driverId);
    if (!key) return finalizeCarColors({ fill: DEFAULT_CAR_FILL, outline: DEFAULT_CAR_OUTLINE });
    if (truckColorCache.has(key)) return truckColorCache.get(key);

    const url = stripUrlQuery(carImageUrl);
    if (!url) {
      const fallback = finalizeCarColors({ fill: DEFAULT_CAR_FILL, outline: DEFAULT_CAR_OUTLINE });
      truckColorCache.set(key, fallback);
      persistTruckColorCache();
      return fallback;
    }

    try {
      const img = await loadImageElement(url);
      const canvas = document.createElement("canvas");
      const size = 72;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      const extracted = extractDominantColorsFromImageData(ctx.getImageData(0, 0, size, size).data);
      const finalized = finalizeCarColors(
        extracted || { fill: DEFAULT_CAR_FILL, outline: DEFAULT_CAR_OUTLINE },
      );
      truckColorCache.set(key, finalized);
      persistTruckColorCache();
      return finalized;
    } catch {
      const fallback = finalizeCarColors({ fill: DEFAULT_CAR_FILL, outline: DEFAULT_CAR_OUTLINE });
      truckColorCache.set(key, fallback);
      persistTruckColorCache();
      return fallback;
    }
  }

  function applyColorsToElement(el, colors) {
    if (!el || !colors) return;
    el.style.setProperty("--pr-car-fill", colors.fill);
    el.style.setProperty("--pr-car-outline", colors.outline);
    if (colors.keyline) {
      el.style.setProperty("--pr-car-keyline", colors.keyline);
    } else {
      el.style.removeProperty("--pr-car-keyline");
    }
  }

  async function applyTruckColorsToExportRoot(root, week) {
    const cards = [...root.querySelectorAll(".pr-de-card")];
    const entries = (week.entries || [])
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, 10);

    const cardTasks = entries.map(async (entry, index) => {
      const normalized = normalizeEntry(entry);
      const numEl = cards[index]?.querySelector(".pr-de-car-num");
      if (!numEl) return;
      const colors = await resolveTruckColors(normalized.carImageUrl, normalized.driverId);
      applyColorsToElement(numEl, colors);
    });

    const honorableItems = [...root.querySelectorAll(".pr-de-honorable-item")];
    const mentions = (week.honorableMentions || []).filter((m) => m.driverName || m.driverId);

    const mentionTasks = mentions.map(async (mention, index) => {
      const normalized = normalizeEntry(mention);
      const numEl = honorableItems[index]?.querySelector(".pr-de-honorable-num");
      if (!numEl) return;
      const colors = await resolveTruckColors(normalized.carImageUrl, normalized.driverId);
      applyColorsToElement(numEl, colors);
    });

    await Promise.all([...cardTasks, ...mentionTasks]);
  }

  async function preloadExportImages(container) {
    const images = [...container.querySelectorAll("img")];
    await Promise.all(
      images.map(
        (img) =>
          new Promise((resolve) => {
            const fallback = () => {
              if (img.classList.contains("pr-de-bp-logo")) {
                resolve();
                return;
              }
              if (img.classList.contains("pr-de-prophet-logo")) {
                resolve();
                return;
              }
              img.src = PLACEHOLDER;
              img.removeAttribute("crossorigin");
              resolve();
            };

            if (!img.getAttribute("src")) {
              fallback();
              return;
            }

            if (isCrossOrigin(img.src)) {
              img.crossOrigin = "anonymous";
            } else {
              img.removeAttribute("crossorigin");
            }

            if (img.complete && img.naturalWidth > 0) {
              resolve();
              return;
            }

            img.onload = () => resolve();
            img.onerror = fallback;
          }),
      ),
    );
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function formatDiscordEntryText(entry) {
    const normalized = normalizeEntry(entry);
    const num = normalized.carNumber ? ` #${normalized.carNumber}` : "";
    const movement =
      normalized.movementText && normalized.movementText !== "—"
        ? ` (${normalized.movementText})`
        : "";
    const lines = [`**#${normalized.rank} ${normalized.driverName}${num}**${movement}`];
    if (normalized.subtitle) lines.push(`*${normalized.subtitle}*`);
    if (normalized.writeup) lines.push(normalized.writeup);
    return lines.join("\n");
  }

  async function buildDiscordText(week) {
    const raceNumber = Number(week.raceNumber);
    const trackName = await resolveTrackName(raceNumber, week);
    const raceLine = trackName
      ? `Race ${raceNumber} • ${trackName}`
      : `Race ${raceNumber}`;
    const published = formatPublishedDate(week.publishedDate);
    const entries = (week.entries || [])
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, 10);

    const lines = [
      "**POWER RANKINGS**",
      raceLine,
      "Presented by The Pedal Prophet",
    ];
    if (published) lines.push(`Published ${published}`);
    lines.push("");

    for (const entry of entries) {
      lines.push(formatDiscordEntryText(entry));
      lines.push("");
    }

    lines.push("_Blazing Pedals Truck Series_");
    return lines.join("\n").trim() + "\n";
  }

  async function copyDiscordText(week) {
    const text = await buildDiscordText(week);
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard access is not available in this browser.");
    }
    await navigator.clipboard.writeText(text);
    return text;
  }

  async function downloadDiscordText(week) {
    const raceNumber = validateWeek(week);
    const text = await buildDiscordText(week);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `bp-power-rankings-race-${raceNumber}.txt`);
    return text;
  }

  function validateWeek(week) {
    if (!week) throw new Error("No rankings loaded to export.");
    const raceNumber = Number(week.raceNumber);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      throw new Error("Valid race number is required before exporting.");
    }
    const entries = (week.entries || []).filter(
      (entry) => entry.driverName || entry.driverId,
    );
    if (entries.length < 10) {
      throw new Error("All 10 rankings must have drivers before exporting.");
    }
    return raceNumber;
  }

  async function renderWeekToPng(week, options = {}) {
    if (typeof html2canvas !== "function") {
      throw new Error("Export library failed to load. Refresh and try again.");
    }

    const raceNumber = validateWeek(week);
    const host = getExportHost();
    host.innerHTML = buildExportHtml(week);
    const root = host.querySelector(".pr-discord-export-root");
    if (!root) throw new Error("Could not build export layout.");

    host.style.visibility = "visible";

    try {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await preloadExportImages(root);
      await applyTruckColorsToExportRoot(root, week);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const canvas = await html2canvas(root, {
        backgroundColor: "#0a0a0a",
        scale: CANVAS_SCALE,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        windowWidth: EXPORT_WIDTH,
        windowHeight: EXPORT_HEIGHT,
        scrollX: 0,
        scrollY: 0,
        ...options.canvasOptions,
      });

      if (canvas.width !== EXPORT_WIDTH || canvas.height !== EXPORT_HEIGHT) {
        const fitted = document.createElement("canvas");
        fitted.width = EXPORT_WIDTH;
        fitted.height = EXPORT_HEIGHT;
        const ctx = fitted.getContext("2d");
        ctx.drawImage(canvas, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
        canvas.width = EXPORT_WIDTH;
        canvas.height = EXPORT_HEIGHT;
        const targetCtx = canvas.getContext("2d");
        targetCtx.drawImage(fitted, 0, 0);
      }

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("PNG export failed."));
          },
          "image/png",
          1,
        );
      });

      return {
        raceNumber,
        blob,
        canvas,
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
      };
    } finally {
      host.innerHTML = "";
      host.style.visibility = "hidden";
    }
  }

  async function exportWeek(week, options = {}) {
    const result = await renderWeekToPng(week, options);
    downloadBlob(result.blob, `bp-power-rankings-race-${result.raceNumber}.png`);
    return result;
  }

  async function downloadWeekPng(week, options = {}) {
    return exportWeek(week, options);
  }

  async function previewWeekPng(week, options = {}) {
    const result = await renderWeekToPng(week, options);
    const url = URL.createObjectURL(result.blob);
    return { ...result, objectUrl: url };
  }

  function buildWeekFromAdminForm(formData, driverOptions = [], profileById = {}) {
    const byDriverId = Object.fromEntries(
      (driverOptions || []).map((driver) => [String(driver.driver_id), driver]),
    );

    const mapDriverEntry = (entry, rank) => {
      const driver =
        byDriverId[String(entry.driverId)] || profileById[String(entry.driverId)] || {};
      const profile = profileById[String(entry.driverId)] || driver;
      const name =
        driver.display_name ||
        driver.displayName ||
        profile?.display_name ||
        profile?.iracing_name ||
        "Unknown Driver";
      const movementParsed = parseMovementInput(entry.movement);
      const movement = movementParsed
        ? formatMovementDisplay(movementParsed.movement, movementParsed.movementType)
        : formatMovementDisplay(0, "unchanged");

      return {
        rank,
        driverId: entry.driverId,
        driverName: name,
        carNumber: driver.car_number || profile?.car_number || "",
        carImageUrl: driverCarImageUrl(profile),
        photoUrl: driverPhotoUrl(profile, name),
        movement: movementParsed?.movement ?? 0,
        movementType: movementParsed?.movementType,
        movementText: movement.text,
        movementClass: movement.class,
        subtitle: entry.subtitle || "",
        writeup: entry.writeup || "",
      };
    };

    const entries = (formData.entries || [])
      .filter((entry) => entry.driverId)
      .map((entry) => mapDriverEntry(entry, entry.rank));

    const honorableMentions = (formData.honorableMentions || [])
      .filter((mention) => mention.driverId)
      .map((mention) => mapDriverEntry(mention, 0));

    return {
      raceNumber: formData.raceNumber,
      publishedDate: formData.publishedDate,
      seasonName: formData.seasonName || "Season 11",
      label: `Race ${formData.raceNumber} Rankings`,
      trackName: formData.trackName || "",
      entries,
      honorableMentions,
    };
  }

  window.BPPowerRankingsDiscordExport = {
    EXPORT_WIDTH,
    EXPORT_HEIGHT,
    CANVAS_SCALE,
    PLACEHOLDER,
    buildWeekFromAdminForm,
    exportWeek,
    downloadWeekPng,
    previewWeekPng,
    renderWeekToPng,
    buildExportHtml,
    renderCardHtml,
    resolveTrackName,
    buildPointsRaceTrackMap,
    buildDiscordText,
    copyDiscordText,
    downloadDiscordText,
    resolveTruckColors,
  };
})();
