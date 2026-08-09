(function () {
  const EXPORT_WIDTH = 1920;
  const EXPORT_HEIGHT = 1080;
  const PLACEHOLDER = "/assets/drivers/placeholder.png";
  const MOVEMENT_NEW_SENTINEL = 100;
  const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;
  const BP_LOGO = "/assets/logos/New%20Clean%20Logo.png";
  const PROPHET_LOGO = "/assets/logos/pedal-prophet-logo.png";
  const TRUCK_COLOR_CACHE_KEY = "bp_pr_suit_colors_v4";
  const WATERMARK_OPACITY = 0.35;
  const WATERMARK_SIZE = 1080;
  const WATERMARK_CENTER_Y = 520;
  const CARD_PANEL_ALPHA = 0.72;
  const PORTRAIT_SCALE = 1.1;
  const HONORABLE_PORTRAIT_SCALE = 1.62;
  const CARD_BOTTOM_TEXT_PAD = 9;
  const RENDER_SCALE = 2;
  const MIN_NUMBER_CONTRAST = 2.5;

  // Large display type (title / rank / car numbers) — supersampled.
  const FONT_DISPLAY = 'Impact, Haettenschweiler, "Arial Black", Arial, sans-serif';
  // Small/medium lettering — native final-canvas pass only. No Impact.
  const FONT_SMALL = '"Arial Narrow", Arial, sans-serif';

  if (typeof window !== "undefined" && window.PR_DISCORD_TEXT_DEBUG === undefined) {
    window.PR_DISCORD_TEXT_DEBUG = false;
  }

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
    if (!document.fonts?.ready) {
      return {
        fontsUsed: [FONT_DISPLAY, FONT_SMALL],
        fontWeightsUsed: ["bold", "700"],
        fallbackRequired: true,
        warnings: ["document.fonts API unavailable"],
      };
    }

    await document.fonts.ready;

    const requiredChecks = [
      { name: "Impact", spec: "bold 48px Impact" },
      { name: "Arial Narrow", spec: 'bold 18px "Arial Narrow"' },
      { name: "Arial", spec: "bold 18px Arial" },
    ];

    await Promise.all(
      requiredChecks.map((item) => document.fonts.load(item.spec).catch(() => null)),
    );

    const availability = {};
    const warnings = [];
    requiredChecks.forEach((item) => {
      const ok = document.fonts.check(item.spec);
      availability[item.name] = ok;
      if (!ok) {
        warnings.push(`Font unavailable or not loaded: ${item.name} (${item.spec})`);
        console.warn(`[pr-discord-export] ${warnings[warnings.length - 1]}`);
      }
    });

    return {
      fontsUsed: [FONT_DISPLAY, FONT_SMALL],
      fontWeightsUsed: ["bold", "700"],
      fallbackRequired: !availability.Impact && !availability["Arial Narrow"] && !availability.Arial,
      impactLoaded: availability.Impact,
      narrowLoaded: availability["Arial Narrow"],
      arialLoaded: availability.Arial,
      warnings,
      renderScale: RENDER_SCALE,
      smallTextStage: "final-native",
    };
  }

  function resetTextRenderingState(ctx) {
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.shadowBlur = 0;
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 1;
  }

  function logTextDebug(category, info) {
    if (typeof window === "undefined" || !window.PR_DISCORD_TEXT_DEBUG) return;
    console.log(`[pr-discord-text] ${category}`, info);
  }

  /** Fill-only, no shadow, no stroke — used for native final-canvas small/medium text. */
  function drawNativeFillText(ctx, {
    text,
    x,
    y,
    font,
    fill,
    align = "left",
    category = "text",
    stage = "master-hires",
  }) {
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    const tx = Math.round(x);
    const ty = Math.round(y);
    logTextDebug(category, {
      font,
      fill,
      shadowBlur: 0,
      shadowColor: "rgba(0,0,0,0)",
      globalAlpha: 1,
      strokeText: false,
      renderStage: stage,
      x: tx,
      y: ty,
      text: String(text || ""),
    });
    ctx.fillText(String(text || ""), tx, ty);
    ctx.restore();
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

  function contrastRatioRgb(a, b) {
    if (!a || !b) return 1;
    const L1 = relativeLuminance(a.r, a.g, a.b);
    const L2 = relativeLuminance(b.r, b.g, b.b);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function contrastRatioHex(hexA, hexB) {
    return contrastRatioRgb(parseHex(hexA), parseHex(hexB));
  }

  function isDarkRgb(rgb) {
    if (!rgb) return true;
    return relativeLuminance(rgb.r, rgb.g, rgb.b) <= 0.45;
  }

  function pickKeylineForSecondary(secondaryHex) {
    const rgb = parseHex(secondaryHex);
    if (!rgb) return "#000000";
    return isDarkRgb(rgb) ? "#ffffff" : "#000000";
  }

  function enforceNumberLayerContrast(fillHex, outlineHex) {
    let fill = fillHex;
    let outline = outlineHex;
    let contrastFallback = false;
    let reason = null;

    let fillRgb = parseHex(fill);
    let outlineRgb = parseHex(outline);
    let ratio = contrastRatioRgb(fillRgb, outlineRgb);

    if (ratio < MIN_NUMBER_CONTRAST) {
      const white = { r: 255, g: 255, b: 255 };
      const black = { r: 0, g: 0, b: 0 };
      const whiteRatio = contrastRatioRgb(fillRgb, white);
      const blackRatio = contrastRatioRgb(fillRgb, black);
      if (whiteRatio >= blackRatio && whiteRatio >= MIN_NUMBER_CONTRAST) {
        outline = "#ffffff";
        contrastFallback = true;
        reason = `outline_contrast_boost_white (${ratio.toFixed(2)}→${whiteRatio.toFixed(2)})`;
      } else if (blackRatio >= MIN_NUMBER_CONTRAST) {
        outline = "#000000";
        contrastFallback = true;
        reason = `outline_contrast_boost_black (${ratio.toFixed(2)}→${blackRatio.toFixed(2)})`;
      } else if (whiteRatio >= blackRatio) {
        outline = "#ffffff";
        contrastFallback = true;
        reason = `outline_contrast_best_effort_white (${whiteRatio.toFixed(2)})`;
      } else {
        outline = "#000000";
        contrastFallback = true;
        reason = `outline_contrast_best_effort_black (${blackRatio.toFixed(2)})`;
      }
      outlineRgb = parseHex(outline);
      ratio = contrastRatioRgb(fillRgb, outlineRgb);
    }

    let keyline = pickKeylineForSecondary(outline);
    let keylineRgb = parseHex(keyline);
    let keylineRatio = contrastRatioRgb(outlineRgb, keylineRgb);
    if (keylineRatio < 1.8) {
      keyline = isDarkRgb(outlineRgb) ? "#ffffff" : "#000000";
      keylineRgb = parseHex(keyline);
      keylineRatio = contrastRatioRgb(outlineRgb, keylineRgb);
    }

    // Avoid muddy triple stacks: dark/dark/black or light/light/white
    if (
      (isDarkRgb(fillRgb) && isDarkRgb(outlineRgb) && keyline === "#000000") ||
      (!isDarkRgb(fillRgb) && !isDarkRgb(outlineRgb) && keyline === "#ffffff")
    ) {
      keyline = isDarkRgb(outlineRgb) ? "#ffffff" : "#000000";
      contrastFallback = true;
      reason = reason || "keyline_stack_correction";
    }

    return {
      fill,
      outline,
      keyline,
      fillOutlineContrast: contrastRatioHex(fill, outline),
      outlineKeylineContrast: contrastRatioHex(outline, keyline),
      contrastFallback,
      reason,
    };
  }

  /** @deprecated use pickKeylineForSecondary — kept for compatibility */
  function pickKeylineForFill(fillHex) {
    return pickKeylineForSecondary(fillHex);
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
    const maxFreq = sorted[0]?.[1] || 1;

    const toRgb = (key) => {
      const [r, g, b] = key.split(",").map(Number);
      return { r, g, b };
    };

    const pickSecondaryByContrast = (primaryRgb, list) => {
      const candidates = [];

      list.forEach(([key, freq]) => {
        const candidate = toRgb(key);
        const contrast = contrastRatioRgb(primaryRgb, candidate);
        const freqScore = freq / maxFreq;
        // Prefer strong contrast over near-duplicate dominant colors.
        const score = freqScore * 0.35 + Math.min(contrast / 6, 1) * 0.65;
        candidates.push({ rgb: candidate, contrast, score, source: "suit" });
      });

      if (lightWeight > 0) {
        const white = { r: 255, g: 255, b: 255 };
        candidates.push({
          rgb: white,
          contrast: contrastRatioRgb(primaryRgb, white),
          score: 0.25 + Math.min(contrastRatioRgb(primaryRgb, white) / 6, 1) * 0.75,
          source: "white",
        });
      }
      if (darkWeight > 0) {
        const black = { r: 0, g: 0, b: 0 };
        candidates.push({
          rgb: black,
          contrast: contrastRatioRgb(primaryRgb, black),
          score: 0.25 + Math.min(contrastRatioRgb(primaryRgb, black) / 6, 1) * 0.75,
          source: "black",
        });
      }

      // Always allow white/black as valid trim even if fabric sampling was sparse.
      const white = { r: 255, g: 255, b: 255 };
      const black = { r: 0, g: 0, b: 0 };
      if (!candidates.some((c) => c.source === "white")) {
        candidates.push({
          rgb: white,
          contrast: contrastRatioRgb(primaryRgb, white),
          score: Math.min(contrastRatioRgb(primaryRgb, white) / 6, 1),
          source: "white-fallback",
        });
      }
      if (!candidates.some((c) => c.source === "black")) {
        candidates.push({
          rgb: black,
          contrast: contrastRatioRgb(primaryRgb, black),
          score: Math.min(contrastRatioRgb(primaryRgb, black) / 6, 1),
          source: "black-fallback",
        });
      }

      candidates.sort((a, b) => {
        const aPass = a.contrast >= MIN_NUMBER_CONTRAST ? 1 : 0;
        const bPass = b.contrast >= MIN_NUMBER_CONTRAST ? 1 : 0;
        if (aPass !== bPass) return bPass - aPass;
        return b.score - a.score;
      });

      return candidates[0] || {
        rgb: isDarkRgb(primaryRgb) ? white : black,
        contrast: 1,
        score: 0,
        source: "default",
      };
    };

    const finalizePair = (fillHex, outlineHex, extra = {}) => {
      const enforced = enforceNumberLayerContrast(fillHex, outlineHex);
      return {
        fill: enforced.fill,
        outline: enforced.outline,
        keyline: enforced.keyline,
        fillOutlineContrast: enforced.fillOutlineContrast,
        outlineKeylineContrast: enforced.outlineKeylineContrast,
        contrastFallback: enforced.contrastFallback,
        contrastReason: enforced.reason,
        error: null,
        ...extra,
      };
    };

    if (lightRatio >= 0.3 && sorted.length) {
      const accent = toRgb(sorted[0][0]);
      const fill = "#ffffff";
      const secondaryPick = pickSecondaryByContrast(
        { r: 255, g: 255, b: 255 },
        sorted.map(([key, freq]) => [key, freq]),
      );
      let outline = rgbToHex(secondaryPick.rgb.r, secondaryPick.rgb.g, secondaryPick.rgb.b);
      if (darkWeight > lightWeight * 0.25 && contrastRatioHex(fill, "#000000") >= MIN_NUMBER_CONTRAST) {
        outline = "#000000";
      } else if (sorted.length) {
        // Prefer saturated accent over near-white trim on white suits.
        const accentHex = rgbToHex(accent.r, accent.g, accent.b);
        if (contrastRatioHex(fill, accentHex) >= MIN_NUMBER_CONTRAST) outline = accentHex;
      }
      return finalizePair(fill, outline, { lightDominant: true });
    }

    if (!sorted.length) {
      if (lightRatio >= 0.45) {
        return finalizePair("#ffffff", darkWeight > 0 ? "#000000" : "#e50914", {
          lightDominant: true,
        });
      }
      return { error: "no_suit_colors_found" };
    }

    let primary = toRgb(sorted[0][0]);

    // Very dark primary: promote a brighter suit accent to fill when available.
    if (relativeLuminance(primary.r, primary.g, primary.b) < 0.12 && sorted.length > 1) {
      const accentPick = pickSecondaryByContrast(primary, sorted.slice(1));
      if (accentPick.contrast >= 1.8 && !isDarkRgb(accentPick.rgb)) {
        primary = accentPick.rgb;
      }
    }

    const secondaryPick = pickSecondaryByContrast(primary, sorted.slice(1));
    const fill = rgbToHex(primary.r, primary.g, primary.b);
    const outline = rgbToHex(secondaryPick.rgb.r, secondaryPick.rgb.g, secondaryPick.rgb.b);
    return finalizePair(fill, outline, {
      secondarySource: secondaryPick.source,
      secondaryScore: secondaryPick.score,
    });
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
      const contrastNote =
        diag.fillOutlineContrast != null
          ? ` contrast=${Number(diag.fillOutlineContrast).toFixed(2)}`
          : "";
      const line = `[pr-discord-export] suit colors — ${diag.driverName}: fill=${diag.primaryFill} outline=${diag.innerOutline} keyline=${diag.outerKeyline}${contrastNote}${diag.fallback ? ` FALLBACK (${diag.reason})` : diag.cached ? " (cached)" : ""}${diag.contrastFallback ? ` CONTRAST_FIX (${diag.contrastReason})` : ""}`;
      if (diag.fallback || diag.contrastFallback) console.warn(line, diag);
      else console.log(line, diag);
      lastSuitColorReport.push(diag);
      return diag;
    };

    const packageColors = (fill, outline, keyline, meta = {}) => {
      const enforced = enforceNumberLayerContrast(fill, outline || keyline);
      return {
        ...meta,
        fill: enforced.fill,
        outline: enforced.outline,
        keyline: enforced.keyline || keyline || pickKeylineForSecondary(enforced.outline),
        fillOutlineContrast: enforced.fillOutlineContrast,
        outlineKeylineContrast: enforced.outlineKeylineContrast,
        contrastFallback: Boolean(enforced.contrastFallback || meta.contrastFallback),
        contrastReason: enforced.reason || meta.contrastReason || null,
      };
    };

    if (cached && !cached.fallback) {
      const packaged = packageColors(cached.fill, cached.outline, cached.keyline, {
        cached: true,
      });
      // Refresh cache when older low-contrast pairs are corrected.
      if (key && packaged.contrastFallback) {
        suitColorCache.set(key, {
          fill: packaged.fill,
          outline: packaged.outline,
          keyline: packaged.keyline,
          fallback: false,
        });
        persistTruckColorCache();
      }
      return logDiag({
        driverName,
        photoUrl: photoUrl || "(none)",
        primaryFill: packaged.fill,
        innerOutline: packaged.outline,
        outerKeyline: packaged.keyline,
        fillOutlineContrast: packaged.fillOutlineContrast,
        outlineKeylineContrast: packaged.outlineKeylineContrast,
        cached: true,
        fallback: false,
        contrastFallback: packaged.contrastFallback,
        contrastReason: packaged.contrastReason,
        reason: null,
      });
    }

    if (!photoResult?.ok || !photoResult.img || photoResult.usedFallback) {
      const hashed = hashFallbackSuitColors(driverName);
      const packaged = packageColors(hashed.fill, hashed.outline, null, {
        fallback: true,
        fallbackReason: photoResult?.error || "driver_photo_unavailable",
      });
      if (key) {
        suitColorCache.set(key, {
          fill: packaged.fill,
          outline: packaged.outline,
          keyline: packaged.keyline,
          fallback: true,
          fallbackReason: packaged.fallbackReason,
        });
        persistTruckColorCache();
      }
      return logDiag({
        driverName,
        photoUrl: photoUrl || "(none)",
        primaryFill: packaged.fill,
        innerOutline: packaged.outline,
        outerKeyline: packaged.keyline,
        fillOutlineContrast: packaged.fillOutlineContrast,
        outlineKeylineContrast: packaged.outlineKeylineContrast,
        cached: false,
        fallback: true,
        contrastFallback: packaged.contrastFallback,
        contrastReason: packaged.contrastReason,
        reason: packaged.fallbackReason,
      });
    }

    const sampled = sampleSuitColorsFromPortrait(photoResult.img);
    if (sampled.error) {
      const hashed = hashFallbackSuitColors(driverName);
      const packaged = packageColors(hashed.fill, hashed.outline, null, {
        fallback: true,
        fallbackReason: sampled.error,
      });
      if (key) {
        suitColorCache.set(key, {
          fill: packaged.fill,
          outline: packaged.outline,
          keyline: packaged.keyline,
          fallback: true,
          fallbackReason: `${sampled.error}${sampled.detail ? `: ${sampled.detail}` : ""}`,
        });
        persistTruckColorCache();
      }
      return logDiag({
        driverName,
        photoUrl,
        primaryFill: packaged.fill,
        innerOutline: packaged.outline,
        outerKeyline: packaged.keyline,
        fillOutlineContrast: packaged.fillOutlineContrast,
        outlineKeylineContrast: packaged.outlineKeylineContrast,
        cached: false,
        fallback: true,
        contrastFallback: packaged.contrastFallback,
        contrastReason: packaged.contrastReason,
        reason: `${sampled.error}${sampled.detail ? `: ${sampled.detail}` : ""}`,
      });
    }

    const packaged = packageColors(sampled.fill, sampled.outline, sampled.keyline, {
      contrastFallback: sampled.contrastFallback,
      contrastReason: sampled.contrastReason,
    });
    if (key) {
      suitColorCache.set(key, {
        fill: packaged.fill,
        outline: packaged.outline,
        keyline: packaged.keyline,
        fallback: false,
      });
      persistTruckColorCache();
    }
    return logDiag({
      driverName,
      photoUrl,
      primaryFill: packaged.fill,
      innerOutline: packaged.outline,
      outerKeyline: packaged.keyline,
      fillOutlineContrast: packaged.fillOutlineContrast,
      outlineKeylineContrast: packaged.outlineKeylineContrast,
      cached: false,
      fallback: false,
      contrastFallback: packaged.contrastFallback,
      contrastReason: packaged.contrastReason,
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
    category = "driver-name",
  ) {
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    let size = startingFontSize;
    let font = `${fontWeightStyle} ${size}px ${FONT_SMALL}`;
    while (size > minimumFontSize) {
      ctx.font = font;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 1;
      font = `${fontWeightStyle} ${size}px ${FONT_SMALL}`;
    }
    ctx.restore();
    drawNativeFillText(ctx, {
      text,
      x: centerX,
      y,
      font,
      fill,
      align: "center",
      category,
      stage: "master-hires",
    });
    return size;
  }

  function drawCenteredSubtitleLines(ctx, text, centerX, startY, maxWidth, fill) {
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.font = `bold 13px ${FONT_SMALL}`;
    const lines = wrapText(ctx, text, maxWidth);
    ctx.restore();
    lines.forEach((line, i) => {
      drawNativeFillText(ctx, {
        text: line,
        x: centerX,
        y: startY + i * 15,
        font: `bold 13px ${FONT_SMALL}`,
        fill,
        align: "center",
        category: "subtitle",
        stage: "master-hires",
      });
    });
  }

  function drawRankNumber(ctx, rank, x, y, tier) {
    // Large supersampled rank numerals — fill only, no soft text glow.
    const fontSpec = `bold 52px ${FONT_DISPLAY}`;
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.font = fontSpec;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const px = Math.round(x);
    const py = Math.round(y);

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

  function drawMasterTitle(ctx, text, x, y, font, fill, align = "center") {
    // Large POWER RANKINGS title — supersampled, fill-only, no glow.
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, Math.round(x), Math.round(y));
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
      outerStroke = 7,
      innerStroke = 4,
    } = style;
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.translate(Math.round(x), Math.round(y));
    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = 1;

    if (shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 2.5;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
    }

    ctx.strokeStyle = keyline;
    ctx.lineWidth = outerStroke;
    ctx.strokeText(text, 0, 0);

    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.shadowColor = "transparent";

    ctx.strokeStyle = outline;
    ctx.lineWidth = innerStroke;
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
        subtitleColor: "#FFD400",
      };
    }
    if (rank === 2) {
      return {
        border: "#d8d8d8",
        glow: "rgba(200,200,200,0.25)",
        rankColor: "#f0f0f0",
        subtitleColor: "#FFFFFF",
      };
    }
    if (rank === 3) {
      return {
        border: "#cd7f32",
        glow: "rgba(205,127,50,0.3)",
        rankColor: "#e8a55a",
        subtitleColor: "#FFD400",
      };
    }
    if (movementClass === "positive") {
      return {
        border: "#2ecc71",
        glow: "rgba(46,204,113,0.18)",
        rankColor: "#ffffff",
        subtitleColor: "#00FF5A",
      };
    }
    if (movementClass === "negative") {
      return {
        border: "#ff3030",
        glow: "rgba(255,48,48,0.2)",
        rankColor: "#ffffff",
        subtitleColor: "#FF2A2A",
      };
    }
    if (movementClass === "new") {
      return {
        border: "#ffd23f",
        glow: "rgba(255,210,63,0.22)",
        rankColor: "#ffffff",
        subtitleColor: "#FFD400",
      };
    }
    return {
      border: "rgba(255,255,255,0.18)",
      glow: "rgba(255,255,255,0.05)",
      rankColor: "#ffffff",
      subtitleColor: "#FFFFFF",
    };
  }

  function cardTextLayout(bounds) {
    const { x, y, w, h } = bounds;
    const centerX = x + w / 2;
    const maxTextWidth = w - 24;
    const bottomPad = CARD_BOTTOM_TEXT_PAD;
    const nameBaselineY = y + h - bottomPad - 30;
    const subtitleStartY = y + h - bottomPad - 12;
    const textZoneTop = nameBaselineY - 86;
    const carNumBaseline = textZoneTop - 6;
    return { centerX, maxTextWidth, nameBaselineY, subtitleStartY, textZoneTop, carNumBaseline };
  }

  function drawHeaderMaster(ctx, week, assets, layout) {
    const { bpLogo, prophetLogo } = assets;
    drawImageContain(ctx, bpLogo.img, layout.padX, layout.padTop, 290, 68, {
      hAlign: "left",
      vAlign: "top",
    });

    drawMasterTitle(
      ctx,
      "POWER RANKINGS",
      EXPORT_WIDTH / 2,
      78,
      `bold 78px ${FONT_DISPLAY}`,
      "#FFFFFF",
      "center",
    );

    drawImageContain(ctx, prophetLogo.img, EXPORT_WIDTH - layout.padX - 120, 8, 120, 120, {
      hAlign: "right",
      vAlign: "top",
    });

    const barY = layout.headerBottom - 6;
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.fillStyle = "#3a0000";
    ctx.fillRect(layout.padX, barY, EXPORT_WIDTH - layout.padX * 2, layout.subbarH);
    ctx.fillStyle = "#6e0000";
    ctx.fillRect(layout.padX, barY, (EXPORT_WIDTH - layout.padX * 2) / 2, layout.subbarH);
    ctx.strokeStyle = "#b80000";
    ctx.lineWidth = 2;
    ctx.strokeRect(layout.padX + 0.5, barY + 0.5, EXPORT_WIDTH - layout.padX * 2 - 1, layout.subbarH - 1);
    ctx.restore();
  }

  function drawHeaderFinalText(ctx, week, layout, trackName) {
    const barY = layout.headerBottom - 6;

    drawNativeFillText(ctx, {
      text: normalizeSeasonLabel(week.seasonName),
      x: layout.padX + 4,
      y: 92,
      font: `bold 26px ${FONT_SMALL}`,
      fill: "#e50914",
      align: "left",
      category: "season-label",
    });

    drawNativeFillText(ctx, {
      text: "POWER RANKINGS & RACE ANALYSIS",
      x: EXPORT_WIDTH - layout.padX - 4,
      y: 118,
      font: `bold 11px ${FONT_SMALL}`,
      fill: "#e50914",
      align: "right",
      category: "header-analysis",
    });

    drawNativeFillText(ctx, {
      text: `RACE ${Number(week.raceNumber)} RANKINGS`,
      x: layout.padX + 16,
      y: barY + 26,
      font: `bold 18px ${FONT_SMALL}`,
      fill: "#FFFFFF",
      align: "left",
      category: "race-label",
    });

    const trackLabel = formatTrackLabel(trackName);
    if (trackLabel) {
      drawNativeFillText(ctx, {
        text: trackLabel,
        x: EXPORT_WIDTH / 2,
        y: barY + 26,
        font: `bold 17px ${FONT_SMALL}`,
        fill: "#FFFFFF",
        align: "center",
        category: "track-name",
      });
    }

    drawNativeFillText(ctx, {
      text: formatPublishedUpper(week.publishedDate),
      x: EXPORT_WIDTH - layout.padX - 16,
      y: barY + 26,
      font: `bold 16px ${FONT_SMALL}`,
      fill: "#FFFFFF",
      align: "right",
      category: "published-date",
    });
  }

  function drawRankingCardMaster(ctx, entry, bounds, driverAsset) {
    const { x, y, w, h } = bounds;
    const tier = cardTierStyle(entry.rank, entry.movementClass);
    const colors = driverAsset.colors;
    const { textZoneTop, carNumBaseline } = cardTextLayout(bounds);

    ctx.save();
    resetTextRenderingState(ctx);
    const panelGrad = ctx.createLinearGradient(x, y, x, y + h);
    panelGrad.addColorStop(0, "rgba(28,28,28,0.74)");
    panelGrad.addColorStop(1, "rgba(5,5,5,0.70)");
    ctx.fillStyle = panelGrad;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.save();
    resetTextRenderingState(ctx);
    ctx.strokeStyle = tier.border;
    ctx.lineWidth = entry.rank === 1 ? 3 : 2;
    if (tier.glow) {
      ctx.shadowColor = tier.glow;
      ctx.shadowBlur = entry.rank <= 3 || entry.movementClass === "new" ? 14 : 6;
    }
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();

    ctx.save();
    resetTextRenderingState(ctx);
    drawRankNumber(ctx, entry.rank, x + 12, y + 52, tier);

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

    drawLayeredNumber(ctx, entry.carNumber || "—", x + 14, carNumBaseline, {
      fill: colors.fill,
      outline: colors.outline,
      keyline: colors.keyline || "#000000",
      font: `bold 86px ${FONT_DISPLAY}`,
      outerStroke: 7,
      innerStroke: 4,
    });
    ctx.restore();
  }

  function drawRankingCardFinalText(ctx, entry, bounds) {
    const { x, y, w } = bounds;
    const tier = cardTierStyle(entry.rank, entry.movementClass);
    const { centerX, maxTextWidth, nameBaselineY, subtitleStartY } = cardTextLayout(bounds);

    let moveColor = "#888888";
    if (entry.movementClass === "positive") moveColor = "#00FF5A";
    if (entry.movementClass === "negative") moveColor = "#FF2A2A";
    if (entry.movementClass === "new") moveColor = "#FFD400";

    drawNativeFillText(ctx, {
      text: entry.movementText,
      x: x + w - 12,
      y: y + 36,
      font: `bold 20px ${FONT_SMALL}`,
      fill: moveColor,
      align: "right",
      category: "movement",
    });

    drawFittedCenteredText(
      ctx,
      displayNameForEntry(entry).toUpperCase(),
      centerX,
      nameBaselineY,
      maxTextWidth,
      "bold",
      19,
      13,
      "#FFFFFF",
      "driver-name",
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

  function drawHonorableMentionMaster(ctx, entry, bounds, driverAsset) {
    const { x, y, w, h } = bounds;
    const colors = driverAsset.colors;

    ctx.save();
    resetTextRenderingState(ctx);
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();

    drawLayeredNumber(ctx, entry.carNumber || "—", x + 18, y + h - 28, {
      fill: colors.fill,
      outline: colors.outline,
      keyline: colors.keyline || "#000000",
      font: `bold 64px ${FONT_DISPLAY}`,
      shadow: true,
      outerStroke: 6,
      innerStroke: 3.5,
    });

    const photoImg = driverAsset.photo?.img;
    if (photoImg) {
      drawImageContain(ctx, photoImg, x + 88, y + 6, 132, h - 12, {
        hAlign: "center",
        vAlign: "bottom",
        scaleMult: HONORABLE_PORTRAIT_SCALE,
      });
    }
  }

  function drawHonorableSectionMaster(ctx, week, assets, layout) {
    const mentions = assets.mentions;
    if (!mentions.length) return;

    const barX = layout.padX;
    const barW = EXPORT_WIDTH - layout.padX * 2;
    const barY = layout.honorableY;

    ctx.save();
    resetTextRenderingState(ctx);
    ctx.fillStyle = "#8b0000";
    ctx.fillRect(barX, barY, barW, 34);
    ctx.strokeStyle = "#ff3030";
    ctx.lineWidth = 2;
    ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, 33);
    ctx.restore();

    const panelY = barY + 40;
    const panelH = layout.honorableH - 44;
    const gap = 12;
    const panelW = (barW - gap * (mentions.length - 1)) / mentions.length;

    mentions.forEach((entry, index) => {
      const x = barX + index * (panelW + gap);
      const asset = assets.driverAssets.get(entry.driverId || entry.driverName);
      if (!asset) return;
      drawHonorableMentionMaster(ctx, entry, { x, y: panelY, w: panelW, h: panelH }, asset);
    });
  }

  function drawHonorableSectionFinalText(ctx, assets, layout) {
    const mentions = assets.mentions;
    if (!mentions.length) return;

    const barX = layout.padX;
    const barW = EXPORT_WIDTH - layout.padX * 2;
    const barY = layout.honorableY;

    drawNativeFillText(ctx, {
      text: "HONORABLE MENTIONS",
      x: EXPORT_WIDTH / 2,
      y: barY + 24,
      font: `bold 20px ${FONT_SMALL}`,
      fill: "#FFFFFF",
      align: "center",
      category: "honorable-heading",
    });

    const panelY = barY + 40;
    const panelH = layout.honorableH - 44;
    const gap = 12;
    const panelW = (barW - gap * (mentions.length - 1)) / mentions.length;

    mentions.forEach((entry, index) => {
      const x = barX + index * (panelW + gap);
      drawNativeFillText(ctx, {
        text: displayNameForEntry(entry).toUpperCase(),
        x: x + 232,
        y: panelY + panelH / 2 + 10,
        font: `bold 26px ${FONT_SMALL}`,
        fill: "#FFFFFF",
        align: "left",
        category: "honorable-name",
      });
    });
  }

  function drawFooterMaster(ctx, layout) {
    ctx.save();
    resetTextRenderingState(ctx);
    ctx.strokeStyle = "#b80000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(layout.padX, layout.footerY - 10);
    ctx.lineTo(EXPORT_WIDTH - layout.padX, layout.footerY - 10);
    ctx.stroke();
    ctx.restore();
  }

  function drawFooterFinalText(ctx, layout) {
    drawNativeFillText(ctx, {
      text: "FAST DRIVERS. CLOSE RACING. BIG FUN.",
      x: EXPORT_WIDTH / 2,
      y: layout.footerY + 14,
      font: `bold 14px ${FONT_SMALL}`,
      fill: "#FFFFFF",
      align: "center",
      category: "footer",
    });
  }

  async function readPngDimensions(blob) {
    const header = await blob.slice(0, 24).arrayBuffer();
    const view = new DataView(header);
    const isPng =
      view.byteLength >= 24 &&
      view.getUint32(0) === 0x89504e47 &&
      view.getUint32(4) === 0x0d0a1a0a;
    if (!isPng) return { width: null, height: null, validPng: false };
    return {
      width: view.getUint32(16),
      height: view.getUint32(20),
      validPng: true,
    };
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("PNG export failed."));
        },
        "image/png",
      );
    });
  }

  /**
   * @param {object} week
   * @param {{ outputMode?: '4k'|'1080p' }} [options]
   * Default outputMode is '4k' (true 3840×2160, no downsample).
   * '1080p' downsamples the completed hi-res graphic once for A/B testing.
   */
  async function renderPowerRankingsDiscordCanvas(week, options = {}) {
    validateWeek(week);
    const outputMode = options.outputMode === "1080p" ? "1080p" : "4k";
    const fontInfo = await ensureFontsReady();
    const assets = await preloadExportAssets(week);
    const layout = computeLayout(assets.mentions.length);
    const trackName = await resolveTrackName(Number(week.raceNumber), week);

    const master = document.createElement("canvas");
    master.width = EXPORT_WIDTH * RENDER_SCALE;
    master.height = EXPORT_HEIGHT * RENDER_SCALE;
    const ctx = master.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    resetTextRenderingState(ctx);

    drawCarbonBackground(ctx);
    drawProphetWatermark(ctx, assets.prophetLogo.img, layout);
    resetTextRenderingState(ctx);
    drawHeaderMaster(ctx, week, assets, layout);

    assets.entries.forEach((entry, index) => {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const x = layout.padX + col * (layout.cardW + layout.colGap);
      const y = layout.gridTop + row * (layout.rowH + layout.rowGap);
      const driverAsset = assets.driverAssets.get(entry.driverId || entry.driverName);
      drawRankingCardMaster(
        ctx,
        entry,
        { x, y, w: layout.cardW, h: layout.rowH },
        driverAsset,
      );
    });

    drawHonorableSectionMaster(ctx, week, assets, layout);
    drawFooterMaster(ctx, layout);

    // All small/medium text drawn on the same hi-res canvas (logical coords via scale).
    resetTextRenderingState(ctx);
    drawHeaderFinalText(ctx, week, layout, trackName);
    assets.entries.forEach((entry, index) => {
      const col = index % 5;
      const row = Math.floor(index / 5);
      const x = layout.padX + col * (layout.cardW + layout.colGap);
      const y = layout.gridTop + row * (layout.rowH + layout.rowGap);
      drawRankingCardFinalText(ctx, entry, { x, y, w: layout.cardW, h: layout.rowH });
    });
    drawHonorableSectionFinalText(ctx, assets, layout);
    drawFooterFinalText(ctx, layout);

    let canvas = master;
    let downsampled = false;

    if (outputMode === "1080p") {
      // A/B only: one downsample of the completed hi-res graphic.
      const finalCanvas = document.createElement("canvas");
      finalCanvas.width = EXPORT_WIDTH;
      finalCanvas.height = EXPORT_HEIGHT;
      const finalCtx = finalCanvas.getContext("2d", { alpha: false });
      finalCtx.imageSmoothingEnabled = true;
      finalCtx.imageSmoothingQuality = "high";
      finalCtx.drawImage(master, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
      canvas = finalCanvas;
      downsampled = true;
    }

    const blob = await canvasToPngBlob(canvas);
    const pngDims = await readPngDimensions(blob);

    const exportLog = {
      width: pngDims.width,
      height: pngDims.height,
      blobSize: blob.size,
      renderScale: RENDER_SCALE,
      downsampled,
      outputMode,
      masterCanvas: `${master.width}×${master.height}`,
    };
    console.log("[pr-discord-export] PNG export", exportLog);

    if (
      outputMode === "4k" &&
      (pngDims.width !== EXPORT_WIDTH * RENDER_SCALE ||
        pngDims.height !== EXPORT_HEIGHT * RENDER_SCALE)
    ) {
      console.warn("[pr-discord-export] Unexpected 4K PNG dimensions", pngDims);
    }
    if (
      outputMode === "1080p" &&
      (pngDims.width !== EXPORT_WIDTH || pngDims.height !== EXPORT_HEIGHT)
    ) {
      console.warn("[pr-discord-export] Unexpected 1080p PNG dimensions", pngDims);
    }

    lastRenderDiagnostics = {
      canvasMasterResolution: `${EXPORT_WIDTH * RENDER_SCALE}×${EXPORT_HEIGHT * RENDER_SCALE}`,
      canvasInternalResolution: `${EXPORT_WIDTH * RENDER_SCALE}×${EXPORT_HEIGHT * RENDER_SCALE}`,
      outputResolution: `${pngDims.width || canvas.width}×${pngDims.height || canvas.height}`,
      renderScale: RENDER_SCALE,
      downsampled,
      outputMode,
      downsample:
        outputMode === "4k"
          ? "none — PNG encoded directly from 3840×2160 master"
          : "single drawImage downsample of completed master for 1080p A/B test",
      smallTextStage: "master-hires-with-scale",
      pngExport: exportLog,
      fontsUsed: fontInfo.fontsUsed,
      fontWeightsUsed: fontInfo.fontWeightsUsed,
      fontFallbackRequired: fontInfo.fallbackRequired,
      impactLoaded: fontInfo.impactLoaded,
      narrowLoaded: fontInfo.narrowLoaded,
      arialLoaded: fontInfo.arialLoaded,
      fontWarnings: fontInfo.warnings || [],
      minNumberContrast: MIN_NUMBER_CONTRAST,
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
          contrast: row.fillOutlineContrast != null ? Number(row.fillOutlineContrast).toFixed(2) : "",
          contrastFix: row.contrastFallback ? row.contrastReason : "",
          fallback: row.fallback ? row.reason : "",
        })),
      );
    }

    return {
      canvas,
      blob,
      raceNumber: Number(week.raceNumber),
      width: pngDims.width || canvas.width,
      height: pngDims.height || canvas.height,
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
    }, "image/png");
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

  async function downloadWeekPng(week, options = {}) {
    const result = await renderPowerRankingsDiscordCanvas(week, options);
    const suffix = result.diagnostics?.outputMode === "1080p" ? "1080p" : "4k";
    downloadBlob(
      result.blob,
      `blazing-pedals-power-rankings-race-${result.raceNumber}-${suffix}.png`,
    );
    return result;
  }

  async function previewWeekPng(week, options = {}) {
    const result = await renderPowerRankingsDiscordCanvas(week, {
      outputMode: "4k",
      ...options,
    });
    const objectUrl = URL.createObjectURL(result.blob);
    return { ...result, objectUrl };
  }

  async function exportWeek(week) {
    return downloadWeekPng(week, { outputMode: "4k" });
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
