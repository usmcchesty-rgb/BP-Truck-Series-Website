/**
 * Shared number-artwork resolver + normalizer regression tests.
 * Run: node scripts/test-number-artwork.mjs
 */
import assert from "node:assert/strict";
import {
  NUMBER_ARTWORK_CANVAS_HEIGHT,
  NUMBER_ARTWORK_CANVAS_WIDTH,
  NUMBER_ARTWORK_SOURCE,
  POWER_RANKINGS_CARD_NUMBER_BOX,
  STANDINGS_NUMBER_BOX,
  computeContainDest,
  computeNumberDisplayBox,
  hasUsableNumberArtwork,
  indexNumberArtworkCatalog,
  normalizeNumberArtworkPixels,
  removeConnectedBackground,
  resolveNumberArtwork,
  resolveNumberArtworkForDriver,
} from "../public/number-artwork-logic.js";

function pixel(data, x, y, width) {
  const i = (y * width + x) * 4;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

function fillRect(data, width, height, x, y, w, h, r, g, b, a = 255) {
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = (py * width + px) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
}

function test(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

test("custom artwork beats SDK artwork", () => {
  const resolved = resolveNumberArtwork({
    iracingCustomerId: "91227",
    carNumber: "12",
    numberImage: {
      sdkPath: "/assets/images/numbers/91227.png",
      customPath: "/assets/images/numbers/custom/91227.png",
      preferredSource: "custom",
      authoritative: true,
    },
  });
  assert.equal(resolved.source, NUMBER_ARTWORK_SOURCE.CUSTOM);
  assert.equal(resolved.imagePath, "/assets/images/numbers/custom/91227.png");
  assert.equal(resolved.authoritative, true);
  assert.equal(resolved.sdkPath, "/assets/images/numbers/91227.png");
});

test("SDK artwork is used when no custom override exists", () => {
  const resolved = resolveNumberArtwork({
    iracingCustomerId: "91227",
    iracingDesign: {
      numberImage: {
        sdkPath: "/assets/images/numbers/91227.png",
        customPath: null,
        preferredSource: "sdk",
        authoritative: true,
      },
    },
  });
  assert.equal(resolved.source, NUMBER_ARTWORK_SOURCE.SDK);
  assert.equal(resolved.imagePath, "/assets/images/numbers/91227.png");
  assert.equal(hasUsableNumberArtwork(resolved), true);
});

test("never fabricates an SDK path when none is stored", () => {
  const resolved = resolveNumberArtwork({
    iracingCustomerId: "999999",
    carNumber: "00",
  });
  assert.equal(resolved.source, NUMBER_ARTWORK_SOURCE.FALLBACK);
  assert.equal(resolved.imagePath, "");
  assert.equal(hasUsableNumberArtwork(resolved), false);
  assert.equal(resolved.imagePath.includes("999999"), false);
});

test("catalog SDK path is used without inventing a missing file", () => {
  const catalog = indexNumberArtworkCatalog({
    drivers: [
      {
        iracingName: "Mark Arthur",
        iracingCustomerId: 91227,
        iracingDesign: {
          numberImage: {
            sdkPath: "/assets/images/numbers/91227.png",
            customPath: null,
            preferredSource: "sdk",
          },
        },
      },
    ],
  });
  const withPath = resolveNumberArtworkForDriver(
    { iracing_customer_id: "91227", display_name: "Mark Arthur" },
    catalog,
    {},
  );
  assert.equal(withPath.source, "sdk");
  assert.equal(withPath.imagePath, "/assets/images/numbers/91227.png");

  const missing = resolveNumberArtworkForDriver(
    { iracing_customer_id: "1", display_name: "Nobody" },
    catalog,
    {},
  );
  assert.equal(missing.source, "fallback");
  assert.equal(missing.imagePath, "");
});

test("custom override wins over catalog SDK via shared resolver", () => {
  const catalog = indexNumberArtworkCatalog({
    drivers: [
      {
        iracingCustomerId: 91227,
        iracingDesign: {
          numberImage: {
            sdkPath: "/assets/images/numbers/91227.png",
            preferredSource: "sdk",
          },
        },
      },
    ],
  });
  const resolved = resolveNumberArtworkForDriver(
    { iracingCustomerId: "91227" },
    catalog,
    {
      91227: {
        customPath: "/assets/images/numbers/custom/91227.png",
        preferredSource: "custom",
      },
    },
  );
  assert.equal(resolved.source, "custom");
  assert.equal(resolved.imagePath, "/assets/images/numbers/custom/91227.png");
  assert.equal(resolved.sdkPath, "/assets/images/numbers/91227.png");
});

test("edge-connected background removal keeps white number interiors", () => {
  const width = 24;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);
  fillRect(data, width, height, 0, 0, width, height, 255, 255, 255, 255);
  fillRect(data, width, height, 6, 4, 12, 8, 0, 0, 0, 255);
  fillRect(data, width, height, 7, 5, 10, 6, 255, 255, 255, 255);

  const result = removeConnectedBackground(data, width, height, { mode: "white" });
  const interior = pixel(result.data, 10, 7, width);
  const outline = pixel(result.data, 6, 4, width);
  const background = pixel(result.data, 0, 0, width);

  assert.equal(interior.r, 255);
  assert.equal(interior.g, 255);
  assert.equal(interior.b, 255);
  assert.equal(interior.a, 255);
  assert.equal(outline.r, 0);
  assert.equal(outline.a, 255);
  assert.equal(background.a, 0);
});

test("visible artwork bounds drive scale, not original canvas size", () => {
  const width = 2000;
  const height = 2000;
  const data = new Uint8ClampedArray(width * height * 4);
  fillRect(data, width, height, 800, 900, 400, 200, 220, 20, 20, 255);

  const normalized = normalizeNumberArtworkPixels(data, width, height, { mode: "transparent" });
  assert.equal(normalized.width, NUMBER_ARTWORK_CANVAS_WIDTH);
  assert.equal(normalized.height, NUMBER_ARTWORK_CANVAS_HEIGHT);
  assert.equal(normalized.detectedBounds.width, 400);
  assert.equal(normalized.detectedBounds.height, 200);
  assert.ok(normalized.resultBounds.width > 300, "visible number must occupy most of the inner box");
  assert.ok(normalized.resultBounds.height > 150);
});

test("contain-fit never stretches a 640×320 asset", () => {
  const standings = computeContainDest(640, 320, 0, 0, STANDINGS_NUMBER_BOX.width, STANDINGS_NUMBER_BOX.height);
  assert.equal(standings.width, 80);
  assert.equal(standings.height, 40);

  const wideBox = computeContainDest(640, 320, 10, 10, 200, 40);
  assert.equal(wideBox.width, 80);
  assert.equal(wideBox.height, 40);

  const card = computeContainDest(
    640,
    320,
    0,
    0,
    POWER_RANKINGS_CARD_NUMBER_BOX.width,
    POWER_RANKINGS_CARD_NUMBER_BOX.height,
  );
  assert.equal(card.width / card.height, 2);
});

test("Standings and Power Rankings share the same display-box helper", () => {
  const standings = computeNumberDisplayBox("standings", 48);
  const card = computeNumberDisplayBox("power-rankings");
  const honorable = computeNumberDisplayBox("power-rankings-honorable");
  assert.equal(standings.width / standings.height, 2);
  assert.equal(card.width, POWER_RANKINGS_CARD_NUMBER_BOX.width);
  assert.equal(honorable.width, 80);
});

console.log("test-number-artwork.mjs: all checks passed");
