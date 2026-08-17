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
  DEFAULT_SEASON_NAME,
  SPONSOR_NAME,
  SPONSOR_LOGO_CANDIDATES,
  SITE_URL,
  takeTopDrivers,
  distributeColumns,
  findPlayoffCutPlacement,
  formatWinsLabel,
  formatPointsLabel,
  formatSeasonHeading,
  formatAfterRaceLine,
  buildStandingsGraphicFilename,
  resolvePointsRaceNumberFromSchedule,
  resolvePlayoffCut,
  fitTextFontSize,
  plateNumberFontSize,
  buildSponsorFooterText,
  validateOutputDimensions,
} from "./standings-graphic-export-logic.js";

const BP_LOGO = "/assets/logos/New%20Clean%20Logo.png";
const FONT_DISPLAY = 'Impact, Haettenschweiler, "Arial Black", Arial, sans-serif';
const FONT_BODY = '"Arial Narrow", Arial, sans-serif';

const imageAssetCache = new Map();
let lastRenderDiagnostics = null;

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
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = key;
  });
  imageAssetCache.set(key, promise);
  return promise;
}

async function loadFirstAvailableImage(urls) {
  for (const url of urls) {
    const img = await loadImage(url);
    if (img) return { img, url };
  }
  return { img: null, url: null };
}

function drawCarbonBackground(ctx) {
  ctx.fillStyle = "#070707";
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.save();
  ctx.globalAlpha = 0.2;
  for (let y = -LOGICAL_HEIGHT; y < LOGICAL_HEIGHT * 2; y += 14) {
    ctx.strokeStyle = y % 28 === 0 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.025)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LOGICAL_WIDTH, y + LOGICAL_WIDTH * 0.5);
    ctx.stroke();
  }
  ctx.restore();

  const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
  grad.addColorStop(0, "rgba(36,36,36,0.5)");
  grad.addColorStop(0.4, "rgba(10,10,10,0.12)");
  grad.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.save();
  ctx.strokeStyle = "#9a0000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 78);
  ctx.lineTo(LOGICAL_WIDTH, 112);
  ctx.stroke();
  ctx.restore();
}

function computeLayout(driverCount, { reserveCutGap = false } = {}) {
  const padX = 28;
  const headerH = 108;
  const footerH = 86;
  const gridTop = headerH + 8;
  const gridBottom = LOGICAL_HEIGHT - footerH - 8;
  const colGap = 20;
  const colCount = 3;
  const colW = (LOGICAL_WIDTH - padX * 2 - colGap * (colCount - 1)) / colCount;
  const dummy = new Array(Math.min(driverCount, MAX_DRIVERS)).fill(null);
  const columns = distributeColumns(dummy);
  const maxRows = Math.max(1, ...columns.map((c) => c.length || 1));
  const rowGap = 3;
  const cutGap = reserveCutGap ? 16 : 0;
  const availableH = gridBottom - gridTop - cutGap;
  const rowH = Math.min(54, (availableH - rowGap * (maxRows - 1)) / maxRows);

  return {
    padX,
    headerH,
    footerH,
    footerY: LOGICAL_HEIGHT - footerH,
    gridTop,
    gridBottom,
    colGap,
    colW,
    colCount,
    rowH,
    rowGap,
    cutGap,
    maxRows,
  };
}

function drawHeader(ctx, meta, logoImg) {
  const { seasonName, pointsRaceNumber } = meta;

  if (logoImg) {
    const logoH = 70;
    const scale = logoH / (logoImg.naturalHeight || 1);
    const logoW = (logoImg.naturalWidth || 1) * scale;
    ctx.drawImage(logoImg, 28, 18, logoW, logoH);
  }

  drawFillText(ctx, {
    text: "BLAZING PEDALS",
    x: 210,
    y: 34,
    font: `bold 18px ${FONT_BODY}`,
    fill: "#ff3a3a",
    align: "left",
    baseline: "middle",
  });
  drawFillText(ctx, {
    text: "TRUCK SERIES",
    x: 210,
    y: 58,
    font: `bold 28px ${FONT_DISPLAY}`,
    fill: "#ffffff",
    align: "left",
    baseline: "middle",
  });

  drawFillText(ctx, {
    text: formatSeasonHeading(seasonName),
    x: LOGICAL_WIDTH - 28,
    y: 40,
    font: `bold 36px ${FONT_DISPLAY}`,
    fill: "#ffffff",
    align: "right",
    baseline: "middle",
  });
  drawFillText(ctx, {
    text: formatAfterRaceLine(pointsRaceNumber),
    x: LOGICAL_WIDTH - 28,
    y: 76,
    font: `bold 20px ${FONT_BODY}`,
    fill: "#c8c8c8",
    align: "right",
    baseline: "middle",
  });

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "rgba(255,48,48,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, 104);
  ctx.lineTo(LOGICAL_WIDTH - 28, 104);
  ctx.stroke();
  ctx.restore();
}

function drawNumberPlate(ctx, carNumber, x, y, w, h) {
  const display = String(carNumber || "—").trim() || "—";

  ctx.save();
  resetTextRenderingState(ctx);

  const plateGrad = ctx.createLinearGradient(x, y, x, y + h);
  plateGrad.addColorStop(0, "#2a2a2e");
  plateGrad.addColorStop(0.45, "#141416");
  plateGrad.addColorStop(1, "#0a0a0c");
  ctx.fillStyle = plateGrad;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();

  ctx.strokeStyle = "#d0d0d4";
  ctx.lineWidth = 1.5;
  roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 3.5);
  ctx.stroke();

  ctx.strokeStyle = "#c81010";
  ctx.lineWidth = 1;
  roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 2.5);
  ctx.stroke();

  const fontSize = plateNumberFontSize(display, { maxSize: Math.floor(h * 0.72), minSize: 11 });
  ctx.font = `bold ${fontSize}px ${FONT_DISPLAY}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(display, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
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

function rowStyle(position) {
  const pos = Number(position);
  if (pos === 1) {
    return {
      bg: "rgba(90,70,18,0.28)",
      border: "rgba(212,175,55,0.55)",
      posFill: "#f0d060",
      nameFill: "#fff8e0",
      nameWeight: "bold",
    };
  }
  if (pos >= 2 && pos <= 10) {
    return {
      bg: "rgba(40,40,40,0.55)",
      border: "rgba(180,40,40,0.45)",
      posFill: "#ffffff",
      nameFill: "#ffffff",
      nameWeight: "bold",
    };
  }
  return {
    bg: "rgba(22,22,22,0.48)",
    border: "rgba(70,70,70,0.55)",
    posFill: "#d0d0d0",
    nameFill: "#f0f0f0",
    nameWeight: "bold",
  };
}

function drawDriverRow(ctx, driver, box) {
  const { x, y, w, h } = box;
  const style = rowStyle(driver.position);
  const pad = 6;
  const plateW = 46;
  const plateH = Math.min(28, h - 10);
  const posW = 36;
  const statsW = 148;

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

  drawFillText(ctx, {
    text: String(driver.position),
    x: x + pad + posW / 2,
    y: cy,
    font: `bold ${Number(driver.position) <= 10 ? 22 : 18}px ${FONT_DISPLAY}`,
    fill: style.posFill,
    align: "center",
    baseline: "middle",
  });

  const plateX = x + pad + posW + 4;
  const plateY = y + (h - plateH) / 2;
  drawNumberPlate(ctx, driver.carNumber, plateX, plateY, plateW, plateH);

  const nameX = plateX + plateW + 10;
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
    maxSize: Number(driver.position) <= 10 ? 18 : 16,
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
    x: statsRight - winsW - 14,
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
  const y = cutRowBottom + (layout.cutGap || 16) / 2;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#e01010";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(colX, y);
  ctx.lineTo(colX + layout.colW, y);
  ctx.stroke();

  const mid = colX + layout.colW / 2;
  ctx.fillStyle = "#1a0505";
  const labelW = Math.min(layout.colW - 20, 220);
  ctx.fillRect(mid - labelW / 2, y - 9, labelW, 18);
  ctx.strokeStyle = "#e01010";
  ctx.lineWidth = 1;
  ctx.strokeRect(mid - labelW / 2, y - 9, labelW, 18);
  ctx.restore();

  drawFillText(ctx, {
    text: label,
    x: mid,
    y,
    font: `bold 11px ${FONT_BODY}`,
    fill: "#ff6a6a",
    align: "center",
    baseline: "middle",
  });
}

function drawFooter(ctx, layout, sponsorAsset) {
  const y0 = layout.footerY;
  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#b80000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(28, y0);
  ctx.lineTo(LOGICAL_WIDTH - 28, y0);
  ctx.stroke();
  ctx.restore();

  const footer = buildSponsorFooterText({ hasLogo: Boolean(sponsorAsset?.img) });

  drawFillText(ctx, {
    text: footer.presentedBy,
    x: LOGICAL_WIDTH / 2,
    y: y0 + 18,
    font: `bold 12px ${FONT_BODY}`,
    fill: "#aaaaaa",
    align: "center",
    baseline: "middle",
  });

  if (footer.useLogo && sponsorAsset?.img) {
    const maxH = 40;
    const maxW = 320;
    const iw = sponsorAsset.img.naturalWidth || 1;
    const ih = sponsorAsset.img.naturalHeight || 1;
    const scale = Math.min(maxW / iw, maxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(sponsorAsset.img, (LOGICAL_WIDTH - dw) / 2, y0 + 28, dw, dh);
  } else {
    drawFillText(ctx, {
      text: footer.sponsorLine || SPONSOR_NAME,
      x: LOGICAL_WIDTH / 2,
      y: y0 + 42,
      font: `bold 22px ${FONT_DISPLAY}`,
      fill: "#ffffff",
      align: "center",
      baseline: "middle",
    });
  }

  drawFillText(ctx, {
    text: SITE_URL,
    x: LOGICAL_WIDTH - 28,
    y: y0 + 58,
    font: `bold 13px ${FONT_BODY}`,
    fill: "#888888",
    align: "right",
    baseline: "middle",
  });

  drawFillText(ctx, {
    text: "BLAZING PEDALS TRUCK SERIES",
    x: 28,
    y: y0 + 58,
    font: `bold 12px ${FONT_BODY}`,
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

/**
 * Build export payload from authoritative /api/standings + /api/schedule responses.
 */
export function buildExportPayload(standingsData, scheduleData, options = {}) {
  const seasonName =
    options.seasonName ||
    standingsData?.settings?.seasonName ||
    DEFAULT_SEASON_NAME;
  const playoffCut = resolvePlayoffCut(
    options.playoffCut != null
      ? { playoffCut: options.playoffCut }
      : standingsData?.settings || {},
  );
  const pointsRaceNumber =
    options.pointsRaceNumber != null
      ? Number(options.pointsRaceNumber)
      : resolvePointsRaceNumberFromSchedule(scheduleData || {});

  const drivers = takeTopDrivers(standingsData?.rows || [], MAX_DRIVERS);
  const columns = distributeColumns(drivers);
  const cutPlacement = findPlayoffCutPlacement(drivers, playoffCut);

  return {
    seasonName,
    playoffCut,
    pointsRaceNumber,
    drivers,
    columns,
    cutPlacement,
    filename: buildStandingsGraphicFilename({ seasonName, pointsRaceNumber }),
  };
}

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

export async function renderStandingsGraphicCanvas(payload, options = {}) {
  const drivers = payload.drivers || [];
  if (!drivers.length) throw new Error("No standings drivers available to export.");

  const fontInfo = await ensureFontsReady();
  const [logoImg, sponsorAsset] = await Promise.all([
    loadImage(options.logoUrl || BP_LOGO),
    options.forceTextSponsor
      ? Promise.resolve({ img: null, url: null })
      : loadFirstAvailableImage(options.sponsorLogoUrls || SPONSOR_LOGO_CANDIDATES),
  ]);

  const columns = payload.columns || distributeColumns(drivers);
  const cutPlacement = payload.cutPlacement || null;
  const layout = computeLayout(drivers.length, { reserveCutGap: Boolean(cutPlacement) });

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.scale(RENDER_SCALE, RENDER_SCALE);
  resetTextRenderingState(ctx);

  drawCarbonBackground(ctx);
  drawHeader(
    ctx,
    {
      seasonName: payload.seasonName,
      pointsRaceNumber: payload.pointsRaceNumber,
    },
    logoImg,
  );

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
      drawDriverRow(ctx, driver, {
        x: colX,
        y,
        w: layout.colW,
        h: layout.rowH,
      });
    });

    if (cutPlacement && cutPlacement.columnIndex === col) {
      drawPlayoffCut(ctx, layout, cutPlacement, colX);
    }
  }

  drawFooter(ctx, layout, sponsorAsset);

  const blob = await canvasToPngBlob(canvas);
  const pngDims = await readPngDimensions(blob);
  const exportLog = {
    width: pngDims.width,
    height: pngDims.height,
    blobSize: blob.size,
    renderScale: RENDER_SCALE,
    downsampled: false,
    driverCount: drivers.length,
    pointsRaceNumber: payload.pointsRaceNumber,
    seasonName: payload.seasonName,
    sponsorLogo: sponsorAsset?.url || null,
    sponsorFallbackText: !sponsorAsset?.img,
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
    playoffCut: payload.playoffCut ?? DEFAULT_PLAYOFF_CUT,
    cutPlacement,
    filename: payload.filename,
  };

  return {
    canvas,
    blob,
    width: pngDims.width || OUTPUT_WIDTH,
    height: pngDims.height || OUTPUT_HEIGHT,
    filename: payload.filename,
    diagnostics: lastRenderDiagnostics,
  };
}

export async function downloadStandingsGraphic(options = {}) {
  const { standingsData, scheduleData } =
    options.standingsData && options.scheduleData
      ? { standingsData: options.standingsData, scheduleData: options.scheduleData }
      : await fetchStandingsGraphicSources();

  const payload = buildExportPayload(standingsData, scheduleData, options);
  const result = await renderStandingsGraphicCanvas(payload, options);
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
  SPONSOR_LOGO_CANDIDATES,
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
  SPONSOR_LOGO_CANDIDATES,
  SITE_URL,
  buildExportPayload,
  fetchStandingsGraphicSources,
  renderStandingsGraphicCanvas,
  downloadStandingsGraphic,
  getLastDiagnostics: () => lastRenderDiagnostics,
};

if (typeof window !== "undefined") {
  window.BPStandingsGraphicExport = api;
}

export default api;
