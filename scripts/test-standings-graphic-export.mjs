/**
 * Standings graphic export — pure-logic regression tests.
 * Run: node scripts/test-standings-graphic-export.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_DRIVERS,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  RENDER_SCALE,
  COLUMN_SIZES,
  DEFAULT_PLAYOFF_CUT,
  SPONSOR_NAME,
  TYPOGRAPHY,
  DETERMINISTIC_PLATE_PALETTE,
  takeTopDrivers,
  distributeColumns,
  findPlayoffCutPlacement,
  resolveLatestCompletedPointsRaceNumber,
  resolveLatestCompletedPointsRaceFromRaces,
  resolveLatestCompletedPointsRaceDisplay,
  enrichClientScheduleRaces,
  isNonPointsRace,
  buildStandingsGraphicFilename,
  buildStandingsGraphicModel,
  formatSeasonHeading,
  formatAfterRaceLine,
  formatWinsLabel,
  formatPointsLabel,
  formatMovement,
  resolveMovementDelta,
  fitTextFontSize,
  fitTrackNameDisplay,
  plateNumberFontSize,
  formatPlateDisplay,
  pickCarNumber,
  pickReadableNumberColor,
  packagePlateColors,
  pickDeterministicPlateColors,
  isNearWhiteHex,
  estimateTrackedWidth,
  buildSponsorFooterText,
  validateOutputDimensions,
  parseSeasonNumber,
  normalizeStandingsRows,
  sanitizeTrackName,
  formatPreviewStatus,
  computeStandingsLayoutMetrics,
} from "../public/standings-graphic-export-logic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function makeDrivers(count, extras = {}) {
  return Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    previousPosition: i + 1 + (i % 3 === 0 ? 2 : i % 3 === 1 ? -1 : 0),
    gainLoss: i % 3 === 0 ? 2 : i % 3 === 1 ? -1 : 0,
    driver: `Driver ${String(i + 1).padStart(2, "0")} Longname`,
    carNumber: String((i % 999) + 1),
    points: 1000 - i * 7,
    wins: i === 0 ? 3 : i < 5 ? 1 : 0,
    ...extras,
  }));
}

function approxMeasure(font, text) {
  const sizeMatch = String(font).match(/(\d+(?:\.\d+)?)px/);
  const size = sizeMatch ? Number(sizeMatch[1]) : 16;
  return String(text).length * size * 0.55;
}

/** Raw schedule: 2 Daytona duels + points races. Homestead = schedule row 19 = official points 17. */
function homesteadScheduleFixture() {
  const races = [];
  for (let i = 1; i <= 16; i += 1) {
    races.push({
      raceNumber: i,
      track: `Track ${i}`,
      points: "yes",
      winner: `Winner ${i}`,
      status: "points",
    });
  }
  races.push({
    raceNumber: 17,
    track: "Daytona Duels Heat 1",
    points: "no",
    winner: "Duel Winner A",
    status: "non-points",
  });
  races.push({
    raceNumber: 18,
    track: "Daytona Duels Heat 2",
    points: "no",
    winner: "Duel Winner B",
    status: "non-points",
  });
  races.push({
    raceNumber: 19,
    track: "Homestead Miami Speedway Oval Night",
    points: "yes",
    winner: "Chris Carroll3",
    status: "points",
  });
  races.push({
    raceNumber: 20,
    track: "Texas Motor Speedway Oval",
    points: "yes",
    winner: "",
    status: "points",
  });
  return races;
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test("output dimensions are exactly 3840×2160 at scale 2", () => {
  assert.equal(RENDER_SCALE, 2);
  assert.equal(OUTPUT_WIDTH, 3840);
  assert.equal(OUTPUT_HEIGHT, 2160);
  assert.equal(validateOutputDimensions(3840, 2160), true);
});

test("43 drivers → 16 / 14 / 13 columns", () => {
  assert.deepEqual(COLUMN_SIZES, [16, 14, 13]);
  const cols = distributeColumns(takeTopDrivers(makeDrivers(43)));
  assert.deepEqual(cols.map((c) => c.length), [16, 14, 13]);
  assert.equal(cols[0][0].position, 1);
  assert.equal(cols[0][15].position, 16);
  assert.equal(cols[1][0].position, 17);
  assert.equal(cols[1][13].position, 30);
  assert.equal(cols[2][0].position, 31);
  assert.equal(cols[2][12].position, 43);
});

test("P1–P16 all in column 1; playoff divider below P16", () => {
  const drivers = takeTopDrivers(makeDrivers(43));
  const cut = findPlayoffCutPlacement(drivers, DEFAULT_PLAYOFF_CUT);
  assert.ok(cut);
  assert.equal(cut.columnIndex, 0);
  assert.equal(cut.afterRowIndex, 15);
  assert.match(cut.label, /TOP 16 PLAYOFF CUT/);
});

test("16-row first column + cut + footer physically fits", () => {
  const m = computeStandingsLayoutMetrics({
    driverCount: 43,
    hasTrackName: true,
    reserveCutGap: true,
  });
  assert.equal(m.maxRows, 16);
  assert.equal(m.fits, true);
  assert.ok(m.rowH >= 48);
  assert.ok(m.usedH <= m.gridSpan + 0.01);
});

test("fewer than 43 drivers — no placeholders", () => {
  const rows = takeTopDrivers(makeDrivers(12), MAX_DRIVERS);
  assert.equal(rows.length, 12);
});

test("standings ordering preserved", () => {
  const rows = normalizeStandingsRows([
    { position: 2, driver: "B", points: 90, wins: 0, carNumber: "2" },
    { position: 1, driver: "A", points: 100, wins: 1, carNumber: "1" },
  ]);
  assert.equal(rows[0].driverName, "B");
});

test("Race 17 + Homestead resolve together; schedule row 19 is official 17", () => {
  const races = homesteadScheduleFixture();
  const enriched = enrichClientScheduleRaces(races);
  const homestead = enriched.find((r) => /Homestead/i.test(r.track));
  assert.equal(homestead.scheduleRow ?? homestead.raceNumber, 19);
  assert.equal(homestead.officialPointsRaceNumber, 17);
  const display = resolveLatestCompletedPointsRaceFromRaces(races);
  assert.equal(display.raceNumber, 17);
  assert.equal(display.trackName, "Homestead Miami Speedway Oval Night");
  assert.notEqual(display.raceNumber, 19);
});

test("duel/non-points rows do not increment official points race number", () => {
  const races = homesteadScheduleFixture();
  assert.equal(isNonPointsRace(races[16]), true);
  assert.equal(isNonPointsRace(races[17]), true);
  assert.equal(resolveLatestCompletedPointsRaceNumber(races), 17);
});

test("race number and track come from same completed points-race record", () => {
  const scheduleData = {
    raceResults: {
      latestCompletedRaceNumber: 17,
      completedRaces: [
        { raceNumber: 17, track: "Homestead Miami Speedway Oval Night" },
      ],
    },
    races: homesteadScheduleFixture(),
  };
  const display = resolveLatestCompletedPointsRaceDisplay(scheduleData);
  assert.equal(display.raceNumber, 17);
  assert.equal(display.trackName, "Homestead Miami Speedway Oval Night");
});

test("missing track falls back to After Race # only", () => {
  const display = resolveLatestCompletedPointsRaceDisplay({
    raceResults: { latestCompletedRaceNumber: 17, completedRaces: [{ raceNumber: 17, track: "" }] },
    races: [],
  });
  assert.equal(display.raceNumber, 17);
  assert.equal(display.trackName, "");
  assert.equal(formatAfterRaceLine(17), "AFTER RACE 17");
  assert.equal(sanitizeTrackName("undefined"), "");
});

test("long track names auto-fit", () => {
  const fitted = fitTrackNameDisplay(
    approxMeasure,
    "EchoPark Speedway (Atlanta) Oval - 2008",
    180,
    { maxSize: 16, minSize: 11 },
  );
  assert.ok(fitted.lines.length >= 1 && fitted.lines.length <= 2);
});

test("header helpers produce single season + race labels (no duplicate path)", () => {
  assert.equal(formatSeasonHeading("Season 11"), "SEASON 11 STANDINGS");
  assert.equal(formatAfterRaceLine(17), "AFTER RACE 17");
  assert.equal(parseSeasonNumber("Season 11"), 11);
});

test("valid carNumber always produces plate display; empty string falls through to bp_number", () => {
  assert.equal(pickCarNumber({ carNumber: "", bp_number: "99" }), "99");
  assert.equal(pickCarNumber({ carNumber: "07", bp_number: "7" }), "07");
  assert.equal(formatPlateDisplay("99"), "99");
  assert.equal(formatPlateDisplay(""), "—");
  assert.equal(formatPlateDisplay(null), "—");
});

test("1/2/3-digit plate font sizes; leading zero preserved", () => {
  assert.ok(plateNumberFontSize("9") >= plateNumberFontSize("99"));
  assert.ok(plateNumberFontSize("99") >= plateNumberFontSize("999"));
  assert.equal(formatPlateDisplay("07"), "07");
});

test("luminance picks readable number color", () => {
  assert.equal(pickReadableNumberColor("#ffffff"), "#0a0a0a");
  assert.equal(pickReadableNumberColor("#101010"), "#ffffff");
});

test("movement gained / lost / unchanged / missing", () => {
  assert.deepEqual(formatMovement(3), { text: "▲3", dir: "up", value: 3 });
  assert.deepEqual(formatMovement(-2), { text: "▼2", dir: "down", value: -2 });
  assert.deepEqual(formatMovement(0), { text: "—", dir: "flat", value: 0 });
  assert.deepEqual(formatMovement(null), { text: "—", dir: "flat", value: null });
  assert.equal(resolveMovementDelta({ gainLoss: 3 }), 3);
  assert.equal(resolveMovementDelta({ previousPosition: 5, position: 2 }), 3);
  assert.equal(resolveMovementDelta({ previousPosition: 0, position: 4 }), null);
});

test("movement does not alter standings order", () => {
  const rows = takeTopDrivers(makeDrivers(10));
  assert.equal(rows[0].position, 1);
  assert.equal(rows[9].position, 10);
});

test("sponsor footer is text-only Ohio & Indiana Roofing", () => {
  const footer = buildSponsorFooterText();
  assert.equal(footer.useLogo, false);
  assert.match(footer.combined, /PRESENTED BY OHIO & INDIANA ROOFING/);
  assert.equal(footer.sponsorLine, SPONSOR_NAME);
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11" }, rows: makeDrivers(5) },
    { races: homesteadScheduleFixture() },
  );
  assert.equal(model.sponsor.useLogo, false);
});

test("filename keeps season + official points race (no track)", () => {
  assert.equal(
    buildStandingsGraphicFilename({
      seasonName: "Season 11",
      latestCompletedRace: { raceNumber: 17, trackName: "Homestead" },
    }),
    "BP-S11-R17-Standings.png",
  );
});

test("preview/export share same model; Refresh Snapshot updates race data", () => {
  const standingsData = {
    settings: { seasonName: "Season 11", playoffCut: 16 },
    rows: makeDrivers(43),
  };
  const a = buildStandingsGraphicModel(standingsData, {
    races: [{ track: "Daytona", points: "yes", winner: "A", status: "points" }],
  });
  const b = buildStandingsGraphicModel(standingsData, {
    raceResults: {
      latestCompletedRaceNumber: 17,
      completedRaces: [{ raceNumber: 17, track: "Homestead Miami Speedway Oval Night" }],
    },
    races: homesteadScheduleFixture(),
  });
  assert.equal(a.latestCompletedRace.raceNumber, 1);
  assert.equal(b.latestCompletedRace.raceNumber, 17);
  assert.deepEqual(b.columns.map((c) => c.length), [16, 14, 13]);
  assert.equal(b.drivers.length, 43);
  assert.match(formatPreviewStatus(b), /After Race 17/);
  assert.match(formatPreviewStatus(b), /Homestead/);
});

test("fewer than 43 drivers show correct preview count", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11" }, rows: makeDrivers(38) },
    { races: homesteadScheduleFixture() },
  );
  assert.equal(model.drivers.length, 38);
  assert.match(formatPreviewStatus(model), /38 drivers/);
});

test("wins / points labels", () => {
  assert.equal(formatWinsLabel(0), "0 WINS");
  assert.equal(formatWinsLabel(1), "1 WIN");
  assert.equal(formatPointsLabel(782), "782 PTS");
});

test("long driver-name fitting reduces font size", () => {
  const fitted = fitTextFontSize(approxMeasure, "MIGUEL GOMEZ-GAUDET EXTENDED", 120, {
    maxSize: 18,
    minSize: 10,
  });
  assert.ok(fitted < 18);
});

test("no new routable API file; Vercel function count unchanged at 12", () => {
  const apiDir = path.join(root, "api");
  const routable = fs
    .readdirSync(apiDir)
    .filter((name) => name.endsWith(".js") && !name.startsWith("_"));
  assert.ok(!routable.includes("standings-graphic.js"));
  assert.equal(routable.length, 12);
});

test("master canvas constants remain 3840×2160 for preview/export", () => {
  assert.equal(OUTPUT_WIDTH, 3840);
  assert.equal(OUTPUT_HEIGHT, 2160);
});

test("typography defaults are larger than previous compressed sizes", () => {
  assert.ok(TYPOGRAPHY.driverNameRest >= 19);
  assert.ok(TYPOGRAPHY.positionTop10 >= 26);
  assert.ok(TYPOGRAPHY.movement >= 16);
  assert.ok(TYPOGRAPHY.points >= 17);
  assert.ok(TYPOGRAPHY.wins >= 14);
  assert.ok(TYPOGRAPHY.seasonMax >= 36);
  assert.ok(TYPOGRAPHY.afterRace >= 18);
  assert.ok(TYPOGRAPHY.footerSponsor >= 26);
  assert.ok(TYPOGRAPHY.footerSeries >= 15);
  assert.ok(TYPOGRAPHY.footerSite >= 16);
  assert.ok(TYPOGRAPHY.playoffCut >= 14);
});

test("tracked width is included in name fitting", () => {
  const text = "MARK ARTHUR";
  const tracking = TYPOGRAPHY.tracking.driverName;
  const shortMax = 90;
  const withTracking = fitTextFontSize(approxMeasure, text, shortMax, {
    maxSize: 21,
    minSize: 11,
    tracking,
  });
  const without = fitTextFontSize(approxMeasure, text, shortMax, {
    maxSize: 21,
    minSize: 11,
    tracking: 0,
  });
  assert.ok(withTracking <= without);
  assert.ok(estimateTrackedWidth(100, text, tracking) > 100);
});

test("normal names keep larger default; long names shrink", () => {
  const short = fitTextFontSize(approxMeasure, "LEE", 400, {
    maxSize: TYPOGRAPHY.driverNameRest,
    minSize: TYPOGRAPHY.driverNameMin,
    tracking: TYPOGRAPHY.tracking.driverName,
  });
  const long = fitTextFontSize(approxMeasure, "MIGUEL GOMEZ-GAUDET EXTENDED NAME", 160, {
    maxSize: TYPOGRAPHY.driverNameRest,
    minSize: TYPOGRAPHY.driverNameMin,
    tracking: TYPOGRAPHY.tracking.driverName,
  });
  assert.equal(short, TYPOGRAPHY.driverNameRest);
  assert.ok(long < TYPOGRAPHY.driverNameRest);
});

test("white primary + colored secondary becomes colored plate fill", () => {
  const pack = packagePlateColors({
    fill: "#ffffff",
    outline: "#c81010",
    source: "suit_cache",
    driver: { driverName: "White Suit", driverId: "1" },
  });
  assert.equal(isNearWhiteHex(pack.fill), false);
  assert.equal(pack.fill, "#c81010");
  assert.equal(pack.colorSource, "suit_cache");
});

test("near-white without secondary darkens instead of plain white plate", () => {
  const pack = packagePlateColors({
    fill: "#f5f5f5",
    outline: "#eeeeee",
    source: "portrait_sample",
    driver: { driverName: "Ghost", driverId: "2" },
  });
  assert.equal(isNearWhiteHex(pack.fill), false);
  assert.notEqual(pack.fill.toLowerCase(), "#ffffff");
  assert.notEqual(pack.fill.toLowerCase(), "#f5f5f5");
});

test("deterministic fallback is stable and never pure white", () => {
  const a = pickDeterministicPlateColors({ driverName: "Chris", driverId: "10", carNumber: "99" });
  const b = pickDeterministicPlateColors({ driverName: "Chris", driverId: "10", carNumber: "99" });
  assert.deepEqual(a, b);
  assert.equal(isNearWhiteHex(a.fill), false);
  assert.ok(DETERMINISTIC_PLATE_PALETTE.every((p) => !isNearWhiteHex(p.fill)));
});

test("image/CORS failure path uses deterministic fallback via packagePlateColors", () => {
  const pack = packagePlateColors({
    fill: "",
    outline: "",
    source: "portrait_sample",
    driver: { driverName: "CORS Fail", driverId: "77", carNumber: "12" },
  });
  assert.equal(pack.colorSource, "deterministic_fallback");
  assert.equal(isNearWhiteHex(pack.fill), false);
});

test("footer is text-only with sponsor larger than presented-by", () => {
  const footer = buildSponsorFooterText();
  assert.equal(footer.useLogo, false);
  assert.equal(footer.sponsorLine, SPONSOR_NAME);
  assert.ok(TYPOGRAPHY.footerSponsor > TYPOGRAPHY.footerPresentedBy);
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11" }, rows: makeDrivers(5) },
    { races: homesteadScheduleFixture() },
  );
  assert.equal(model.sponsor.useLogo, false);
});

test("footer height increased for presenting-sponsor strip", () => {
  const m = computeStandingsLayoutMetrics({
    driverCount: 43,
    hasTrackName: true,
    reserveCutGap: true,
  });
  assert.ok(m.footerH >= 78);
  assert.equal(m.fits, true);
});

test("luminance still picks readable number colors", () => {
  assert.equal(pickReadableNumberColor("#ffffff"), "#0a0a0a");
  assert.equal(pickReadableNumberColor("#101010"), "#ffffff");
  assert.equal(pickReadableNumberColor("#c81010"), "#ffffff");
});

console.log(`\n${passed} standings-graphic tests passed.`);
