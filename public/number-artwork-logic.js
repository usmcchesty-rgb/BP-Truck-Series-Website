/**
 * Shared number-artwork contract for Standings Graphic + Power Rankings.
 * Source of truth: data/drivers.json iracingDesign.numberImage
 *   { sdkPath, customPath, preferredSource, source, authoritative }
 *
 * Display/normalization matches Car Image Manager:
 *   640×320 transparent canvas, 600×280 inner, 20px pad, alpha threshold 24,
 *   contain-scale, aspect preserved, centered.
 */

export const NUMBER_ARTWORK_CANVAS_WIDTH = 640;
export const NUMBER_ARTWORK_CANVAS_HEIGHT = 320;
export const NUMBER_ARTWORK_INNER_WIDTH = 600;
export const NUMBER_ARTWORK_INNER_HEIGHT = 280;
export const NUMBER_ARTWORK_PADDING = 20;
export const NUMBER_ARTWORK_ALPHA_THRESHOLD = 24;
export const NUMBER_ARTWORK_BG_TOLERANCE = 42;

export const NUMBER_ARTWORK_SOURCE = {
  CUSTOM: "custom",
  SDK: "sdk",
  FALLBACK: "fallback",
};

/** Standings row number box (logical px). 2:1 matches 640×320. */
export const STANDINGS_NUMBER_BOX = { width: 80, height: 40 };
/** Power Rankings card number box (logical 1920×1080 px). */
export const POWER_RANKINGS_CARD_NUMBER_BOX = { width: 176, height: 88 };
export const POWER_RANKINGS_HONORABLE_NUMBER_BOX = { width: 80, height: 40 };

export function normalizeCustomerId(value) {
  return String(value ?? "").trim().replace(/\D/g, "");
}

export function stripUrlQuery(url) {
  return String(url || "")
    .trim()
    .split("?")[0]
    .split("#")[0];
}

function nonemptyPath(value) {
  const path = stripUrlQuery(value);
  return path || "";
}

function readNumberImage(driver = {}) {
  const fromField = driver.numberImage || driver.number_image || null;
  const fromDesign = driver.iracingDesign?.numberImage || driver.iracing_design?.numberImage || null;
  const fromResolved = driver.numberArtwork || driver.number_artwork || null;
  return fromField || fromDesign || fromResolved || {};
}

/**
 * Decide which number artwork a driver should use.
 * Priority: custom → SDK → fallback. Never invent an SDK path.
 */
export function resolveNumberArtwork(driver = {}, catalogEntry = null) {
  const merged = {
    ...catalogEntry,
    ...driver,
    iracingDesign: driver.iracingDesign || catalogEntry?.iracingDesign || null,
    numberImage: driver.numberImage || catalogEntry?.numberImage || catalogEntry?.iracingDesign?.numberImage || null,
    numberArtwork: driver.numberArtwork || catalogEntry?.numberArtwork || null,
  };

  const numberImage = readNumberImage(merged);
  const customerId =
    normalizeCustomerId(
      merged.iracingCustomerId ||
        merged.iracing_customer_id ||
        numberImage.customerId ||
        catalogEntry?.iracingCustomerId ||
        catalogEntry?.iracing_customer_id,
    ) || "";
  const carNumber = String(
    merged.carNumber || merged.car_number || merged.bp_number || catalogEntry?.carNumber || "",
  ).trim();

  const preferred = String(numberImage.preferredSource || numberImage.preferred_source || "")
    .trim()
    .toLowerCase();
  const customPath = nonemptyPath(numberImage.customPath || numberImage.custom_path);
  const sdkPath = nonemptyPath(numberImage.sdkPath || numberImage.sdk_path);

  const base = { customerId, carNumber, sdkPath, customPath };

  if (customPath && preferred !== NUMBER_ARTWORK_SOURCE.SDK) {
    return {
      ...base,
      source: NUMBER_ARTWORK_SOURCE.CUSTOM,
      imagePath: customPath,
      authoritative: true,
    };
  }
  if (sdkPath) {
    return {
      ...base,
      source: NUMBER_ARTWORK_SOURCE.SDK,
      imagePath: sdkPath,
      authoritative: Boolean(numberImage.authoritative !== false),
    };
  }
  if (customPath) {
    return {
      ...base,
      source: NUMBER_ARTWORK_SOURCE.CUSTOM,
      imagePath: customPath,
      authoritative: true,
    };
  }

  return {
    ...base,
    source: NUMBER_ARTWORK_SOURCE.FALLBACK,
    imagePath: "",
    authoritative: false,
  };
}

export function hasUsableNumberArtwork(resolved) {
  return Boolean(
    resolved &&
      resolved.imagePath &&
      resolved.source !== NUMBER_ARTWORK_SOURCE.FALLBACK,
  );
}

/**
 * Contain-fit a 640×320 (or any) source into a target box. Never stretches.
 */
export function computeContainDest(srcW, srcH, boxX, boxY, boxW, boxH) {
  const sw = Math.max(1, Number(srcW) || 1);
  const sh = Math.max(1, Number(srcH) || 1);
  const bw = Math.max(1, Number(boxW) || 1);
  const bh = Math.max(1, Number(boxH) || 1);
  const scale = Math.min(bw / sw, bh / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  return {
    x: boxX + (bw - dw) / 2,
    y: boxY + (bh - dh) / 2,
    width: dw,
    height: dh,
    scale,
  };
}

export function computeNumberDisplayBox(kind = "standings", rowHeight = 40) {
  if (kind === "power-rankings-honorable") {
    return { ...POWER_RANKINGS_HONORABLE_NUMBER_BOX };
  }
  if (kind === "power-rankings") {
    return { ...POWER_RANKINGS_CARD_NUMBER_BOX };
  }
  const height = Math.max(32, Math.min(STANDINGS_NUMBER_BOX.height, Number(rowHeight) - 8 || STANDINGS_NUMBER_BOX.height));
  const width = Math.round(height * (NUMBER_ARTWORK_CANVAS_WIDTH / NUMBER_ARTWORK_CANVAS_HEIGHT));
  return { width, height };
}

function pixelIndex(x, y, width) {
  return (y * width + x) * 4;
}

export function findVisibleBounds(data, width, height, alphaThreshold = NUMBER_ARTWORK_ALPHA_THRESHOLD) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const a = data[pixelIndex(x, y, w) + 3];
      if (a >= alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return null;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function sampleCornerAverage(data, width, height) {
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  corners.forEach(([x, y]) => {
    const i = pixelIndex(x, y, width);
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  });
  return {
    r: Math.round(r / 4),
    g: Math.round(g / 4),
    b: Math.round(b / 4),
  };
}

function colorClose(r, g, b, bg, tolerance) {
  return (
    Math.abs(r - bg.r) <= tolerance &&
    Math.abs(g - bg.g) <= tolerance &&
    Math.abs(b - bg.b) <= tolerance
  );
}

/**
 * Edge-connected flood-fill background removal.
 * Does not globally delete white/black interiors of the number.
 */
export function removeConnectedBackground(data, width, height, options = {}) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const out = data instanceof Uint8ClampedArray ? new Uint8ClampedArray(data) : new Uint8Array(data);
  const mode = String(options.mode || "auto").toLowerCase();
  const tolerance = Number(options.tolerance ?? NUMBER_ARTWORK_BG_TOLERANCE);

  if (mode === "transparent" || mode === "none") {
    return { data: out, background: null, removed: 0 };
  }

  let background;
  if (mode === "white") background = { r: 255, g: 255, b: 255 };
  else if (mode === "black") background = { r: 0, g: 0, b: 0 };
  else if (options.background && Number.isFinite(options.background.r)) background = options.background;
  else background = sampleCornerAverage(out, w, h);

  const seen = new Uint8Array(w * h);
  const stack = [];

  const maybePush = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (seen[idx]) return;
    const i = idx * 4;
    if (out[i + 3] < NUMBER_ARTWORK_ALPHA_THRESHOLD) {
      seen[idx] = 1;
      return;
    }
    if (!colorClose(out[i], out[i + 1], out[i + 2], background, tolerance)) return;
    seen[idx] = 1;
    stack.push(idx);
  };

  for (let x = 0; x < w; x += 1) {
    maybePush(x, 0);
    maybePush(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    maybePush(0, y);
    maybePush(w - 1, y);
  }

  let removed = 0;
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % w;
    const y = (idx / w) | 0;
    const i = idx * 4;
    out[i + 3] = 0;
    removed += 1;
    maybePush(x + 1, y);
    maybePush(x - 1, y);
    maybePush(x, y + 1);
    maybePush(x, y - 1);
  }

  return { data: out, background, removed };
}

function blitContain(src, srcW, srcH, srcX, srcY, cropW, cropH, destW, destH) {
  const dest = new Uint8ClampedArray(destW * destH * 4);
  const scale = Math.min(destW / cropW, destH / cropH);
  const dw = cropW * scale;
  const dh = cropH * scale;
  const ox = (destW - dw) / 2;
  const oy = (destH - dh) / 2;

  for (let y = 0; y < destH; y += 1) {
    for (let x = 0; x < destW; x += 1) {
      const sx = (x - ox) / scale;
      const sy = (y - oy) / scale;
      if (sx < 0 || sy < 0 || sx >= cropW || sy >= cropH) continue;
      const srcPx = Math.min(cropW - 1, Math.max(0, Math.floor(sx)));
      const srcPy = Math.min(cropH - 1, Math.max(0, Math.floor(sy)));
      const si = pixelIndex(srcX + srcPx, srcY + srcPy, srcW);
      const di = pixelIndex(x, y, destW);
      dest[di] = src[si];
      dest[di + 1] = src[si + 1];
      dest[di + 2] = src[si + 2];
      dest[di + 3] = src[si + 3];
    }
  }
  return dest;
}

/**
 * Normalize raw RGBA into the 640×320 Car Image Manager canvas.
 */
export function normalizeNumberArtworkPixels(data, width, height, options = {}) {
  const w = Number(width);
  const h = Number(height);
  if (!data || !w || !h) {
    throw new Error("Image data is required.");
  }

  const removed = removeConnectedBackground(data, w, h, options);
  const bounds = findVisibleBounds(removed.data, w, h, NUMBER_ARTWORK_ALPHA_THRESHOLD);
  if (!bounds) {
    throw new Error("No visible number artwork was detected after background processing.");
  }

  const pad = NUMBER_ARTWORK_PADDING;
  const cropX = Math.max(0, bounds.x - pad);
  const cropY = Math.max(0, bounds.y - pad);
  const cropW = Math.min(w - cropX, bounds.width + (bounds.x - cropX) + pad);
  const cropH = Math.min(h - cropY, bounds.height + (bounds.y - cropY) + pad);

  const inner = blitContain(
    removed.data,
    w,
    h,
    cropX,
    cropY,
    cropW,
    cropH,
    NUMBER_ARTWORK_INNER_WIDTH,
    NUMBER_ARTWORK_INNER_HEIGHT,
  );

  const canvas = new Uint8ClampedArray(NUMBER_ARTWORK_CANVAS_WIDTH * NUMBER_ARTWORK_CANVAS_HEIGHT * 4);
  const offsetX = NUMBER_ARTWORK_PADDING;
  const offsetY = NUMBER_ARTWORK_PADDING;
  for (let y = 0; y < NUMBER_ARTWORK_INNER_HEIGHT; y += 1) {
    for (let x = 0; x < NUMBER_ARTWORK_INNER_WIDTH; x += 1) {
      const si = pixelIndex(x, y, NUMBER_ARTWORK_INNER_WIDTH);
      const di = pixelIndex(x + offsetX, y + offsetY, NUMBER_ARTWORK_CANVAS_WIDTH);
      canvas[di] = inner[si];
      canvas[di + 1] = inner[si + 1];
      canvas[di + 2] = inner[si + 2];
      canvas[di + 3] = inner[si + 3];
    }
  }

  const resultBounds = findVisibleBounds(
    canvas,
    NUMBER_ARTWORK_CANVAS_WIDTH,
    NUMBER_ARTWORK_CANVAS_HEIGHT,
    NUMBER_ARTWORK_ALPHA_THRESHOLD,
  );

  return {
    data: canvas,
    width: NUMBER_ARTWORK_CANVAS_WIDTH,
    height: NUMBER_ARTWORK_CANVAS_HEIGHT,
    original: { width: w, height: h },
    detectedBounds: bounds,
    paddedCrop: { x: cropX, y: cropY, width: cropW, height: cropH },
    resultBounds,
    background: removed.background,
    removedCount: removed.removed,
  };
}

export function indexNumberArtworkCatalog(driversJson) {
  const list = Array.isArray(driversJson?.drivers) ? driversJson.drivers : Array.isArray(driversJson) ? driversJson : [];
  const byCustomerId = new Map();
  const byName = new Map();
  const bySlug = new Map();

  list.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const customerId = normalizeCustomerId(entry.iracingCustomerId || entry.iracing_customer_id);
    const name = String(entry.iracingName || entry.name || entry.display_name || "")
      .trim()
      .toLowerCase();
    const slug = String(entry.slug || "").trim().toLowerCase();
    if (customerId) byCustomerId.set(customerId, entry);
    if (name) byName.set(name, entry);
    if (slug) bySlug.set(slug, entry);
  });

  return { list, byCustomerId, byName, bySlug };
}

export function findCatalogEntry(catalog, driver = {}) {
  if (!catalog) return null;
  const customerId = normalizeCustomerId(
    driver.iracingCustomerId || driver.iracing_customer_id || driver.customerId,
  );
  if (customerId && catalog.byCustomerId.has(customerId)) {
    return catalog.byCustomerId.get(customerId);
  }
  const name = String(driver.driverName || driver.driver || driver.display_name || driver.iracing_name || driver.name || "")
    .trim()
    .toLowerCase();
  if (name && catalog.byName.has(name)) return catalog.byName.get(name);
  const slug = String(driver.slug || "").trim().toLowerCase();
  if (slug && catalog.bySlug.has(slug)) return catalog.bySlug.get(slug);
  return null;
}

export function applyCustomOverrideToNumberImage(numberImage = {}, override = null) {
  if (!override) return numberImage || {};
  return {
    ...numberImage,
    customPath: override.customPath || override.custom_path || numberImage.customPath || null,
    preferredSource: override.preferredSource || override.preferred_source || numberImage.preferredSource,
    source: override.source || numberImage.source,
  };
}

export function resolveNumberArtworkForDriver(driver = {}, catalog = null, overrides = {}) {
  const entry = findCatalogEntry(catalog, driver);
  const customerId = normalizeCustomerId(
    driver.iracingCustomerId ||
      driver.iracing_customer_id ||
      entry?.iracingCustomerId ||
      entry?.iracing_customer_id,
  );
  const override = customerId ? overrides[customerId] || overrides[String(customerId)] : null;
  const numberImage = applyCustomOverrideToNumberImage(
    driver.numberImage || entry?.iracingDesign?.numberImage || {},
    override,
  );
  return resolveNumberArtwork(
    {
      ...driver,
      iracingCustomerId: customerId,
      numberImage,
      iracingDesign: {
        ...(entry?.iracingDesign || {}),
        ...(driver.iracingDesign || {}),
        numberImage,
      },
    },
    entry,
  );
}

if (typeof window !== "undefined") {
  window.BPNumberArtwork = {
    NUMBER_ARTWORK_CANVAS_WIDTH,
    NUMBER_ARTWORK_CANVAS_HEIGHT,
    NUMBER_ARTWORK_INNER_WIDTH,
    NUMBER_ARTWORK_INNER_HEIGHT,
    NUMBER_ARTWORK_PADDING,
    NUMBER_ARTWORK_ALPHA_THRESHOLD,
    NUMBER_ARTWORK_SOURCE,
    STANDINGS_NUMBER_BOX,
    POWER_RANKINGS_CARD_NUMBER_BOX,
    POWER_RANKINGS_HONORABLE_NUMBER_BOX,
    normalizeCustomerId,
    resolveNumberArtwork,
    resolveNumberArtworkForDriver,
    hasUsableNumberArtwork,
    computeContainDest,
    computeNumberDisplayBox,
    findVisibleBounds,
    removeConnectedBackground,
    normalizeNumberArtworkPixels,
    indexNumberArtworkCatalog,
    findCatalogEntry,
  };
}
