/**
 * Standings graphic export — pure-logic regression tests.
 * Run: node scripts/test-standings-graphic-export.mjs
 */
import assert from "node:assert/strict";
import {
  MAX_DRIVERS,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  RENDER_SCALE,
  COLUMN_SIZES,
  DEFAULT_PLAYOFF_CUT,
  SPONSOR_NAME,
  takeTopDrivers,
  distributeColumns,
  findPlayoffCutPlacement,
  resolveLatestCompletedPointsRaceNumber,
  resolvePointsRaceNumberFromSchedule,
  isNonPointsRace,
  buildStandingsGraphicFilename,
  formatSeasonHeading,
  formatAfterRaceLine,
  formatWinsLabel,
  formatPointsLabel,
  fitTextFontSize,
  plateNumberFontSize,
  buildSponsorFooterText,
  validateOutputDimensions,
  parseSeasonNumber,
  normalizeStandingsRows,
} from "../public/standings-graphic-export-logic.js";

function makeDrivers(count) {
  return Array.from({ length: count }, (_, i) => ({
    position: i + 1,
    driver: `Driver ${String(i + 1).padStart(2, "0")} Longname`,
    carNumber: String((i % 999) + 1),
    points: 1000 - i * 7,
    wins: i === 0 ? 3 : i < 5 ? 1 : 0,
  }));
}

function approxMeasure(font, text) {
  const sizeMatch = String(font).match(/(\d+(?:\.\d+)?)px/);
  const size = sizeMatch ? Number(sizeMatch[1]) : 16;
  return String(text).length * size * 0.55;
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
  assert.equal(validateOutputDimensions(1920, 1080), false);
});

test("maximum 43 drivers exported", () => {
  const rows = takeTopDrivers(makeDrivers(60), MAX_DRIVERS);
  assert.equal(rows.length, 43);
  assert.equal(rows[0].position, 1);
  assert.equal(rows[42].position, 43);
});

test("fewer than 43 drivers — no placeholders", () => {
  const rows = takeTopDrivers(makeDrivers(12), MAX_DRIVERS);
  assert.equal(rows.length, 12);
  assert.ok(rows.every((r) => r.driverName));
});

test("standings ordering preserved from authoritative rows", () => {
  const input = [
    { position: 2, driver: "B", points: 90, wins: 0, carNumber: "2" },
    { position: 1, driver: "A", points: 100, wins: 1, carNumber: "1" },
  ];
  // Export does not re-sort — matches public API order as provided.
  const rows = normalizeStandingsRows(input);
  assert.equal(rows[0].driverName, "B");
  assert.equal(rows[1].driverName, "A");
});

test("column distribution 15 / 14 / 14", () => {
  assert.deepEqual(COLUMN_SIZES, [15, 14, 14]);
  const cols = distributeColumns(takeTopDrivers(makeDrivers(43)));
  assert.equal(cols[0].length, 15);
  assert.equal(cols[1].length, 14);
  assert.equal(cols[2].length, 14);
  assert.equal(cols[0][0].position, 1);
  assert.equal(cols[0][14].position, 15);
  assert.equal(cols[1][0].position, 16);
  assert.equal(cols[1][13].position, 29);
  assert.equal(cols[2][0].position, 30);
  assert.equal(cols[2][13].position, 43);
});

test("P16 playoff cutoff placement is after position 16 in column 2", () => {
  const drivers = takeTopDrivers(makeDrivers(43));
  const cut = findPlayoffCutPlacement(drivers, DEFAULT_PLAYOFF_CUT);
  assert.ok(cut);
  assert.equal(cut.playoffCut, 16);
  assert.equal(cut.columnIndex, 1);
  assert.equal(cut.afterRowIndex, 0);
  assert.match(cut.label, /TOP 16 PLAYOFF CUT/);
});

test("playoff cut omitted when fewer than cut+1 drivers", () => {
  const cut = findPlayoffCutPlacement(takeTopDrivers(makeDrivers(10)), 16);
  assert.equal(cut, null);
});

test("official points-race number ignores duel / non-points events", () => {
  const races = [
    { track: "Daytona", points: "yes", winner: "A", status: "points" },
    { track: "Daytona Duels", points: "no", winner: "B", status: "non-points" },
    { track: "Rockingham", points: "yes", winner: "C", status: "points" },
    { track: "Exhibition Clash", points: "no", winner: "D", status: "non-points" },
    { track: "Bristol", points: "yes", winner: "", status: "points" },
  ];
  assert.equal(isNonPointsRace(races[1]), true);
  assert.equal(isNonPointsRace(races[3]), true);
  assert.equal(resolveLatestCompletedPointsRaceNumber(races), 2);
});

test("schedule API latestCompletedRaceNumber preferred when present", () => {
  const n = resolvePointsRaceNumberFromSchedule({
    raceResults: { latestCompletedRaceNumber: 17 },
    raceProgression: { effectiveCompletedPointsCount: 16 },
    races: [{ track: "X", points: "yes", winner: "A" }],
  });
  assert.equal(n, 17);
});

test("filename uses season + official points race", () => {
  assert.equal(
    buildStandingsGraphicFilename({ seasonName: "Season 11", pointsRaceNumber: 17 }),
    "BP-S11-R17-Standings.png",
  );
  assert.equal(formatSeasonHeading("Season 11"), "SEASON 11 STANDINGS");
  assert.equal(formatAfterRaceLine(17), "AFTER RACE 17");
  assert.equal(parseSeasonNumber("Season 11"), 11);
});

test("long-name fitting reduces font size", () => {
  const long = "MIGUEL GOMEZ-GAUDET EXTENDED";
  const fitted = fitTextFontSize(approxMeasure, long, 120, {
    maxSize: 18,
    minSize: 10,
  });
  const short = fitTextFontSize(approxMeasure, "LEE", 120, {
    maxSize: 18,
    minSize: 10,
  });
  assert.ok(fitted < short);
  assert.ok(fitted >= 10);
});

test("1/2/3-digit number plate font sizes", () => {
  const one = plateNumberFontSize("9", { maxSize: 20, minSize: 12 });
  const two = plateNumberFontSize("99", { maxSize: 20, minSize: 12 });
  const three = plateNumberFontSize("999", { maxSize: 20, minSize: 12 });
  assert.ok(one >= two);
  assert.ok(two >= three);
  assert.equal(three, 14);
});

test("zero and multiple wins labels", () => {
  assert.equal(formatWinsLabel(0), "0 WINS");
  assert.equal(formatWinsLabel(1), "1 WIN");
  assert.equal(formatWinsLabel(3), "3 WINS");
  assert.equal(formatPointsLabel(782), "782 PTS");
});

test("sponsor footer falls back to text when logo unavailable", () => {
  const withLogo = buildSponsorFooterText({ hasLogo: true });
  assert.equal(withLogo.useLogo, true);
  assert.equal(withLogo.sponsorLine, null);

  const fallback = buildSponsorFooterText({ hasLogo: false });
  assert.equal(fallback.useLogo, false);
  assert.equal(fallback.sponsorLine, SPONSOR_NAME);
  assert.match(fallback.presentedBy, /PRESENTED BY/i);
});

console.log(`\n${passed} standings-graphic tests passed.`);
