(function () {
  const EXPORT_WIDTH = 1920;
  const EXPORT_HEIGHT = 1080;
  const PLACEHOLDER = "/assets/drivers/placeholder.png";
  const MOVEMENT_NEW_SENTINEL = 100;
  const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;
  const BP_LOGO = "/assets/logos/New%20Clean%20Logo.png";
  const PROPHET_LOGO = "/assets/logos/pedal-prophet-logo.png";
  const TRUCK_COLOR_CACHE_KEY = "bp_pr_suit_colors_v3";
  const WATERMARK_OPACITY = 0.35;
  const WATERMARK_SIZE = 1080;
  const WATERMARK_CENTER_Y = 520;
  const CARD_PANEL_ALPHA = 0.72;
  const PORTRAIT_SCALE = 1.1;
  const HONORABLE_PORTRAIT_SCALE = 1.62;
  const CARD_BOTTOM_TEXT_PAD = 9;

  const FONT_DISPLAY = 'Impact, "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
  const FONT_BODY = '"Arial Narrow", "Roboto Condensed", Impact, Arial, sans-serif';

  let scheduleTrackMapCache = null;
  const suitColorCache = new Map();
  const imageAssetCache = new Map();
  let lastRenderDiagnostics = null;
  let lastSuitColorReport = [];

  try {
    const stored = JSON.parse(localStorage.getItem(TRUCK_COLOR_CACHE_KEY) || "{}");
    Object.entries(stored).forEach(([key, value]) => {
      if (value?.fill && value?.outline) suitColorCache.set(key, value);
    });
  } catch {
    /* ignore */
  }

  function persistTruckColorCache() {
    try {
      localStorage.setItem(
        TRUCK_COLOR_CACHE_KEY,
        JSON.stringify(Object.fromEntries(suitColorCache.entries())),
      );
    } catch {
      /* ignore */
    }
  }

  function resolveAbsoluteUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      return new URL(raw, window.location.origin).href;
    } catch {
      return raw;
    }
  }

  function stripUrlQuery(url) {
    return String(url || "")
      .trim()
      .split("?")[0]
      .split("#")[0];
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

  function formatTrackLabel(trackName) {
    return String(trackName || "")
      .trim()
      .toUpperCase();
  }

  function cleanDriverDisplayName(name, carNumber = "") {
    let cleaned = String(name || "").trim();
    const num = String(carNumber || "").trim();
    if (!cleaned) return cleaned;

    if (num) {
      if (cleaned.endsWith(` #${num}`)) cleaned = cleaned.slice(0, -(num.length + 2)).trim();
      if (cleaned.endsWith(`#${num}`)) cleaned = cleaned.slice(0, -(num.length + 1)).trim();
      if (cleaned.endsWith(num) && cleaned.length > num.length) {
        const prefix = cleaned.slice(0, -num.length);
        if (prefix && !/\d$/.test(prefix)) cleaned = prefix.trim();
      }
    }

    return cleaned;
  }

  function displayNameForEntry(entry) {
    return cleanDriverDisplayName(entry.driverName, entry.carNumber);
  }

  function normalizeSeasonLabel(seasonName) {
    return (String(seasonName || "Season 11").trim() || "Season 11").toUpperCase();
  }

  function slugifyName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
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
      driverId: String(entry.driverId || entry.driver_id || ""),
      driverName: cleanDriverDisplayName(
        entry.driverName || "Unknown Driver",
        entry.carNumber,
      ),
      carNumber: String(entry.carNumber || "").trim(),
      carImageUrl: entry.carImageUrl || "",
      photoUrl: entry.photoUrl || PLACEHOLDER,
      movementText: entry.movementText || movement.text,
      movementClass: entry.movementClass || movement.class,
      subtitle: entry.subtitle || "",
      writeup: entry.writeup || "",
    };
  }

  function validateWeek(week) {
    if (!week) throw new Error("No rankings loaded to export.");
    const raceNumber = Number(week.raceNumber);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      throw new Error("Valid race number is required before exporting.");
    }
    const entries = (week.entries || []).filter((e) => e.driverName || e.driverId);
    if (entries.length < 10) {
      throw new Error("All 10 rankings must have drivers before exporting.");
    }
    return raceNumber;
  }

  function isNonPointsRace(race) {
    const points = String(race?.points ?? "").trim().toLowerCase();
    const status = String(race?.status ?? "").trim().toLowerCase();
    if (points === "no" || status === "non-points") return true;
    return NON_POINTS_LABEL_PATTERN.test(String(race?.track ?? ""));
  }

  function buildPointsRaceTrackMap(races) {
    let n = 0;
    const map = {};
    for (const race of races || []) {
      if (isNonPointsRace(race)) continue;
      n += 1;
      map[n] = String(race.track || "").trim();
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

  async function ensureFontsReady() {
    if (!document.fonts?.ready) return { fontsUsed: [FONT_DISPLAY, FONT_BODY], fallbackRequired: true };
    await document.fonts.ready;
    const probes = [
      'italic 900 48px Impact, "Arial Narrow", sans-serif',
      '900 48px "Arial Narrow", Impact, sans-serif',
    ];
    await Promise.all(probes.map((spec) => document.fonts.load(spec).catch(() => null)));
    const impactOk = document.fonts.check('900 48px Impact');
    const narrowOk = document.fonts.check('900 48px "Arial Narrow"');
    return {
      fontsUsed: [FONT_DISPLAY, FONT_BODY],
      fallbackRequired: !impactOk && !narrowOk,
      impactLoaded: impactOk,
      narrowLoaded: narrowOk,
    };
  }

  /**
   * @returns {Promise<{ ok: boolean, img: HTMLImageElement|null, url: string, error?: string, usedFallback?: boolean }>}
   */
  async function loadImageAsset(url, meta = {}) {
    const abs = resolveAbsoluteUrl(url || PLACEHOLDER);
    if (imageAssetCache.has(abs)) return imageAssetCache.get(abs);

    const task = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        resolve({ ok: true, img, url: abs, usedFallback: false });
      };
      img.onerror = () => {
        const msg = `Failed to load ${meta.type || "image"} (${meta.driverName || "n/a"}): ${abs}`;
        console.warn("[pr-discord-export]", msg, meta.errorReason || "network/decode");
        if (meta.required) {
          resolve({ ok: false, img: null, url: abs, error: msg, usedFallback: false });
          return;
        }
        if (abs === resolveAbsoluteUrl(PLACEHOLDER)) {
          resolve({ ok: false, img: null, url: abs, error: msg, usedFallback: true });
          return;
        }
        loadImageAsset(PLACEHOLDER, { ...meta, type: `${meta.type || "image"}-fallback` }).then(
          (fallback) => {
            resolve({
              ok: fallback.ok,
              img: fallback.img,
              url: abs,
              error: msg,
              usedFallback: true,
            });
          },
        );
      };
      img.src = abs;
    });

    imageAssetCache.set(abs, task);
    return task;
  }

  function rgbToHex(r, g, b) {
    const p = (n) => Math.round(n).toString(16).padStart(2, "0");
    return `#${p(r)}${p(g)}${p(b)}`;
  }

  function parseHex(hex) {
    const clean = String(hex || "").replace("#", "");
    if (clean.length !== 6) return null;
    const n = Number.parseInt(clean, 16);
    if (!Number.isFinite(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function colorDistance(a, b) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  function relativeLuminance(r, g, b) {
    const ch = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return { h, s, v };
  }

  function isSkinTone(r, g, b) {
    const { h, s, v } = rgbToHsv(r, g, b);
    if (v < 0.18 || v > 0.95) return false;
    if (h <= 55 || h >= 340) {
      if (s >= 0.08 && s <= 0.62 && v >= 0.28 && v <= 0.9) {
        if (s < 0.38 && r > g && g >= b * 0.85) return true;
      }
    }
    if (r > 180 && g > 130 && b > 110 && r > g && g > b && r - b < 95 && s < 0.55) {
      return true;
    }
    return false;
  }

  function suitPixelWeight(u, v) {
    if (v < 0.32 || v > 0.96) return 0;
    let weight = 1;
    if (v >= 0.4 && v <= 0.82) weight = 3;
    if ((u <= 0.26 || u >= 0.74) && v >= 0.36 && v <= 0.78) weight = Math.max(weight, 2);
    if (v >= 0.32 && v < 0.4) weight = Math.min(weight, 1);
    return weight;
  }

  function isNeutralGrayNoise(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    const sat = max === 0 ? 0 : (max - min) / max;
    return sat < 0.12 && light > 0.1 && light < 0.88;
  }

  function isLightSuitFabric(r, g, b, a) {
    if (a < 120 || isSkinTone(r, g, b)) return false;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    const sat = max === 0 ? 0 : (max - min) / max;
    return light >= 0.7 && sat < 0.24;
  }

  function isDarkSuitFabric(r, g, b, a) {
    if (a < 120 || isSkinTone(r, g, b)) return false;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    const sat = max === 0 ? 0 : (max - min) / max;
    return light < 0.18 && sat < 0.35;
  }

  function isSaturatedSuitPixel(r, g, b, a) {
    if (a < 120 || isSkinTone(r, g, b)) return false;
    if (isLightSuitFabric(r, g, b, a) || isDarkSuitFabric(r, g, b, a)) return false;
    if (isNeutralGrayNoise(r, g, b)) return false;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    if (light < 0.07 || light > 0.94) return false;
    const { s } = rgbToHsv(r, g, b);
    return s >= 0.22;
  }

  function isIgnorableSuitPixel(r, g, b, a) {
    if (a < 120) return true;
    if (isSkinTone(r, g, b)) return true;
    if (isLightSuitFabric(r, g, b, a)) return false;
    if (isDarkSuitFabric(r, g, b, a)) return false;
    if (isSaturatedSuitPixel(r, g, b, a)) return false;
    if (isNeutralGrayNoise(r, g, b)) return true;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    if (light < 0.07 || light > 0.94) return true;
    return true;
  }

  function pickKeylineForFill(fillHex) {
    const rgb = parseHex(fillHex);
    if (!rgb) return "#000000";
    const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
    return lum > 0.45 ? "#000000" : "#ffffff";
  }

  function hashFallbackSuitColors(driverName) {
    let hash = 0;
    const name = String(driverName || "driver");
    for (let i = 0; i < name.length; i += 1) {
      hash = (hash * 33 + name.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    const hue2 = (hue + 140 + (hash % 80)) % 360;
    const fill = hslToHex(hue, 0.72, 0.48);
    const outline = hslToHex(hue2, 0.65, 0.22);
    return { fill, outline };
  }

  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rn = 0;
    let gn = 0;
    let bn = 0;
    if (h < 60) {
      rn = c;
      gn = x;
    } else if (h < 120) {
      rn = x;
      gn = c;
    } else if (h < 180) {
      gn = c;
      bn = x;
    } else if (h < 240) {
      gn = x;
      bn = c;
    } else if (h < 300) {
      rn = x;
      bn = c;
    } else {
      rn = c;
      bn = x;
    }
    return rgbToHex((rn + m) * 255, (gn + m) * 255, (bn + m) * 255);
  }

  function sampleSuitColorsFromPortrait(img) {
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const sampleW = 140;
    const sampleH = Math.max(80, Math.round(sampleW * (ih / iw)));
    const canvas = document.createElement("canvas");
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, sampleW, sampleH);

    let data;
    try {
      data = ctx.getImageData(0, 0, sampleW, sampleH).data;
    } catch (err) {
      return { error: "canvas_tainted_cors", detail: String(err?.message || err) };
    }

    const satBuckets = new Map();
    let lightWeight = 0;
    let darkWeight = 0;
    let totalWeighted = 0;

    for (let py = 0; py < sampleH; py += 1) {
      for (let px = 0; px < sampleW; px += 1) {
        const u = px / sampleW;
        const v = py / sampleH;
        const weight = suitPixelWeight(u, v);
        if (!weight) continue;

        const i = (py * sampleW + px) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 120 || isSkinTone(r, g, b)) continue;

        if (isLightSuitFabric(r, g, b, a)) {
          lightWeight += weight;
          totalWeighted += weight;
          continue;
        }
        if (isDarkSuitFabric(r, g, b, a)) {
          darkWeight += weight;
          totalWeighted += weight;
          continue;
        }
        if (!isSaturatedSuitPixel(r, g, b, a)) continue;

        totalWeighted += weight;
        const { s } = rgbToHsv(r, g, b);
        const satBoost = s >= 0.45 ? 2.2 : s >= 0.28 ? 1.6 : 1;
        const key = `${Math.round(r / 18) * 18},${Math.round(g / 18) * 18},${Math.round(b / 18) * 18}`;
        satBuckets.set(key, (satBuckets.get(key) || 0) + weight * satBoost);
      }
    }

    const sorted = [...satBuckets.entries()].sort((a, b) => b[1] - a[1]);
    const lightRatio = totalWeighted > 0 ? lightWeight / totalWeighted : 0;

    const toRgb = (key) => {
      const [r, g, b] = key.split(",").map(Number);
      return { r, g, b };
    };

    const pickSecondaryFromSorted = (primaryRgb, list) => {
      for (let i = 0; i < list.length; i += 1) {
        const candidate = toRgb(list[i][0]);
        if (colorDistance(primaryRgb, candidate) >= 45) return candidate;
      }
      if (darkWeight >= (list[0]?.[1] || 0) * 0.3) return { r: 0, g: 0, b: 0 };
      const lum = relativeLuminance(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      return lum > 0.4 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    };

    if (lightRatio >= 0.3 && sorted.length) {
      const accent = toRgb(sorted[0][0]);
      const fill = "#ffffff";
      let outline = rgbToHex(accent.r, accent.g, accent.b);
      if (darkWeight > lightWeight * 0.25) outline = "#000000";
      else if (sorted.length > 1) {
        const second = toRgb(sorted[1][0]);
        if (colorDistance(accent, second) >= 40) outline = rgbToHex(second.r, second.g, second.b);
      }
      return { fill, outline, keyline: pickKeylineForFill(fill), error: null, lightDominant: true };
    }

    if (!sorted.length) {
      if (lightRatio >= 0.45) {
        return {
          fill: "#ffffff",
          outline: darkWeight > 0 ? "#000000" : "#e50914",
          keyline: "#000000",
          error: null,
          lightDominant: true,
        };
      }
      return { error: "no_suit_colors_found" };
    }

    const primary = toRgb(sorted[0][0]);
    let secondary = pickSecondaryFromSorted(primary, sorted.slice(1));

    if (relativeLuminance(primary.r, primary.g, primary.b) < 0.12 && sorted.length > 1) {
      const accent = toRgb(sorted[1][0]);
      if (colorDistance(primary, accent) >= 40) {
        const fill = rgbToHex(accent.r, accent.g, accent.b);
        return {
          fill,
          outline: "#000000",
          keyline: pickKeylineForFill(fill),
          error: null,
        };
      }
    }

    const fill = rgbToHex(primary.r, primary.g, primary.b);
    const outline = rgbToHex(secondary.r, secondary.g, secondary.b);
    const keyline = pickKeylineForFill(fill);

    return { fill, outline, keyline, error: null };
  }

  /** legacy name */
  function sampleTruckColorsFromImage(img) {
    return sampleSuitColorsFromPortrait(img);
  }

  function cacheKeyForSuit(photoUrl, driverId) {
    const image = stripUrlQuery(photoUrl);
    if (image) return `suit:${image}`;
    if (driverId) return `suit:driver:${driverId}`;
    return "";
  }

  async function resolveSuitColorsForDriver(entry, photoResult) {
    const driverName = entry.driverName;
    const photoUrl = stripUrlQuery(entry.photoUrl);
    const key = cacheKeyForSuit(photoUrl, entry.driverId);
    const cached = key ? suitColorCache.get(key) : null;

    const logDiag = (diag) => {
      const line = `[pr-discord-export] suit colors — ${diag.driverName}: fill=${diag.primaryFill} outline=${diag.innerOutline} keyline=${diag.outerKeyline}${diag.fallback ? ` FALLBACK (${diag.reason})` : diag.cached ? " (cached)" : ""}`;
      if (diag.fallback) console.warn(line, diag);
      else console.log(line, diag);
      lastSuitColorReport.push(diag);
      return diag;
    };

    if (cached && !cached.fallback) {
      return logDiag({
        driverName,
        photoUrl: photoUrl || "(none)",
        primaryFill: cached.fill,
        innerOutline: cached.outline,
        outerKeyline: cached.keyline,
        cached: true,
        fallback: false,
        reason: null,
      });
    }

    if (!photoResult?.ok || !photoResult.img || photoResult.usedFallback) {
      const hashed = hashFallbackSuitColors(driverName);
      const fallback = {
        fill: hashed.fill,
        outline: hashed.outline,
        keyline: pickKeylineForFill(hashed.fill),
        fallback: true,
        fallbackReason: photoResult?.error || "driver_photo_unavailable",
      };
      if (key) {
        suitColorCache.set(key, fallback);
        persistTruckColorCache();
      }
      return logDiag({
        driverName,
        photoUrl: photoUrl || "(none)",
        primaryFill: fallback.fill,
        innerOutline: fallback.outline,
        outerKeyline: fallback.keyline,
        cached: false,
        fallback: true,
        reason: fallback.fallbackReason,
      });
    }

    const sampled = sampleSuitColorsFromPortrait(photoResult.img);
    if (sampled.error) {
      const hashed = hashFallbackSuitColors(driverName);
      const fallback = {
        fill: hashed.fill,
        outline: hashed.outline,
        keyline: pickKeylineForFill(hashed.fill),
        fallback: true,
        fallbackReason: sampled.error,
      };
      if (key) {
        suitColorCache.set(key, fallback);
        persistTruckColorCache();
      }
      return logDiag({
        driverName,
        photoUrl,
        primaryFill: fallback.fill,
        innerOutline: fallback.outline,
        outerKeyline: fallback.keyline,
        cached: false,
        fallback: true,
        reason: `${sampled.error}${sampled.detail ? `: ${sampled.detail}` : ""}`,
      });
    }

    const resolved = {
      fill: sampled.fill,
      outline: sampled.outline,
      keyline: sampled.keyline,
      fallback: false,
    };
    if (key) {
      suitColorCache.set(key, resolved);
      persistTruckColorCache();
    }
    return logDiag({
      driverName,
      photoUrl,
      primaryFill: resolved.fill,
      innerOutline: resolved.outline,
      outerKeyline: resolved.keyline,
      cached: false,
      fallback: false,
      reason: null,
    });
  }

  async function preloadExportAssets(week) {
    const entries = (week.entries || [])
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, 10)
      .map(normalizeEntry);
    const mentions = (week.honorableMentions || [])
      .filter((m) => m.driverName || m.driverId)
      .map(normalizeEntry);

    const bpLogo = await loadImageAsset(BP_LOGO, { type: "bp-logo", required: true });
    const prophetLogo = await loadImageAsset(PROPHET_LOGO, {
      type: "prophet-logo",
      required: true,
    });

    if (!bpLogo.ok || !bpLogo.img) {
      throw new Error("Blazing Pedals logo failed to load. Export aborted.");
    }
    if (!prophetLogo.ok || !prophetLogo.img) {
      throw new Error("Pedal Prophet logo failed to load. Export aborted.");
    }

    const driverAssets = new Map();
    const allPeople = [...entries, ...mentions];
    lastSuitColorReport = [];

    await Promise.all(
      allPeople.map(async (entry) => {
        const photo = await loadImageAsset(entry.photoUrl, {
          type: "driver-photo",
          driverName: entry.driverName,
        });

        const diag = await resolveSuitColorsForDriver(entry, photo);
        const colors = {
          fill: diag.primaryFill,
          outline: diag.innerOutline,
          keyline: diag.outerKeyline,
          diagnostic: diag,
        };
        driverAssets.set(entry.driverId || entry.driverName, {
          entry,
          photo,
          colors,
        });
      }),
    );

    return { bpLogo, prophetLogo, driverAssets, entries, mentions };
  }

  function computeLayout(mentionCount) {
    const padX = 18;
    const padTop = 10;
    const headerBottom = 128;
    const subbarH = 38;
    const gridTop = headerBottom + subbarH + 8;
    const footerH = 32;
    const padBottom = 10;
    const honorableH = mentionCount > 0 ? 156 : 0;
    const gridBottom = EXPORT_HEIGHT - padBottom - footerH - honorableH;
    const gridH = gridBottom - gridTop;
    const rowGap = 10;
    const rowH = (gridH - rowGap) / 2;
    const colGap = 10;
    const innerW = EXPORT_WIDTH - padX * 2;
    const cardW = (innerW - colGap * 4) / 5;

    return {
      padX,
      padTop,
      headerBottom,
      subbarH,
      gridTop,
      gridBottom,
      gridH,
      rowH,
      rowGap,
      colGap,
      cardW,
      honorableY: gridBottom + 6,
      honorableH,
      footerY: EXPORT_HEIGHT - padBottom - footerH + 6,
      mentionCount,
    };
  }

  function drawCarbonBackground(ctx) {
    ctx.fillStyle = "#060606";
    ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.22;
    for (let y = -EXPORT_HEIGHT; y < EXPORT_HEIGHT * 2; y += 12) {
      ctx.strokeStyle = y % 24 === 0 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.025)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(EXPORT_WIDTH, y + EXPORT_WIDTH * 0.55);
      ctx.stroke();
    }
    ctx.restore();

    const grad = ctx.createLinearGradient(0, 0, 0, EXPORT_HEIGHT);
    grad.addColorStop(0, "rgba(30,30,30,0.55)");
    grad.addColorStop(0.45, "rgba(8,8,8,0.15)");
    grad.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#8b0000";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 96);
    ctx.lineTo(EXPORT_WIDTH, 140);
    ctx.stroke();
    ctx.restore();
  }

  function drawProphetWatermark(ctx, prophetImg, layout) {
    const cx = EXPORT_WIDTH / 2;
    const cy = WATERMARK_CENTER_Y;
    const x = cx - WATERMARK_SIZE / 2;
    const y = cy - WATERMARK_SIZE / 2;

    ctx.save();
    ctx.globalAlpha = WATERMARK_OPACITY;
    ctx.filter = "grayscale(100%) brightness(0.72) contrast(0.95)";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(prophetImg, x, y, WATERMARK_SIZE, WATERMARK_SIZE);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawImageContain(ctx, img, x, y, w, h, opts = {}) {
    const { hAlign = "center", vAlign = "bottom", scaleMult = 1 } = opts;
    const iw = img.naturalWidth || 1;
    const ih = img.naturalHeight || 1;
    const scale = Math.min(w / iw, h / ih) * scaleMult;
    const dw = iw * scale;
    const dh = ih * scale;
    let dx = x + (w - dw) / 2;
    if (hAlign === "left") dx = x;
    if (hAlign === "right") dx = x + w - dw;
    let dy = y + h - dh;
    if (vAlign === "center") dy = y + (h - dh) / 2;
    if (vAlign === "top") dy = y;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, dx, dy, dw, dh);
    return { dx, dy, dw, dh };
  }

  function wrapText(ctx, text, maxWidth) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = words[0];
    for (let i = 1; i < words.length; i += 1) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        lines.push(line);
        line = words[i];
      }
    }
    lines.push(line);
    return lines.slice(0, 2);
  }

  function drawFittedCenteredText(
    ctx,
    text,
    centerX,
    y,
    maxWidth,
    fontWeightStyle,
    startingFontSize,
    minimumFontSize,
    fill,
  ) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = fill;
    let size = startingFontSize;
    let font = `${fontWeightStyle} ${size}px ${FONT_BODY}`;
    while (size > minimumFontSize) {
      ctx.font = font;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 1;
      font = `${fontWeightStyle} ${size}px ${FONT_BODY}`;
    }
    ctx.font = font;
    ctx.fillText(text, Math.round(centerX) + 0.5, Math.round(y) + 0.5);
    ctx.restore();
    return size;
  }

  function drawCenteredSubtitleLines(ctx, text, centerX, startY, maxWidth, fill) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `700 italic 13px ${FONT_BODY}`;
    ctx.fillStyle = fill;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const lines = wrapText(ctx, text, maxWidth);
    lines.forEach((line, i) => {
      ctx.fillText(line, Math.round(centerX) + 0.5, Math.round(startY + i * 15) + 0.5);
    });
    ctx.restore();
  }

  function drawRankNumber(ctx, rank, x, y, tier) {
    const fontSpec = `900 italic 52px ${FONT_DISPLAY}`;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = fontSpec;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const px = Math.round(x) + 0.5;
    const py = Math.round(y) + 0.5;

    if (Number(rank) === 2) {
      const grad = ctx.createLinearGradient(px, py - 50, px, py + 2);
      grad.addColorStop(0, "#F2F2F2");
      grad.addColorStop(0.45, "#BFC3C8");
      grad.addColorStop(1, "#8F949A");
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = tier.rankColor;
    }
    ctx.fillText(String(rank), px, py);
    ctx.restore();
  }

  function drawTextItalic(ctx, text, x, y, font, fill, align = "left") {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    const px = align === "center" ? x : Math.round(x) + 0.5;
    const py = Math.round(y) + 0.5;
    ctx.fillText(text, px, py);
    ctx.restore();
  }

  function drawLayeredNumber(ctx, text, x, y, style) {
    const {
      fill,
      outline,
      keyline = "#000000",
      font,
      skew = -0.14,
      shadow = true,
    } = style;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(Math.round(x), Math.round(y));
    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
    }

    ctx.strokeStyle = keyline;
    ctx.lineWidth = 9;
    ctx.strokeText(text, 0, 0);

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 5;
    ctx.strokeText(text, 0, 0);

    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function cardTierStyle(rank, movementClass) {
    if (rank === 1) {
      return {
        border: "#ffd23f",
        glow: "rgba(255,210,63,0.35)",
        rankColor: "#ffd23f",
        subtitleColor: "#ffd23f",
      };
    }
    if (rank === 2) {
      return {
        border: "#d8d8d8",
        glow: "rgba(200,200,200,0.25)",
        rankColor: "#f0f0f0",
        subtitleColor: "#c8c8c8",
      };
    }
    if (rank === 3) {
      return {
        border: "#cd7f32",
        glow: "rgba(205,127,50,0.3)",
        rankColor: "#e8a55a",
        subtitleColor: "#cd7f32",
      };
    }
    if (movementClass === "positive") {
      return {
        border: "#2ecc71",
        glow: "rgba(46,204,113,0.18)",
        rankColor: "#ffffff",
        subtitleColor: "#45d65a",
      };
    }
    if (movementClass === "negative") {
      return {
        border: "#ff3030",
        glow: "rgba(255,48,48,0.2)",
        rankColor: "#ffffff",
        subtitleColor: "#ff5050",
      };
    }
    if (movementClass === "new") {
      return {
        border: "#ffd23f",
        glow: "rgba(255,210,63,0.22)",
        rankColor: "#ffffff",
        subtitleColor: "#ffd23f",
      };
    }
    return {
      border: "rgba(255,255,255,0.18)",
      glow: "rgba(255,255,255,0.05)",
      rankColor: "#ffffff",
      subtitleColor: "#cccccc",
    };
  }

  function drawHeader(ctx, week, assets, layout, trackName) {
    const { bpLogo, prophetLogo } = assets;
    drawImageContain(ctx, bpLogo.img, layout.padX, layout.padTop, 290, 68, {
      hAlign: "left",
      vAlign: "top",
    });

    drawTextItalic(
      ctx,
      normalizeSeasonLabel(week.seasonName),
      layout.padX + 4,
      92,
      `900 italic 26px ${FONT_DISPLAY}`,
      "#e50914",
      "left",
    );

    drawTextItalic(
      ctx,
      "POWER RANKINGS",
      EXPORT_WIDTH / 2,
      78,
      `900 italic 78px ${FONT_DISPLAY}`,
      "#ffffff",
      "center",
    );

    drawImageContain(ctx, prophetLogo.img, EXPORT_WIDTH - layout.padX - 120, 8, 120, 120, {
      hAlign: "right",
      vAlign: "top",
    });

    drawTextItalic(
      ctx,
      "POWER RANKINGS & RACE ANALYSIS",
      EXPORT_WIDTH - layout.padX - 4,
      118,
      `900 italic 11px ${FONT_BODY}`,
      "#e50914",
      "right",
    );

    const barY = layout.headerBottom - 6;
    ctx.fillStyle = "#3a0000";
    ctx.fillRect(layout.padX, barY, EXPORT_WIDTH - layout.padX * 2, layout.subbarH);
    ctx.fillStyle = "#6e0000";
    ctx.fillRect(layout.padX, barY, (EXPORT_WIDTH - layout.padX * 2) / 2, layout.subbarH);

    ctx.strokeStyle = "#b80000";
    ctx.lineWidth = 2;
    ctx.strokeRect(layout.padX + 0.5, barY + 0.5, EXPORT_WIDTH - layout.padX * 2 - 1, layout.subbarH - 1);

    const raceLabel = `RACE ${Number(week.raceNumber)} RANKINGS`;
    const published = formatPublishedUpper(week.publishedDate);
    const trackLabel = formatTrackLabel(trackName);

    drawTextItalic(
      ctx,
      raceLabel,
      layout.padX + 16,
      barY + 26,
      `900 italic 18px ${FONT_BODY}`,
      "#ffffff",
      "left",
    );
    if (trackLabel) {
      drawTextItalic(
        ctx,
        trackLabel,
        EXPORT_WIDTH / 2,
        barY + 26,
        `900 italic 17px ${FONT_BODY}`,
        "#f0f0f0",
        "center",
      );
    }
    drawTextItalic(
      ctx,
      published,
      EXPORT_WIDTH - layout.padX - 16,
      barY + 26,
      `900 italic 16px ${FONT_BODY}`,
      "#f2f2f2",
      "right",
    );
  }

  function drawRankingCard(ctx, entry, bounds, driverAsset) {
    const { x, y, w, h } = bounds;
    const tier = cardTierStyle(entry.rank, entry.movementClass);
    const colors = driverAsset.colors;
    const centerX = x + w / 2;
    const maxTextWidth = w - 24;
    const bottomPad = CARD_BOTTOM_TEXT_PAD;
    const nameBaselineY = y + h - bottomPad - 30;
    const subtitleStartY = y + h - bottomPad - 12;
    const textZoneTop = nameBaselineY - 86;
    const carNumBaseline = textZoneTop - 6;

    ctx.save();
    const panelGrad = ctx.createLinearGradient(x, y, x, y + h);
    panelGrad.addColorStop(0, "rgba(28,28,28,0.74)");
    panelGrad.addColorStop(1, "rgba(5,5,5,0.70)");
    ctx.fillStyle = panelGrad;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = tier.border;
    ctx.lineWidth = entry.rank === 1 ? 3 : 2;
    if (tier.glow) {
      ctx.shadowColor = tier.glow;
      ctx.shadowBlur = entry.rank <= 3 || entry.movementClass === "new" ? 14 : 6;
    }
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.shadowBlur = 0;
    ctx.restore();

    drawRankNumber(ctx, entry.rank, x + 12, y + 52, tier);

    let moveColor = "#888888";
    if (entry.movementClass === "positive") moveColor = "#45d65a";
    if (entry.movementClass === "negative") moveColor = "#ff2323";
    if (entry.movementClass === "new") moveColor = "#ffd23f";

    drawTextItalic(
      ctx,
      entry.movementText,
      x + w - 12,
      y + 36,
      `900 italic 20px ${FONT_BODY}`,
      moveColor,
      "right",
    );

    const photoBox = {
      x: x + 6,
      y: y + 42,
      w: w - 10,
      h: Math.max(48, textZoneTop - (y + 42) - 4),
    };
    const photoImg = driverAsset.photo?.img;
    if (photoImg) {
      drawImageContain(ctx, photoImg, photoBox.x, photoBox.y, photoBox.w, photoBox.h, {
        hAlign: "right",
        vAlign: "bottom",
        scaleMult: PORTRAIT_SCALE,
      });
    }

    const numText = entry.carNumber || "—";
    drawLayeredNumber(ctx, numText, x + 14, carNumBaseline, {
      fill: colors.fill,
      outline: colors.outline,
      keyline: colors.keyline || "#000000",
      font: `900 italic 86px ${FONT_DISPLAY}`,
    });

    const nameText = displayNameForEntry(entry).toUpperCase();
    drawFittedCenteredText(
      ctx,
      nameText,
      centerX,
      nameBaselineY,
      maxTextWidth,
      "900 italic",
      19,
      13,
      "#ffffff",
    );

    drawCenteredSubtitleLines(
      ctx,
      entry.subtitle,
      centerX,
      subtitleStartY,
      maxTextWidth,
      tier.subtitleColor,
    );
  }

  function drawHonorableMention(ctx, entry, bounds, driverAsset) {
    const { x, y, w, h } = bounds;
    const colors = driverAsset.colors;

    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    drawLayeredNumber(ctx, entry.carNumber || "—", x + 18, y + h - 28, {
      fill: colors.fill,
      outline: colors.outline,
      keyline: colors.keyline || "#000000",
      font: `900 italic 64px ${FONT_DISPLAY}`,
      shadow: true,
    });

    const photoImg = driverAsset.photo?.img;
    if (photoImg) {
      drawImageContain(ctx, photoImg, x + 88, y + 6, 132, h - 12, {
        hAlign: "center",
        vAlign: "bottom",
        scaleMult: HONORABLE_PORTRAIT_SCALE,
      });
    }

    drawTextItalic(
      ctx,
      displayNameForEntry(entry).toUpperCase(),
      x + 232,
      y + h / 2 + 10,
      `900 italic 26px ${FONT_BODY}`,
      "#ffffff",
      "left",
    );
  }

  function drawHonorableSection(ctx, week, assets, layout) {
    const mentions = assets.mentions;
    if (!mentions.length) return;

    const barX = layout.padX;
    const barW = EXPORT_WIDTH - layout.padX * 2;
    const barY = layout.honorableY;

    ctx.fillStyle = "#8b0000";
    ctx.fillRect(barX, barY, barW, 34);
    ctx.strokeStyle = "#ff3030";
    ctx.lineWidth = 2;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 33);

    drawTextItalic(
      ctx,
      "HONORABLE MENTIONS",
      EXPORT_WIDTH / 2,
      barY + 24,
      `900 italic 20px ${FONT_DISPLAY}`,
      "#ffffff",
      "center",
    );

    const panelY = barY + 40;
    const panelH = layout.honorableH - 44;
    const gap = 12;
    const panelW = (barW - gap * (mentions.length - 1)) / mentions.length;

    mentions.forEach((entry, index) => {
      const x = barX + index * (panelW + gap);
      const asset = assets.driverAssets.get(entry.driverId || entry.driverName);
      if (!asset) return;
      drawHonorableMention(ctx, entry, { x, y: panelY, w: panelW, h: panelH }, asset);
    });
  }

  function drawFooter(ctx, layout) {
    ctx.strokeStyle = "#b80000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(layout.padX, layout.footerY - 10);
    ctx.lineTo(EXPORT_WIDTH - layout.padX, layout.footerY - 10);
    ctx.stroke();

    drawTextItalic(
      ctx,
      "FAST DRIVERS. CLOSE RACING. BIG FUN.",
      EXPORT_WIDTH / 2,
      layout.footerY + 14,
      `900 14px ${FONT_BODY}`,
      "#ffffff",
      "center",
    );
  }

  async function renderPowerRankingsDiscordCanvas(week, options = {}) {
    validateWeek(week);
    const fontInfo = await ensureFontsReady();
    const assets = await preloadExportAssets(week);
    const layout = computeLayout(assets.mentions.length);
    const trackName = await resolveTrackName(Number(week.raceNumber), week);

    const canvas = document.createElement("canvas");
    canvas.width = EXPORT_WIDTH;
    canvas.height = EXPORT_HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    drawCarbonBackground(ctx);
    drawProphetWatermark(ctx, assets.prophetLogo.img, layout);
    drawHeader(ctx, week, assets, layout, trackName);

    assets.entries.forEach((entry, index) => {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const x = layout.padX + col * (layout.cardW + layout.colGap);
      const y = layout.gridTop + row * (layout.rowH + layout.rowGap);
      const driverAsset = assets.driverAssets.get(entry.driverId || entry.driverName);
      drawRankingCard(
        ctx,
        entry,
        { x, y, w: layout.cardW, h: layout.rowH },
        driverAsset,
      );
    });

    drawHonorableSection(ctx, week, assets, layout);
    drawFooter(ctx, layout);

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

    lastRenderDiagnostics = {
      canvasInternalResolution: `${EXPORT_WIDTH}×${EXPORT_HEIGHT}`,
      outputResolution: `${EXPORT_WIDTH}×${EXPORT_HEIGHT}`,
      fontsUsed: fontInfo.fontsUsed,
      fontFallbackRequired: fontInfo.fallbackRequired,
      impactLoaded: fontInfo.impactLoaded,
      narrowLoaded: fontInfo.narrowLoaded,
      prophetWatermark: {
        opacity: WATERMARK_OPACITY,
        sizePx: WATERMARK_SIZE,
        centerX: EXPORT_WIDTH / 2,
        centerY: WATERMARK_CENTER_Y,
        filter: "grayscale(100%) brightness(0.72)",
      },
      cardPanelAlpha: CARD_PANEL_ALPHA,
      cardPanelGradient: "rgba(28,28,28,0.74) → rgba(5,5,5,0.70)",
      portraitScale: PORTRAIT_SCALE,
      honorablePortraitScale: HONORABLE_PORTRAIT_SCALE,
      cardBottomTextPad: CARD_BOTTOM_TEXT_PAD,
      trackName: trackName || null,
      suitColors: lastSuitColorReport,
    };
    console.log("[pr-discord-export] render complete", lastRenderDiagnostics);
    if (lastSuitColorReport.length) {
      console.table(
        lastSuitColorReport.map((row) => ({
          driver: row.driverName,
          fill: row.primaryFill,
          outline: row.innerOutline,
          keyline: row.outerKeyline,
          fallback: row.fallback ? row.reason : "",
        })),
      );
    }

    return {
      canvas,
      blob,
      raceNumber: Number(week.raceNumber),
      width: EXPORT_WIDTH,
      height: EXPORT_HEIGHT,
      diagnostics: lastRenderDiagnostics,
      ...options,
    };
  }

  function downloadCanvasPng(canvasOrBlob, filename) {
    if (canvasOrBlob instanceof Blob) {
      downloadBlob(canvasOrBlob, filename);
      return;
    }
    canvasOrBlob.toBlob((blob) => {
      if (blob) downloadBlob(blob, filename);
    }, "image/png", 1);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function renderWeekToPng(week, options = {}) {
    return renderPowerRankingsDiscordCanvas(week, options);
  }

  async function downloadWeekPng(week) {
    const result = await renderPowerRankingsDiscordCanvas(week);
    downloadBlob(
      result.blob,
      `blazing-pedals-power-rankings-race-${result.raceNumber}.png`,
    );
    return result;
  }

  async function previewWeekPng(week) {
    const result = await renderPowerRankingsDiscordCanvas(week);
    const objectUrl = URL.createObjectURL(result.blob);
    return { ...result, objectUrl };
  }

  async function exportWeek(week) {
    return downloadWeekPng(week);
  }

  function buildWeekFromAdminForm(formData, driverOptions = [], profileById = {}) {
    const byDriverId = Object.fromEntries(
      (driverOptions || []).map((d) => [String(d.driver_id), d]),
    );

    const mapDriverEntry = (entry, rank) => {
      const driver =
        byDriverId[String(entry.driverId)] || profileById[String(entry.driverId)] || {};
      const profile = profileById[String(entry.driverId)] || driver;
      const name = cleanDriverDisplayName(
        driver.display_name ||
          driver.displayName ||
          profile?.display_name ||
          profile?.iracing_name ||
          "Unknown Driver",
        driver.car_number || profile?.car_number || "",
      );
      const movementParsed = parseMovementInput(entry.movement);
      const movement = movementParsed
        ? formatMovementDisplay(movementParsed.movement, movementParsed.movementType)
        : formatMovementDisplay(0, "unchanged");

      const carImageUrl =
        driverCarImageUrl(profile) ||
        driverCarImageUrl(driver) ||
        stripUrlQuery(driver.car_image_url || driver.carImageUrl || "");

      return {
        rank,
        driverId: String(entry.driverId || ""),
        driverName: name,
        carNumber: driver.car_number || profile?.car_number || "",
        carImageUrl,
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
    const raceLine = trackName ? `Race ${raceNumber} • ${trackName}` : `Race ${raceNumber}`;
    const published = formatPublishedDate(week.publishedDate);
    const entries = (week.entries || [])
      .slice()
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .slice(0, 10);

    const lines = ["**POWER RANKINGS**", raceLine, "Presented by The Pedal Prophet"];
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
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `bp-power-rankings-race-${raceNumber}.txt`);
    return text;
  }

  window.BPPowerRankingsDiscordExport = {
    EXPORT_WIDTH,
    EXPORT_HEIGHT,
    PLACEHOLDER,
    buildWeekFromAdminForm,
    renderPowerRankingsDiscordCanvas,
    renderWeekToPng,
    exportWeek,
    downloadWeekPng,
    previewWeekPng,
    downloadCanvasPng,
    resolveTrackName,
    buildPointsRaceTrackMap,
    buildDiscordText,
    copyDiscordText,
    downloadDiscordText,
    loadImageAsset,
    getLastRenderDiagnostics: () => lastRenderDiagnostics,
    getLastSuitColorReport: () => lastSuitColorReport,
  };
})();
