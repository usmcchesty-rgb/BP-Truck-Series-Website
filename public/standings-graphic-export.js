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
  formatChampionshipStatDisplays,
  buildDriverChampionshipStat,
  computeStandingsStatGeometry,
  computeStatColumnHeaderGeometry,
  formatSeasonHeading,
  formatAfterRaceLine,
  fitTextFontSize,
  fitDriverName,
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
  computeRowSlotGeometry,
  computeMovementGlyphGeometry,
  computePlayoffCutLine,
  computePlayoffBattleBox,
  standingsRowY,
  standingsRowVisualStyle,
  sanitizeTrackName,
  measureTrackedTextWidth,
} from "./standings-graphic-export-logic.js";
import {
  computeContainDest,
  hasUsableNumberArtwork,
  NUMBER_ARTWORK_CANVAS_HEIGHT,
  NUMBER_ARTWORK_CANVAS_WIDTH,
} from "./number-artwork-logic.js";

const BP_LOGO = "/assets/logos/New%20Clean%20Logo.png";
const FONT_DISPLAY = 'Impact, Haettenschweiler, "Arial Black", Arial, sans-serif';
const FONT_BODY = "Arial, Helvetica, sans-serif";
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

function displayFont(size) {
  return `${size}px ${FONT_DISPLAY}`;
}

function bodyFont(size, weight = "bold") {
  return `${weight} ${size}px ${FONT_BODY}`;
}

function resetTextRenderingState(ctx) {
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.shadowBlur = 0;
  ctx.shadowColor = "rgba(0,0,0,0)";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  if (typeof ctx.letterSpacing !== "undefined") ctx.letterSpacing = "0px";
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
function drawFillText(ctx, { text, x, y, font, fill, align = "left", baseline = "middle", tracking = 0 }) {
  const value = String(text || "");
  ctx.save();
  resetTextRenderingState(ctx);
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textBaseline = baseline;

  if (tracking && typeof ctx.letterSpacing !== "undefined") {
    ctx.letterSpacing = `${Number(tracking)}px`;
    ctx.textAlign = align;
    ctx.fillText(value, Math.round(x), Math.round(y));
    ctx.restore();
    return;
  }

  if (tracking) {
    ctx.textAlign = "left";
    const total = measureTrackedTextWidth(
      (f, ch) => measureCtxChar(ctx, f, ch),
      font,
      value,
      tracking,
    );
    let cursor = x;
    if (align === "center") cursor = x - total / 2;
    else if (align === "right") cursor = x - total;
    Array.from(value).forEach((ch, index) => {
      ctx.fillText(ch, Math.round(cursor), Math.round(y));
      cursor += measureCtxChar(ctx, font, ch);
      if (index < value.length - 1) cursor += tracking;
    });
    ctx.restore();
    return total;
  }

  ctx.textAlign = align;
  ctx.fillText(value, Math.round(x), Math.round(y));
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
  const ruleY = layout.ruleY ?? layout.headerH - 6;

  if (logoImg) {
    const logoH = 56;
    const scale = logoH / (logoImg.naturalHeight || 1);
    const logoW = Math.min(160, (logoImg.naturalWidth || 1) * scale);
    ctx.drawImage(logoImg, layout.padX, 8, logoW, logoH);
    drawFillText(ctx, {
      text: "TRUCK SERIES",
      x: layout.padX + logoW + 12,
      y: 36,
      font: displayFont(22),
      fill: "#ffffff",
      align: "left",
      baseline: "middle",
      tracking: 0.8,
    });
  } else {
    drawFillText(ctx, {
      text: "BLAZING PEDALS",
      x: layout.padX,
      y: 22,
      font: bodyFont(16),
      fill: "#ff3030",
      align: "left",
      baseline: "middle",
      tracking: 1.0,
    });
    drawFillText(ctx, {
      text: "TRUCK SERIES",
      x: layout.padX,
      y: 46,
      font: displayFont(24),
      fill: "#ffffff",
      align: "left",
      baseline: "middle",
      tracking: 0.8,
    });
  }

  drawFillText(ctx, {
    text: formatSeasonHeading(seasonName),
    x: rightX,
    y: hasTrack ? ruleY - 70 : ruleY - 46,
    font: displayFont(T.seasonMax),
    fill: "#ffffff",
    align: "right",
    baseline: "middle",
    tracking: T.tracking.season,
  });

  drawFillText(ctx, {
    text: formatAfterRaceLine(raceNumber),
    x: rightX,
    y: hasTrack ? ruleY - 44 : ruleY - 20,
    font: bodyFont(T.afterRace),
    fill: "#f2f2f2",
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
    const lineStartY = trackFit.lines.length > 1 ? ruleY - 40 : ruleY - 22;
    trackFit.lines.forEach((line, index) => {
      drawFillText(ctx, {
        text: line,
        x: rightX,
        y: lineStartY + index * (trackFit.fontSize + 3),
        font: bodyFont(trackFit.fontSize),
        fill: "#e8e8e8",
        align: "right",
        baseline: "middle",
        tracking: T.tracking.track,
      });
    });
  }

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#e50914";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.round(layout.padX), Math.round(ruleY));
  ctx.lineTo(Math.round(LOGICAL_WIDTH - layout.padX), Math.round(ruleY));
  ctx.stroke();
  ctx.restore();

  return trackFit;
}

function drawNumberArtwork(ctx, img, x, y, w, h) {
  if (!img) return false;
  const dest = computeContainDest(
    img.naturalWidth || NUMBER_ARTWORK_CANVAS_WIDTH,
    img.naturalHeight || NUMBER_ARTWORK_CANVAS_HEIGHT,
    x,
    y,
    w,
    h,
  );
  ctx.save();
  resetTextRenderingState(ctx);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, dest.x, dest.y, dest.width, dest.height);
  ctx.restore();
  return true;
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
  ctx.font = displayFont(fontSize);
  ctx.fillStyle = numberFill;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(display, Math.round(x + w / 2), Math.round(y + h / 2));
  ctx.restore();
}

function rowStyle(position) {
  return standingsRowVisualStyle(position);
}

function drawDriverRow(ctx, driver, box, plateColors, layout, numberImg = null) {
  const { x, y, w, h } = box;
  const style = rowStyle(driver.position);
  const pad = layout.rowPad ?? 6;
  const T = TYPOGRAPHY;
  const slots = computeRowSlotGeometry(layout);
  const plateW = layout.plateW;
  const plateH = layout.plateH;
  const posW = layout.posW;
  const moveW = layout.moveW;
  const borderWidth = style.borderWidth || 1;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.fillStyle = style.bg;
  roundRect(ctx, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 4);
  ctx.fill();
  ctx.strokeStyle = style.border;
  ctx.lineWidth = borderWidth;
  roundRect(ctx, Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1, 4);
  ctx.stroke();
  ctx.restore();

  const cy = Math.round(y + h / 2);
  const posSize =
    Number(driver.position) <= 10 ? T.positionTop10 : T.positionRest;

  drawFillText(ctx, {
    text: String(driver.position),
    x: x + pad + posW / 2,
    y: cy,
    font: displayFont(posSize),
    fill: style.posFill,
    align: "center",
    baseline: "middle",
  });

  drawMovementIndicator(ctx, driver.movement, x + slots.move.x, cy, moveW, T);

  const plateX = x + slots.number.x;
  const plateY = Math.round(y + (h - plateH) / 2);
  const usedArtwork = hasUsableNumberArtwork(driver.numberArtwork) && numberImg
    ? drawNumberArtwork(ctx, numberImg, plateX, plateY, plateW, plateH)
    : false;
  if (!usedArtwork) {
    drawNumberPlate(ctx, driver.carNumber, plateColors, plateX, plateY, plateW, plateH);
  }

  const nameX = x + slots.name.x;
  const nameMaxW = slots.name.w;
  const nameMax =
    Number(driver.position) <= 10 ? T.driverNameTop10 : T.driverNameRest;
  const measure = (font, text) => measureCtxText(ctx, font, text);
  const fitted = fitDriverName(measure, driver.driverName.toUpperCase(), nameMaxW, {
    fontFamily: FONT_BODY,
    fontWeight: style.nameWeight,
    maxSize: nameMax,
    preferredMin: T.driverNamePreferredMin,
    minSize: T.driverNameMin,
    tracking: T.tracking.driverName,
    trackingMin: T.tracking.driverNameMin,
  });

  drawFillText(ctx, {
    text: driver.driverName.toUpperCase(),
    x: nameX,
    y: cy,
    font: bodyFont(fitted.size, style.nameWeight),
    fill: style.nameFill,
    align: "left",
    baseline: "middle",
    tracking: fitted.tracking,
  });

  drawChampionshipStats(ctx, driver, x, cy, layout, T);
}

function championshipStatFills(display) {
  const label = "#b8b8b8";
  if (display.tone === "positive") return { value: "#8fd4a4", label };
  if (display.tone === "negative") return { value: "#e88989", label };
  if (display.tone === "cut") return { value: "#ffffff", label };
  return { value: "#ffffff", label };
}

function drawStatRegion(ctx, display, region, cy, T) {
  const fills = championshipStatFills(display);
  const size = display.special
    ? (T.statSpecial || 17)
    : (T.statValue || T.points || 17);
  drawFillText(ctx, {
    text: display.valueText,
    x: region.valueRight,
    y: cy,
    font: bodyFont(size, "bold"),
    fill: fills.value,
    align: "right",
    baseline: "middle",
  });
}

function drawStatColumnHeader(ctx, colX, layout) {
  const geo = computeStatColumnHeaderGeometry(layout);
  const T = TYPOGRAPHY;

  geo.labels.forEach((item) => {
    drawFillText(ctx, {
      text: item.text,
      x: colX + item.headerCenterX,
      y: geo.y,
      font: bodyFont(T.statHeader || 16, "bold"),
      fill: "#d8d8d8",
      align: "center",
      baseline: "middle",
      tracking: T.tracking.statHeader || 0.55,
    });
  });

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  geo.separators.forEach((sep) => {
    const x = Math.round(colX + sep.x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, Math.round(geo.y - 9));
    ctx.lineTo(x, Math.round(geo.y + 9));
    ctx.stroke();
  });
  ctx.restore();
}

function drawChampionshipStats(ctx, driver, rowX, cy, layout, T) {
  const geo = computeStandingsStatGeometry(layout);
  const stat = driver.championshipStat || buildDriverChampionshipStat(driver);
  const displays = formatChampionshipStatDisplays(stat);

  drawStatRegion(ctx, displays.points, {
    ...geo.points,
    valueRight: rowX + geo.points.valueRight,
    colRight: rowX + geo.points.colRight,
  }, cy, T);
  drawStatRegion(ctx, displays.lead, {
    ...geo.lead,
    valueRight: rowX + geo.lead.valueRight,
    colRight: rowX + geo.lead.colRight,
  }, cy, T);
  drawStatRegion(ctx, displays.cut, {
    ...geo.cut,
    valueRight: rowX + geo.cut.valueRight,
    colRight: rowX + geo.cut.colRight,
  }, cy, T);
}

function drawMovementIndicator(ctx, movement, slotX, cy, slotW, T) {
  const data = movement || { text: "—", dir: "flat", arrow: "—", valueLabel: "" };
  const fill =
    data.dir === "up" ? "#2fd36a" : data.dir === "down" ? "#ff3b3b" : "#d0d0d0";
  const geo = computeMovementGlyphGeometry(slotW, T);

  if (data.dir === "flat" || !data.valueLabel) {
    drawFillText(ctx, {
      text: data.arrow || "—",
      x: slotX + geo.dashX,
      y: cy,
      font: displayFont(T.movement),
      fill,
      align: "center",
      baseline: "middle",
    });
    return;
  }

  drawFillText(ctx, {
    text: data.arrow,
    x: slotX + geo.arrowX,
    y: cy,
    font: displayFont(T.movementArrow),
    fill,
    align: "center",
    baseline: "middle",
  });
  drawFillText(ctx, {
    text: data.valueLabel,
    x: slotX + geo.valueX,
    y: cy,
    font: displayFont(T.movement),
    fill,
    align: "center",
    baseline: "middle",
  });
}

function drawPlayoffBattleBox(ctx, layout, placement, colX) {
  const box = computePlayoffBattleBox(layout, placement);
  if (!box) return;
  const x = Math.round(colX);
  const y = Math.round(box.y);
  const w = Math.round(box.width);
  const h = Math.round(box.height);
  const t = box.thickness;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.fillStyle = box.color;
  ctx.fillRect(x, y, w, t);
  ctx.fillRect(x, y + h - t, w, t);
  ctx.fillRect(x, y, t, h);
  ctx.fillRect(x + w - t, y, t, h);
  ctx.restore();
}

function drawPlayoffCutLine(ctx, layout, placement, colX) {
  const line = computePlayoffCutLine(layout, placement);
  if (!line) return;
  const x = Math.round(colX + line.inset);
  const y = Math.round(line.y);
  const w = Math.round(line.width);
  const h = line.thickness;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.fillStyle = line.color;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawFooter(ctx, layout) {
  const y0 = layout.footerY;
  const footer = buildSponsorFooterText();
  const T = TYPOGRAPHY;
  const midY = y0 + layout.footerH / 2;

  ctx.save();
  resetTextRenderingState(ctx);
  ctx.strokeStyle = "#e50914";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.round(layout.padX), Math.round(y0));
  ctx.lineTo(Math.round(LOGICAL_WIDTH - layout.padX), Math.round(y0));
  ctx.stroke();
  ctx.restore();

  // LEFT — series
  drawFillText(ctx, {
    text: "BLAZING PEDALS TRUCK SERIES",
    x: layout.padX,
    y: midY,
    font: bodyFont(T.footerSeries),
    fill: "#f0f0f0",
    align: "left",
    baseline: "middle",
    tracking: T.tracking.series,
  });

  // CENTER — presenting sponsor (two-line hierarchy)
  drawFillText(ctx, {
    text: footer.presentedBy,
    x: LOGICAL_WIDTH / 2,
    y: midY - 16,
    font: bodyFont(T.footerPresentedBy),
    fill: "#e8e8e8",
    align: "center",
    baseline: "middle",
    tracking: T.tracking.presentedBy,
  });
  drawFillText(ctx, {
    text: footer.sponsorLine,
    x: LOGICAL_WIDTH / 2,
    y: midY + 12,
    font: displayFont(T.footerSponsor),
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
    font: bodyFont(T.footerSite),
    fill: "#f2f2f2",
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
    document.fonts.load(`42px Impact`).catch(() => null),
    document.fonts.load(`bold 20px Arial`).catch(() => null),
    document.fonts.load(`bold 22px Arial`).catch(() => null),
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

  // Authoritative number PNGs when available; plate colors only for fallback rows.
  const numberImages = await Promise.all(
    drivers.map(async (driver) => {
      if (!hasUsableNumberArtwork(driver.numberArtwork)) return null;
      const url = driver.numberArtwork.imageUrl || driver.numberArtwork.imagePath;
      const img = await loadImage(url);
      return img || null;
    }),
  );
  const plateColorsList = await Promise.all(
    drivers.map((driver, index) => {
      if (numberImages[index]) {
        return Promise.resolve({
          ...DEFAULT_PLATE,
          source: "number_artwork",
          colorSource: driver.numberArtwork?.source || "sdk",
          skipped: true,
        });
      }
      return resolvePlateColors(driver);
    }),
  );
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
      numberArtworkSource: driver.numberArtwork?.source || "fallback",
      numberArtworkPath: driver.numberArtwork?.imagePath || "",
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
  });
  layout.footerY = LOGICAL_HEIGHT - layout.footerH;

  if (!layout.fits) {
    console.warn("[standings-graphic-export] Layout tight for 42-driver board", layout);
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
    drawStatColumnHeader(ctx, colX, layout);

    colDrivers.forEach((driver, rowIndex) => {
      const y = Math.round(standingsRowY(layout, rowIndex));
      const plateColors = plateColorsList[driverColorIndex] || DEFAULT_PLATE;
      const numberImg = numberImages[driverColorIndex] || null;
      driverColorIndex += 1;
      drawDriverRow(
        ctx,
        driver,
        { x: colX, y, w: layout.colW, h: layout.rowH },
        plateColors,
        layout,
        numberImg,
      );
    });
  }

  if (cutPlacement) {
    const cutColX = layout.padX + cutPlacement.columnIndex * (layout.colW + layout.colGap);
    drawPlayoffBattleBox(ctx, layout, cutPlacement, cutColX);
    drawPlayoffCutLine(ctx, layout, cutPlacement, cutColX);
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
    numberArtworkUsed: numberImages.filter(Boolean).length,
    numberArtworkFallback: drivers.length - numberImages.filter(Boolean).length,
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
