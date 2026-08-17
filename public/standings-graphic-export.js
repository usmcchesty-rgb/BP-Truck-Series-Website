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
  buildSponsorFooterText,
  validateOutputDimensions,
  buildStandingsGraphicModel,
  computeStandingsLayoutMetrics,
  sanitizeTrackName,
} from "./standings-graphic-export-logic.js";

const BP_LOGO = "/assets/logos/New%20Clean%20Logo.png";
const FONT_DISPLAY = 'Impact, Haettenschweiler, "Arial Black", Arial, sans-serif';
const FONT_BODY = '"Arial Narrow", Arial, sans-serif';
const PR_SUIT_CACHE_KEY = "bp_pr_suit_colors_v4";

const imageAssetCache = new Map();
const suitColorCache = new Map();
let lastRenderDiagnostics = null;

  // Guard: module may load in non-browser test environments.
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

function drawFillText(ctx, { text, x, y, font, fill, align = "left", baseline = "middle" }) {
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

function hashFallbackSuitColors(name) {
  const raw = String(name || "driver");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  const hues = [0, 14, 28, 200, 220, 260, 300];
  const hue = hues[hash % hues.length];
  const fill = `hsl(${hue} 70% 38%)`;
  return { fill, outline: "#f2f2f2", keyline: "#0a0a0a", fallback: true };
}

function sampleSuitColorsFromPortrait(img) {
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const sampleW = 96;
  const sampleH = Math.max(56, Math.round(sampleW * (ih / iw)));
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

  const buckets = new Map();
  for (let y = Math.floor(sampleH * 0.35); y < sampleH; y += 2) {
    for (let x = Math.floor(sampleW * 0.2); x < sampleW * 0.8; x += 2) {
      const i = (y * sampleW + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 140) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 40) continue;
      if (max - min < 28 && max > 200) continue;
      const key = `${Math.round(r / 20) * 20},${Math.round(g / 20) * 20},${Math.round(b / 20) * 20}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }

  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return { error: "no_colors" };
  const [fr, fg, fb] = sorted[0][0].split(",").map(Number);
  const fill = `#${[fr, fg, fb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  let outline = "#ffffff";
  if (sorted[1]) {
    const [or, og, ob] = sorted[1][0].split(",").map(Number);
    outline = `#${[or, og, ob].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return {
    fill,
    outline,
    keyline: pickReadableNumberColor(fill) === "#ffffff" ? "#0a0a0a" : "#f5f5f5",
    fallback: false,
  };
}

async function resolvePlateColors(driver) {
  const photoUrl = stripUrlQuery(driver.photoUrl);
  const cacheKey = photoUrl
    ? `suit:${photoUrl}`
    : driver.driverId
      ? `suit:driver:${driver.driverId}`
      : "";

  if (cacheKey && suitColorCache.has(cacheKey)) {
    const cached = suitColorCache.get(cacheKey);
    return {
      fill: cached.fill || DEFAULT_PLATE.fill,
      outline: cached.outline || DEFAULT_PLATE.outline,
      keyline: cached.keyline || DEFAULT_PLATE.keyline,
      numberFill: pickReadableNumberColor(cached.fill || DEFAULT_PLATE.fill),
      source: "cache",
    };
  }

  if (photoUrl) {
    const img = await loadImage(photoUrl);
    if (img) {
      const sampled = sampleSuitColorsFromPortrait(img);
      if (!sampled.error) {
        const pack = {
          fill: sampled.fill,
          outline: sampled.outline,
          keyline: sampled.keyline,
        };
        if (cacheKey) suitColorCache.set(cacheKey, pack);
        return {
          ...pack,
          numberFill: pickReadableNumberColor(pack.fill),
          source: "sampled",
        };
      }
    }
  }

  const hashed = hashFallbackSuitColors(driver.driverName);
  return {
    fill: hashed.fill,
    outline: hashed.outline,
    keyline: hashed.keyline,
    numberFill: pickReadableNumberColor(hashed.fill),
    source: "fallback",
  };
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

  if (logoImg) {
    const logoH = 52;
    const scale = logoH / (logoImg.naturalHeight || 1);
    const logoW = Math.min(150, (logoImg.naturalWidth || 1) * scale);
    ctx.drawImage(logoImg, layout.padX, 10, logoW, logoH);
    drawFillText(ctx, {
      text: "TRUCK SERIES",
      x: layout.padX + logoW + 12,
      y: 36,
      font: `bold 20px ${FONT_DISPLAY}`,
      fill: "#ffffff",
      align: "left",
      baseline: "middle",
    });
  } else {
    drawFillText(ctx, {
      text: "BLAZING PEDALS",
      x: layout.padX,
      y: 24,
      font: `bold 15px ${FONT_BODY}`,
      fill: "#ff3a3a",
      align: "left",
      baseline: "middle",
    });
    drawFillText(ctx, {
      text: "TRUCK SERIES",
      x: layout.padX,
      y: 46,
      font: `bold 22px ${FONT_DISPLAY}`,
      fill: "#ffffff",
      align: "left",
      baseline: "middle",
    });
  }

  drawFillText(ctx, {
    text: formatSeasonHeading(seasonName),
    x: rightX,
    y: hasTrack ? 18 : 28,
    font: `bold 28px ${FONT_DISPLAY}`,
    fill: "#ffffff",
    align: "right",
    baseline: "middle",
  });

  drawFillText(ctx, {
    text: formatAfterRaceLine(raceNumber),
    x: rightX,
    y: hasTrack ? 42 : 54,
    font: `bold 15px ${FONT_BODY}`,
    fill: "#c8c8c8",
    align: "right",
    baseline: "middle",
  });

  let trackFit = { lines: [], fontSize: 12, truncated: false, fullTrackName: "" };
  if (hasTrack) {
    const maxWidth = 700;
    const measure = (font, text) => {
      ctx.save();
      ctx.font = font;
      const width = ctx.measureText(text).width;
      ctx.restore();
      return width;
    };
    trackFit = fitTrackNameDisplay(measure, trackName, maxWidth, {
      fontFamily: FONT_BODY,
      fontWeight: "bold",
      maxSize: 13,
      minSize: 10,
    });
    const lineStartY = trackFit.lines.length > 1 ? 60 : 64;
    trackFit.lines.forEach((line, index) => {
      drawFillText(ctx, {
        text: line,
        x: rightX,
        y: lineStartY + index * (trackFit.fontSize + 2),
        font: `bold ${trackFit.fontSize}px ${FONT_BODY}`,
        fill: "#b0b0b0",
        align: "right",
        baseline: "middle",
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

  const plateGrad = ctx.createLinearGradient(x, y, x, y + h);
  plateGrad.addColorStop(0, fill);
  plateGrad.addColorStop(1, fill);
  ctx.fillStyle = plateGrad;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();

  ctx.strokeStyle = keyline;
  ctx.lineWidth = 2;
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 3.5);
  ctx.stroke();

  ctx.strokeStyle = outline;
  ctx.lineWidth = 1.25;
  roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 2.5);
  ctx.stroke();

  const fontSize = plateNumberFontSize(display, {
    maxSize: Math.floor(h * 0.72),
    minSize: 11,
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
  const pad = 5;
  const plateW = layout.plateW;
  const plateH = layout.plateH;
  const posW = 34;
  const moveW = 40;
  const statsW = 150;

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
  const posSize = Number(driver.position) <= 10 ? 22 : 18;

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
  drawFillText(ctx, {
    text: movement.text,
    x: x + pad + posW + moveW / 2,
    y: cy,
    font: `bold 13px ${FONT_BODY}`,
    fill: moveColor,
    align: "center",
    baseline: "middle",
  });

  const plateX = x + pad + posW + moveW + 2;
  const plateY = y + (h - plateH) / 2;
  drawNumberPlate(ctx, driver.carNumber, plateColors, plateX, plateY, plateW, plateH);

  const nameX = plateX + plateW + 8;
  const nameMaxW = w - (nameX - x) - statsW - pad;
  const measure = (font, text) => {
    ctx.save();
    ctx.font = font;
    const width = ctx.measureText(text).width;
    ctx.restore();
    return width;
  };
  const nameSize = fitTextFontSize(measure, driver.driverName.toUpperCase(), nameMaxW, {
    fontFamily: FONT_BODY,
    fontWeight: style.nameWeight,
    maxSize: Number(driver.position) <= 10 ? 17 : 15,
    minSize: 10,
  });

  drawFillText(ctx, {
    text: driver.driverName.toUpperCase(),
    x: nameX,
    y: cy,
    font: `${style.nameWeight} ${nameSize}px ${FONT_BODY}`,
    fill: style.nameFill,
    align: "left",
    baseline: "middle",
  });

  const statsRight = x + w - pad;
  drawFillText(ctx, {
    text: formatWinsLabel(driver.wins),
    x: statsRight,
    y: cy,
    font: `bold 12px ${FONT_BODY}`,
    fill: "#b8b8b8",
    align: "right",
    baseline: "middle",
  });

  ctx.save();
  ctx.font = `bold 12px ${FONT_BODY}`;
  const winsW = ctx.measureText(formatWinsLabel(driver.wins)).width;
  ctx.restore();

  drawFillText(ctx, {
    text: formatPointsLabel(driver.points),
    x: statsRight - winsW - 12,
    y: cy,
    font: `bold 14px ${FONT_BODY}`,
    fill: "#ffffff",
    align: "right",
    baseline: "middle",
  });
}

function drawPlayoffCut(ctx, layout, placement, colX) {
  if (!placement) return;
  const { afterRowIndex, label } = placement;
  const cutRowBottom =
    layout.gridTop + (afterRowIndex + 1) * (layout.rowH + layout.rowGap) - layout.rowGap;
  const y = cutRowBottom + (layout.cutGap || 14) / 2;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#e01010";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(colX, y);
  ctx.lineTo(colX + layout.colW, y);
  ctx.stroke();

  const mid = colX + layout.colW / 2;
  const labelW = Math.min(layout.colW - 16, 200);
  ctx.fillStyle = "#140404";
  ctx.fillRect(mid - labelW / 2, y - 8, labelW, 16);
  ctx.strokeStyle = "#e01010";
  ctx.lineWidth = 1;
  ctx.strokeRect(mid - labelW / 2, y - 8, labelW, 16);
  ctx.restore();

  drawFillText(ctx, {
    text: label,
    x: mid,
    y,
    font: `bold 10px ${FONT_BODY}`,
    fill: "#ff6a6a",
    align: "center",
    baseline: "middle",
  });
}

function drawFooter(ctx, layout) {
  const y0 = layout.footerY;
  const footer = buildSponsorFooterText();

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#b80000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(layout.padX, y0);
  ctx.lineTo(LOGICAL_WIDTH - layout.padX, y0);
  ctx.stroke();
  ctx.restore();

  drawFillText(ctx, {
    text: footer.combined,
    x: LOGICAL_WIDTH / 2,
    y: y0 + 26,
    font: `bold 18px ${FONT_DISPLAY}`,
    fill: "#ffffff",
    align: "center",
    baseline: "middle",
  });

  drawFillText(ctx, {
    text: SITE_URL,
    x: LOGICAL_WIDTH - layout.padX,
    y: y0 + 44,
    font: `bold 12px ${FONT_BODY}`,
    fill: "#888888",
    align: "right",
    baseline: "middle",
  });

  drawFillText(ctx, {
    text: "BLAZING PEDALS TRUCK SERIES",
    x: layout.padX,
    y: y0 + 44,
    font: `bold 11px ${FONT_BODY}`,
    fill: "#666666",
    align: "left",
    baseline: "middle",
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

  // Batch plate colors from PR cache / already-known photo URLs (no per-driver API).
  const plateColorsList = await Promise.all(drivers.map((d) => resolvePlateColors(d)));

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
        y += layout.cutGap || 14;
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
    sponsorLogo: false,
    sponsorText: SPONSOR_NAME,
    layoutFits: layout.fits,
    rowH: layout.rowH,
  };
  console.log("[standings-graphic-export] PNG export", exportLog);

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
