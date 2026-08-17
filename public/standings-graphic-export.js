/**
 * Blazing Pedals Truck Series — championship standings graphic export.
 * Master canvas: 3840×2160 (logical 1920×1080 × RENDER_SCALE 2). No downsample.
 */
import {
  LOGICAL_WIDTH,
  LOGICAL_HEIGHT,
  RENDER_SCALE,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  MAX_DRIVERS,
  DEFAULT_PLAYOFF_CUT,
  SPONSOR_NAME,
  SITE_URL,
  DEFAULT_PLATE,
  TYPOGRAPHY,
  distributeColumns,
  formatWinsLabel,
  formatPointsLabel,
  formatSeasonHeading,
  formatAfterRaceLine,
  fitTextFontSize,
  fitTrackNameDisplay,
  plateNumberFontSize,
  formatPlateDisplay,
  pickReadableNumberColor,
  resolveStandingsPlateColors,
  isNearWhiteHex,
  isUsablePlateFill,
  buildSponsorFooterText,
  validateOutputDimensions,
  buildStandingsGraphicModel,
  computeStandingsLayoutMetrics,
  sanitizeTrackName,
  measureTrackedTextWidth,
} from "./standings-graphic-export-logic.js";

const BP_LOGO = "/assets/logos/New%20Clean%20Logo.png";
const FONT_DISPLAY = 'Impact, Haettenschweiler, "Arial Black", Arial, sans-serif';
const FONT_BODY = '"Arial Narrow", Arial, sans-serif';
const PR_SUIT_CACHE_KEY = "bp_pr_suit_colors_v4";

const imageAssetCache = new Map();
const suitColorCache = new Map();
let lastRenderDiagnostics = null;

if (typeof localStorage !== "undefined") {
  try {
    const stored = JSON.parse(localStorage.getItem(PR_SUIT_CACHE_KEY) || "{}");
    Object.entries(stored).forEach(([key, value]) => {
      if (value?.fill && value?.outline) suitColorCache.set(key, value);
    });
  } catch {
    /* ignore */
  }
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

function measureCtxChar(ctx, font, ch) {
  ctx.save();
  ctx.font = font;
  const w = ctx.measureText(ch).width;
  ctx.restore();
  return w;
}

function measureCtxText(ctx, font, text) {
  ctx.save();
  ctx.font = font;
  const w = ctx.measureText(String(text || "")).width;
  ctx.restore();
  return w;
}

/**
 * Tracked Canvas text with correct left/center/right alignment.
 * Tracking is included in total measured width.
 */
function drawTextWithTracking(ctx, text, x, y, tracking, {
  font,
  fill,
  align = "left",
  baseline = "middle",
} = {}) {
  const value = String(text || "");
  const chars = Array.from(value);
  ctx.save();
  resetTextRenderingState(ctx);
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = "left";
  ctx.textBaseline = baseline;

  const total = measureTrackedTextWidth(
    (f, ch) => measureCtxChar(ctx, f, ch),
    font,
    value,
    tracking,
  );

  let cursor = x;
  if (align === "center") cursor = x - total / 2;
  else if (align === "right") cursor = x - total;

  chars.forEach((ch, index) => {
    ctx.fillText(ch, Math.round(cursor), Math.round(y));
    cursor += measureCtxChar(ctx, font, ch);
    if (index < chars.length - 1) cursor += tracking;
  });
  ctx.restore();
  return total;
}

function drawFillText(ctx, { text, x, y, font, fill, align = "left", baseline = "middle", tracking = 0 }) {
  if (tracking) {
    return drawTextWithTracking(ctx, text, x, y, tracking, { font, fill, align, baseline });
  }
  ctx.save();
  resetTextRenderingState(ctx);
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(String(text || ""), Math.round(x), Math.round(y));
  ctx.restore();
}

function loadImage(url) {
  const key = String(url || "").trim();
  if (!key) return Promise.resolve(null);
  if (imageAssetCache.has(key)) return imageAssetCache.get(key);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = key;
  });
  imageAssetCache.set(key, promise);
  return promise;
}

function stripUrlQuery(url) {
  return String(url || "")
    .trim()
    .split("?")[0]
    .split("#")[0];
}

function sampleSuitColorsFromPortrait(img) {
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const sampleW = 110;
  const sampleH = Math.max(64, Math.round(sampleW * (ih / iw)));
  const canvas = document.createElement("canvas");
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { error: "no_ctx" };
  ctx.drawImage(img, 0, 0, sampleW, sampleH);

  let data;
  try {
    data = ctx.getImageData(0, 0, sampleW, sampleH).data;
  } catch {
    return { error: "tainted" };
  }

  const satBuckets = new Map();
  let lightWeight = 0;
  let darkWeight = 0;

  for (let y = Math.floor(sampleH * 0.38); y < sampleH; y += 2) {
    for (let x = Math.floor(sampleW * 0.18); x < sampleW * 0.82; x += 2) {
      const i = (y * sampleW + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 130) continue;

      // Skip skin-ish tones (face/hands dominating suits).
      if (r > 95 && g > 55 && b > 40 && r > g && g > b && r - b > 35 && r - g < 70) continue;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;

      if (max > 210 && sat < 0.12) {
        lightWeight += 1;
        continue;
      }
      if (max < 38) {
        darkWeight += 1;
        continue;
      }
      if (sat < 0.14) continue;

      const key = `${Math.round(r / 18) * 18},${Math.round(g / 18) * 18},${Math.round(b / 18) * 18}`;
      satBuckets.set(key, (satBuckets.get(key) || 0) + 1 + sat);
    }
  }

  const sorted = [...satBuckets.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    if (lightWeight > darkWeight && lightWeight > 0) {
      return { fill: "#ffffff", outline: "#c81010", keyline: "#1a1a1a", lightDominant: true };
    }
    return { error: "no_colors" };
  }

  const [fr, fg, fb] = sorted[0][0].split(",").map(Number);
  const fill = `#${[fr, fg, fb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  let outline = lightWeight > 0 ? "#ffffff" : "#101010";
  if (sorted[1]) {
    const [or, og, ob] = sorted[1][0].split(",").map(Number);
    outline = `#${[or, og, ob].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return {
    fill,
    outline,
    keyline: pickReadableNumberColor(fill) === "#ffffff" ? "#0a0a0a" : "#f5f5f5",
    lightDominant: isNearWhiteHex(fill),
  };
}

/**
 * Resolve plate fill without stopping on the first unusable color.
 * Priority: cache primary → cache secondary → portrait primary → portrait secondary
 * → driver profile/truck/accent fields → deterministic fallback.
 */
async function resolvePlateColors(driver) {
  const photoUrl = stripUrlQuery(driver.photoUrl);
  const cacheKey = photoUrl
    ? `suit:${photoUrl}`
    : driver.driverId
      ? `suit:driver:${driver.driverId}`
      : "";

  const cached = cacheKey && suitColorCache.has(cacheKey) ? suitColorCache.get(cacheKey) : null;
  const candidates = [];
  let rawPrimary = "";
  let rawSecondary = "";
  let rawSource = "none";

  if (cached) {
    rawPrimary = cached.fill || "";
    rawSecondary = cached.outline || "";
    rawSource = "suit_cache";
    candidates.push({ color: rawPrimary, role: "primary", source: "suit_cache" });
    candidates.push({ color: rawSecondary, role: "secondary", source: "suit_cache" });
  }

  const cacheHasUsable = candidates.some((c) => isUsablePlateFill(c.color).ok);

  // Portrait only when cache did not already provide a usable plate fill.
  if (!cacheHasUsable && photoUrl) {
    const img = await loadImage(photoUrl);
    if (img) {
      const sampled = sampleSuitColorsFromPortrait(img);
      if (!sampled.error) {
        if (!cached) {
          rawPrimary = sampled.fill || "";
          rawSecondary = sampled.outline || "";
          rawSource = "portrait_sample";
        }
        candidates.push({ color: sampled.fill, role: "primary", source: "portrait_sample" });
        candidates.push({ color: sampled.outline, role: "secondary", source: "portrait_sample" });
      }
    }
  }

  for (const [field, source] of [
    ["truckColor", "truck_color"],
    ["profileColor", "profile_color"],
    ["accentColor", "profile_color"],
    ["primaryColor", "profile_color"],
    ["carColor", "truck_color"],
  ]) {
    const value = driver?.[field];
    if (value) candidates.push({ color: value, role: "accent", source });
  }

  return resolveStandingsPlateColors({
    driver,
    rawPrimary,
    rawSecondary,
    rawSource,
    candidates,
  });
}

function drawCarbonBackground(ctx) {
  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.18;
  for (let y = -LOGICAL_HEIGHT; y < LOGICAL_HEIGHT * 2; y += 14) {
    ctx.strokeStyle = y % 28 === 0 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LOGICAL_WIDTH, y + LOGICAL_WIDTH * 0.5);
    ctx.stroke();
  }
  ctx.restore();

  const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
  grad.addColorStop(0, "rgba(34,34,34,0.45)");
  grad.addColorStop(0.5, "rgba(8,8,8,0.1)");
  grad.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Single header draw path — logo left, season/race/track right (once each).
 */
function drawHeader(ctx, model, logoImg, layout) {
  const seasonName = model.seasonName;
  const raceNumber = model.latestCompletedRace?.raceNumber ?? model.pointsRaceNumber;
  const trackName = sanitizeTrackName(model.latestCompletedRace?.trackName);
  const hasTrack = Boolean(trackName);
  const rightX = LOGICAL_WIDTH - layout.padX;
  const T = TYPOGRAPHY;

  if (logoImg) {
    const logoH = 56;
    const scale = logoH / (logoImg.naturalHeight || 1);
    const logoW = Math.min(160, (logoImg.naturalWidth || 1) * scale);
    ctx.drawImage(logoImg, layout.padX, 10, logoW, logoH);
    drawFillText(ctx, {
      text: "TRUCK SERIES",
      x: layout.padX + logoW + 12,
      y: 38,
      font: `bold 22px ${FONT_DISPLAY}`,
      fill: "#ffffff",
      align: "left",
      baseline: "middle",
      tracking: 0.6,
    });
  } else {
    drawFillText(ctx, {
      text: "BLAZING PEDALS",
      x: layout.padX,
      y: 26,
      font: `bold 16px ${FONT_BODY}`,
      fill: "#ff3a3a",
      align: "left",
      baseline: "middle",
      tracking: 0.8,
    });
    drawFillText(ctx, {
      text: "TRUCK SERIES",
      x: layout.padX,
      y: 50,
      font: `bold 24px ${FONT_DISPLAY}`,
      fill: "#ffffff",
      align: "left",
      baseline: "middle",
      tracking: 0.6,
    });
  }

  drawFillText(ctx, {
    text: formatSeasonHeading(seasonName),
    x: rightX,
    y: hasTrack ? 20 : 32,
    font: `bold ${T.seasonMax}px ${FONT_DISPLAY}`,
    fill: "#ffffff",
    align: "right",
    baseline: "middle",
    tracking: T.tracking.season,
  });

  drawFillText(ctx, {
    text: formatAfterRaceLine(raceNumber),
    x: rightX,
    y: hasTrack ? 48 : 60,
    font: `bold ${T.afterRace}px ${FONT_BODY}`,
    fill: "#d0d0d0",
    align: "right",
    baseline: "middle",
    tracking: T.tracking.afterRace,
  });

  let trackFit = { lines: [], fontSize: T.trackMax, truncated: false, fullTrackName: "" };
  if (hasTrack) {
    const maxWidth = 720;
    const measure = (font, text) => measureCtxText(ctx, font, text);
    trackFit = fitTrackNameDisplay(measure, trackName, maxWidth, {
      fontFamily: FONT_BODY,
      fontWeight: "bold",
      maxSize: T.trackMax,
      minSize: T.trackMin,
      tracking: T.tracking.track,
    });
    const lineStartY = trackFit.lines.length > 1 ? 68 : 74;
    trackFit.lines.forEach((line, index) => {
      drawFillText(ctx, {
        text: line,
        x: rightX,
        y: lineStartY + index * (trackFit.fontSize + 3),
        font: `bold ${trackFit.fontSize}px ${FONT_BODY}`,
        fill: "#b8b8b8",
        align: "right",
        baseline: "middle",
        tracking: T.tracking.track,
      });
    });
  }

  const ruleY = layout.headerH - 6;
  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "rgba(255,48,48,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(layout.padX, ruleY);
  ctx.lineTo(LOGICAL_WIDTH - layout.padX, ruleY);
  ctx.stroke();
  ctx.restore();

  return trackFit;
}

function drawNumberPlate(ctx, carNumber, colors, x, y, w, h) {
  const display = formatPlateDisplay(carNumber);
  const fill = colors?.fill || DEFAULT_PLATE.fill;
  const outline = colors?.outline || DEFAULT_PLATE.outline;
  const keyline = colors?.keyline || DEFAULT_PLATE.keyline;
  const numberFill = colors?.numberFill || pickReadableNumberColor(fill);

  ctx.save();
  resetTextRenderingState(ctx);

  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();

  ctx.strokeStyle = keyline;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3.5);
  ctx.stroke();

  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.35;
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 2.5);
  ctx.stroke();

  const fontSize = plateNumberFontSize(display, {
    maxSize: Math.floor(h * 0.74),
    minSize: 12,
  });
  ctx.font = `bold ${fontSize}px ${FONT_DISPLAY}`;
  ctx.fillStyle = numberFill;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(display, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
}

function rowStyle(position) {
  const pos = Number(position);
  if (pos === 1) {
    return {
      bg: "rgba(90,70,18,0.32)",
      border: "rgba(212,175,55,0.6)",
      posFill: "#f0d060",
      nameFill: "#fff8e0",
      nameWeight: "bold",
    };
  }
  if (pos >= 2 && pos <= 10) {
    return {
      bg: "rgba(42,42,42,0.58)",
      border: "rgba(180,40,40,0.5)",
      posFill: "#ffffff",
      nameFill: "#ffffff",
      nameWeight: "bold",
    };
  }
  return {
    bg: "rgba(22,22,22,0.5)",
    border: "rgba(70,70,70,0.55)",
    posFill: "#d0d0d0",
    nameFill: "#f0f0f0",
    nameWeight: "bold",
  };
}

function drawDriverRow(ctx, driver, box, plateColors, layout) {
  const { x, y, w, h } = box;
  const style = rowStyle(driver.position);
  const pad = 6;
  const T = TYPOGRAPHY;
  const plateW = layout.plateW;
  const plateH = layout.plateH;
  const posW = layout.posW;
  const moveW = layout.moveW;
  const statsW = layout.statsW;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.fillStyle = style.bg;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = style.border;
  ctx.lineWidth = Number(driver.position) === 1 ? 1.75 : 1;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 4);
  ctx.stroke();
  ctx.restore();

  const cy = y + h / 2;
  const posSize =
    Number(driver.position) <= 10 ? T.positionTop10 : T.positionRest;

  drawFillText(ctx, {
    text: String(driver.position),
    x: x + pad + posW / 2,
    y: cy,
    font: `bold ${posSize}px ${FONT_DISPLAY}`,
    fill: style.posFill,
    align: "center",
    baseline: "middle",
  });

  const movement = driver.movement || { text: "—", dir: "flat" };
  const moveColor =
    movement.dir === "up" ? "#3dce6a" : movement.dir === "down" ? "#ff5a5a" : "#888888";
  const moveX = x + pad + posW + layout.gapPosMove + moveW / 2;
  drawFillText(ctx, {
    text: movement.text,
    x: moveX,
    y: cy,
    font: `bold ${T.movement}px ${FONT_BODY}`,
    fill: moveColor,
    align: "center",
    baseline: "middle",
  });

  const plateX = x + pad + posW + layout.gapPosMove + moveW + layout.gapMovePlate;
  const plateY = y + (h - plateH) / 2;
  drawNumberPlate(ctx, driver.carNumber, plateColors, plateX, plateY, plateW, plateH);

  const nameX = plateX + plateW + layout.gapPlateName;
  const nameMaxW = w - (nameX - x) - statsW - pad;
  const tracking = T.tracking.driverName;
  const nameMax =
    Number(driver.position) <= 10 ? T.driverNameTop10 : T.driverNameRest;
  const measure = (font, text) => measureCtxText(ctx, font, text);
  const nameSize = fitTextFontSize(measure, driver.driverName.toUpperCase(), nameMaxW, {
    fontFamily: FONT_BODY,
    fontWeight: style.nameWeight,
    maxSize: nameMax,
    minSize: T.driverNameMin,
    tracking,
  });

  drawFillText(ctx, {
    text: driver.driverName.toUpperCase(),
    x: nameX,
    y: cy,
    font: `${style.nameWeight} ${nameSize}px ${FONT_BODY}`,
    fill: style.nameFill,
    align: "left",
    baseline: "middle",
    tracking,
  });

  const statsRight = x + w - pad;
  const winsLabel = formatWinsLabel(driver.wins);
  const pointsLabel = formatPointsLabel(driver.points);
  const winsW = measureCtxText(ctx, `bold ${T.wins}px ${FONT_BODY}`, winsLabel);

  drawFillText(ctx, {
    text: winsLabel,
    x: statsRight,
    y: cy,
    font: `bold ${T.wins}px ${FONT_BODY}`,
    fill: "#c0c0c0",
    align: "right",
    baseline: "middle",
  });

  drawFillText(ctx, {
    text: pointsLabel,
    x: statsRight - winsW - layout.gapPtsWins,
    y: cy,
    font: `bold ${T.points}px ${FONT_BODY}`,
    fill: "#ffffff",
    align: "right",
    baseline: "middle",
  });
}

function drawPlayoffCut(ctx, layout, placement, colX) {
  if (!placement) return;
  const { afterRowIndex, label } = placement;
  const T = TYPOGRAPHY;
  const cutRowBottom =
    layout.gridTop + (afterRowIndex + 1) * (layout.rowH + layout.rowGap) - layout.rowGap;
  const y = cutRowBottom + (layout.cutGap || 16) / 2;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#e01010";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(colX, y);
  ctx.lineTo(colX + layout.colW, y);
  ctx.stroke();

  const mid = colX + layout.colW / 2;
  const labelW = Math.min(layout.colW - 12, 260);
  const labelH = 22;
  ctx.fillStyle = "#140404";
  ctx.fillRect(mid - labelW / 2, y - labelH / 2, labelW, labelH);
  ctx.strokeStyle = "#e01010";
  ctx.lineWidth = 1.25;
  ctx.strokeRect(mid - labelW / 2, y - labelH / 2, labelW, labelH);
  ctx.restore();

  drawFillText(ctx, {
    text: label,
    x: mid,
    y,
    font: `bold ${T.playoffCut}px ${FONT_BODY}`,
    fill: "#ff6a6a",
    align: "center",
    baseline: "middle",
    tracking: T.tracking.playoffCut,
  });
}

function drawFooter(ctx, layout) {
  const y0 = layout.footerY;
  const footer = buildSponsorFooterText();
  const T = TYPOGRAPHY;
  const midY = y0 + layout.footerH / 2;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#b80000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(layout.padX, y0);
  ctx.lineTo(LOGICAL_WIDTH - layout.padX, y0);
  ctx.stroke();
  ctx.restore();

  // LEFT — series
  drawFillText(ctx, {
    text: "BLAZING PEDALS TRUCK SERIES",
    x: layout.padX,
    y: midY,
    font: `bold ${T.footerSeries}px ${FONT_BODY}`,
    fill: "#c8c8c8",
    align: "left",
    baseline: "middle",
    tracking: T.tracking.series,
  });

  // CENTER — presenting sponsor (two-line hierarchy)
  drawFillText(ctx, {
    text: footer.presentedBy,
    x: LOGICAL_WIDTH / 2,
    y: midY - 14,
    font: `bold ${T.footerPresentedBy}px ${FONT_BODY}`,
    fill: "#aaaaaa",
    align: "center",
    baseline: "middle",
    tracking: T.tracking.presentedBy,
  });
  drawFillText(ctx, {
    text: footer.sponsorLine,
    x: LOGICAL_WIDTH / 2,
    y: midY + 12,
    font: `bold ${T.footerSponsor}px ${FONT_DISPLAY}`,
    fill: "#ffffff",
    align: "center",
    baseline: "middle",
    tracking: T.tracking.sponsor,
  });

  // RIGHT — website
  drawFillText(ctx, {
    text: SITE_URL,
    x: LOGICAL_WIDTH - layout.padX,
    y: midY,
    font: `bold ${T.footerSite}px ${FONT_BODY}`,
    fill: "#d0d0d0",
    align: "right",
    baseline: "middle",
    tracking: T.tracking.site,
  });
}

async function ensureFontsReady() {
  if (!document.fonts?.ready) {
    return { fallbackRequired: true, warnings: ["document.fonts API unavailable"] };
  }
  await document.fonts.ready;
  await Promise.all([
    document.fonts.load(`bold 36px Impact`).catch(() => null),
    document.fonts.load(`bold 18px "Arial Narrow"`).catch(() => null),
    document.fonts.load(`bold 18px Arial`).catch(() => null),
  ]);
  return { fallbackRequired: false, warnings: [] };
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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildExportPayload(standingsData, scheduleData, options = {}) {
  return buildStandingsGraphicModel(standingsData, scheduleData, options);
}

export { buildStandingsGraphicModel };

export async function fetchStandingsGraphicSources() {
  const [standingsRes, scheduleRes] = await Promise.all([
    fetch("/api/standings"),
    fetch("/api/schedule"),
  ]);
  const standingsData = await standingsRes.json();
  const scheduleData = await scheduleRes.json();
  if (!standingsRes.ok) {
    throw new Error(standingsData.error || "Failed to load standings.");
  }
  if (!scheduleRes.ok) {
    throw new Error(scheduleData.error || "Failed to load schedule.");
  }
  return { standingsData, scheduleData };
}

/**
 * Render full 3840×2160 graphic from a prebuilt model. No network fetches.
 */
export async function renderStandingsGraphicCanvas(model, options = {}) {
  const drivers = model.drivers || [];
  if (!drivers.length) throw new Error("No standings drivers available to export.");

  const fontInfo = await ensureFontsReady();
  const logoImg = await loadImage(options.logoUrl || BP_LOGO);

  // Batch plate colors from PR cache / standings photo URLs (no per-driver API).
  const plateColorsList = await Promise.all(drivers.map((d) => resolvePlateColors(d)));
  const plateDiagnostics = drivers.map((driver, index) => {
    const colors = plateColorsList[index] || DEFAULT_PLATE;
    return {
      Driver: driver.driverName,
      "Car #": driver.carNumber || "",
      "Raw Source": colors.rawColorSource || colors.colorSource || "unknown",
      "Raw Primary": colors.rawPrimary || "",
      "Raw Secondary": colors.rawSecondary || "",
      "Final Source": colors.finalColorSource || colors.colorSource || colors.source || "unknown",
      "Final Primary": colors.finalPrimary || colors.platePrimary || colors.fill,
      "Final Secondary": colors.finalSecondary || colors.plateSecondary || colors.outline,
      "Text Color": colors.finalTextColor || colors.plateTextColor || colors.numberFill,
      "Rejected Reason(s)": colors.rejectedReasonText || "",
      // Keep snake keys for programmatic audit / filters
      driverName: driver.driverName,
      driverId: driver.driverId,
      carNumber: driver.carNumber || "",
      rawPrimary: colors.rawPrimary || "",
      rawSecondary: colors.rawSecondary || "",
      rawColorSource: colors.rawColorSource || "",
      finalPrimary: colors.finalPrimary || colors.platePrimary || colors.fill,
      finalSecondary: colors.finalSecondary || colors.plateSecondary || colors.outline,
      finalTextColor: colors.finalTextColor || colors.plateTextColor || colors.numberFill,
      finalColorSource: colors.finalColorSource || colors.colorSource || colors.source,
      platePrimary: colors.platePrimary || colors.fill,
      plateSecondary: colors.plateSecondary || colors.outline,
      plateTextColor: colors.plateTextColor || colors.numberFill,
      colorSource: colors.colorSource || colors.source || "unknown",
      rejectedReasons: colors.rejectedReasons || [],
      rejectedReasonText: colors.rejectedReasonText || "",
    };
  });

  const unintendedWhitePlates = plateDiagnostics.filter((d) => {
    const check = isUsablePlateFill(d.finalPrimary || d.platePrimary);
    return !check.ok && String(check.reason || "").includes("white");
  });
  if (unintendedWhitePlates.length) {
    console.warn(
      "[Standings Plate Colors] unintended white/near-white fills remaining",
      unintendedWhitePlates.map((d) => ({
        driverName: d.driverName,
        driverId: d.driverId,
        carNumber: d.carNumber,
        rawPrimary: d.rawPrimary,
        rawSecondary: d.rawSecondary,
        rawColorSource: d.rawColorSource,
        finalPrimary: d.finalPrimary,
        finalSecondary: d.finalSecondary,
        finalTextColor: d.finalTextColor,
        finalColorSource: d.finalColorSource,
        rejectedReasonText: d.rejectedReasonText,
      })),
    );
  }
  console.log("[Standings Plate Colors]");
  if (typeof console.table === "function") {
    console.table(
      plateDiagnostics.map((d) => ({
        Driver: d.Driver,
        "Car #": d["Car #"],
        "Raw Source": d["Raw Source"],
        "Raw Primary": d["Raw Primary"],
        "Raw Secondary": d["Raw Secondary"],
        "Final Source": d["Final Source"],
        "Final Primary": d["Final Primary"],
        "Final Secondary": d["Final Secondary"],
        "Text Color": d["Text Color"],
        "Rejected Reason(s)": d["Rejected Reason(s)"],
      })),
    );
  } else {
    console.log(plateDiagnostics);
  }

  const columns = model.columns || distributeColumns(drivers);
  const cutPlacement = model.cutPlacement || null;
  const hasTrackName = Boolean(sanitizeTrackName(model.latestCompletedRace?.trackName));
  const layout = computeStandingsLayoutMetrics({
    driverCount: drivers.length,
    hasTrackName,
    reserveCutGap: Boolean(cutPlacement),
  });
  layout.footerY = LOGICAL_HEIGHT - layout.footerH;

  if (!layout.fits) {
    console.warn("[standings-graphic-export] Layout tight for 43-driver board", layout);
  }

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(RENDER_SCALE, RENDER_SCALE);
  resetTextRenderingState(ctx);

  drawCarbonBackground(ctx);
  const trackFit = drawHeader(ctx, model, logoImg, layout);

  let driverColorIndex = 0;
  for (let col = 0; col < columns.length; col += 1) {
    const colX = layout.padX + col * (layout.colW + layout.colGap);
    const colDrivers = columns[col] || [];

    colDrivers.forEach((driver, rowIndex) => {
      let y = layout.gridTop + rowIndex * (layout.rowH + layout.rowGap);
      if (
        cutPlacement &&
        cutPlacement.columnIndex === col &&
        rowIndex > cutPlacement.afterRowIndex
      ) {
        y += layout.cutGap || 16;
      }
      const plateColors = plateColorsList[driverColorIndex] || DEFAULT_PLATE;
      driverColorIndex += 1;
      drawDriverRow(
        ctx,
        driver,
        { x: colX, y, w: layout.colW, h: layout.rowH },
        plateColors,
        layout,
      );
    });

    if (cutPlacement && cutPlacement.columnIndex === col) {
      drawPlayoffCut(ctx, layout, cutPlacement, colX);
    }
  }

  drawFooter(ctx, layout);

  const blob = await canvasToPngBlob(canvas);
  const pngDims = await readPngDimensions(blob);
  const missingPlates = drivers.filter((d) => d.carNumberMissing).length;
  const whitePlates = plateDiagnostics.filter((d) => {
    const fill = d.finalPrimary || d.platePrimary;
    return !isUsablePlateFill(fill).ok && isNearWhiteHex(fill);
  }).length;
  const exportLog = {
    width: pngDims.width,
    height: pngDims.height,
    blobSize: blob.size,
    renderScale: RENDER_SCALE,
    downsampled: false,
    driverCount: drivers.length,
    pointsRaceNumber: model.latestCompletedRace?.raceNumber ?? model.pointsRaceNumber,
    trackName: model.latestCompletedRace?.trackName || "",
    trackTruncated: Boolean(trackFit?.truncated),
    fullTrackName: trackFit?.fullTrackName || model.latestCompletedRace?.trackName || "",
    seasonName: model.seasonName,
    columnSizes: columns.map((c) => c.length),
    cutColumn: cutPlacement?.columnIndex ?? null,
    missingPlates,
    nearWhitePlates: whitePlates,
    sponsorLogo: false,
    sponsorText: SPONSOR_NAME,
    layoutFits: layout.fits,
    rowH: layout.rowH,
    footerH: layout.footerH,
    typography: TYPOGRAPHY,
  };
  console.log("[standings-graphic-export] PNG export", exportLog);
  if (unintendedWhitePlates.length === 0) {
    console.log("[Standings Plate Colors] no unintended plain-white plate fills");
  }

  if (!validateOutputDimensions(pngDims.width, pngDims.height)) {
    console.warn("[standings-graphic-export] Unexpected PNG dimensions", pngDims);
  }

  lastRenderDiagnostics = {
    ...exportLog,
    canvasMasterResolution: `${OUTPUT_WIDTH}×${OUTPUT_HEIGHT}`,
    downsample: "none — PNG encoded directly from 3840×2160 master",
    fonts: fontInfo,
    playoffCut: model.playoffCut ?? DEFAULT_PLAYOFF_CUT,
    cutPlacement,
    filename: model.filename,
    plateDiagnostics,
    model,
  };

  return {
    canvas,
    blob,
    width: pngDims.width || OUTPUT_WIDTH,
    height: pngDims.height || OUTPUT_HEIGHT,
    filename: model.filename,
    model,
    diagnostics: lastRenderDiagnostics,
    plateDiagnostics,
  };
}

export function downloadRenderResult(result) {
  if (!result?.blob) throw new Error("Nothing rendered to download.");
  downloadBlob(result.blob, result.filename || "BP-Standings.png");
  return result;
}

export async function downloadStandingsGraphic(options = {}) {
  if (options.renderResult?.blob) {
    return downloadRenderResult(options.renderResult);
  }

  let model = options.model || null;
  if (!model) {
    const { standingsData, scheduleData } =
      options.standingsData && options.scheduleData
        ? { standingsData: options.standingsData, scheduleData: options.scheduleData }
        : await fetchStandingsGraphicSources();
    model = buildStandingsGraphicModel(standingsData, scheduleData, options);
  }

  const result = await renderStandingsGraphicCanvas(model, options);
  downloadBlob(result.blob, result.filename);
  return result;
}

export {
  LOGICAL_WIDTH,
  LOGICAL_HEIGHT,
  RENDER_SCALE,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  MAX_DRIVERS,
  DEFAULT_PLAYOFF_CUT,
  SPONSOR_NAME,
  SITE_URL,
};

const api = {
  LOGICAL_WIDTH,
  LOGICAL_HEIGHT,
  RENDER_SCALE,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  MAX_DRIVERS,
  DEFAULT_PLAYOFF_CUT,
  SPONSOR_NAME,
  SITE_URL,
  buildExportPayload,
  buildStandingsGraphicModel,
  fetchStandingsGraphicSources,
  renderStandingsGraphicCanvas,
  downloadStandingsGraphic,
  downloadRenderResult,
  getLastDiagnostics: () => lastRenderDiagnostics,
};

if (typeof window !== "undefined") {
  window.BPStandingsGraphicExport = api;
}

export default api;
