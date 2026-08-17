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
  takeTopDrivers,
  distributeColumns,
  findPlayoffCutPlacement,
  resolveLatestCompletedPointsRaceNumber,
  resolveLatestCompletedPointsRaceFromRaces,
  resolveLatestCompletedPointsRaceDisplay,
  resolvePointsRaceNumberFromSchedule,
  isNonPointsRace,
  buildStandingsGraphicFilename,
  buildStandingsGraphicModel,
  formatSeasonHeading,
  formatAfterRaceLine,
  formatWinsLabel,
  formatPointsLabel,
  fitTextFontSize,
  fitTrackNameDisplay,
  plateNumberFontSize,
  buildSponsorFooterText,
  validateOutputDimensions,
  parseSeasonNumber,
  normalizeStandingsRows,
  sanitizeTrackName,
  formatPreviewStatus,
} from "../public/standings-graphic-export-logic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

function homesteadScheduleFixture() {
  const races = [];
  for (let i = 1; i <= 16; i += 1) {
    races.push({
      track: `Track ${i}`,
      points: "yes",
      winner: `Winner ${i}`,
      status: "points",
    });
  }
  races.push({
    track: "Daytona Duels",
    points: "no",
    winner: "Duel Winner",
    status: "non-points",
  });
  races.push({
    track: "Homestead Miami Speedway Oval Night",
    points: "yes",
    winner: "Chris Carroll3",
    status: "points",
  });
  races.push({
    track: "Future Track",
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

test("Race 17 + Homestead resolve together from same completed race", () => {
  const races = homesteadScheduleFixture();
  const display = resolveLatestCompletedPointsRaceFromRaces(races);
  assert.equal(display.raceNumber, 17);
  assert.equal(display.trackName, "Homestead Miami Speedway Oval Night");
});

test("duel/non-points rows do not shift official points race number", () => {
  const races = homesteadScheduleFixture();
  assert.equal(isNonPointsRace(races.find((r) => /duel/i.test(r.track))), true);
  assert.equal(resolveLatestCompletedPointsRaceNumber(races), 17);
  const display = resolveLatestCompletedPointsRaceDisplay({ races });
  assert.equal(display.raceNumber, 17);
  assert.equal(display.trackName, "Homestead Miami Speedway Oval Night");
});

test("race number and track come from the same completed race", () => {
  const scheduleData = {
    raceResults: {
      latestCompletedRaceNumber: 17,
      completedRaces: [
        {
          raceNumber: 17,
          track: "Homestead Miami Speedway Oval Night",
        },
      ],
    },
    races: homesteadScheduleFixture(),
  };
  const display = resolveLatestCompletedPointsRaceDisplay(scheduleData);
  assert.equal(display.raceNumber, 17);
  assert.equal(display.trackName, "Homestead Miami Speedway Oval Night");
  assert.equal(resolvePointsRaceNumberFromSchedule(scheduleData), 17);
});

test("missing track gracefully falls back to After Race # only", () => {
  const display = resolveLatestCompletedPointsRaceDisplay({
    raceResults: { latestCompletedRaceNumber: 17, completedRaces: [{ raceNumber: 17, track: "" }] },
    races: [],
  });
  assert.equal(display.raceNumber, 17);
  assert.equal(display.trackName, "");
  assert.equal(formatAfterRaceLine(display.raceNumber), "AFTER RACE 17");
  assert.equal(sanitizeTrackName(undefined), "");
  assert.equal(sanitizeTrackName("null"), "");
  assert.equal(sanitizeTrackName("—"), "");
});

test("long track names auto-fit (shrink or wrap)", () => {
  const long = "EchoPark Speedway (Atlanta) Oval - 2008";
  const fitted = fitTrackNameDisplay(approxMeasure, long, 180, {
    maxSize: 16,
    minSize: 11,
  });
  assert.ok(fitted.lines.length >= 1);
  assert.ok(fitted.lines.length <= 2);
  assert.equal(fitted.fullTrackName, long.toUpperCase());
  fitted.lines.forEach((line) => {
    assert.ok(approxMeasure(`bold ${fitted.fontSize}px Arial`, line) <= 180 + 1);
  });
});

test("preview and download use the same model", () => {
  const standingsData = {
    settings: { seasonName: "Season 11", playoffCut: 16 },
    rows: makeDrivers(43),
  };
  const scheduleData = {
    raceResults: {
      latestCompletedRaceNumber: 17,
      completedRaces: [
        { raceNumber: 17, track: "Homestead Miami Speedway Oval Night" },
      ],
    },
    races: homesteadScheduleFixture(),
  };
  const modelA = buildStandingsGraphicModel(standingsData, scheduleData);
  const modelB = buildStandingsGraphicModel(standingsData, scheduleData);
  assert.deepEqual(modelA.latestCompletedRace, modelB.latestCompletedRace);
  assert.equal(modelA.filename, modelB.filename);
  assert.equal(modelA.drivers.length, modelB.drivers.length);
  assert.deepEqual(
    modelA.columns.map((c) => c.length),
    modelB.columns.map((c) => c.length),
  );
});

test("preview canvas remains exactly 3840×2160 (model constants)", () => {
  assert.equal(OUTPUT_WIDTH, 3840);
  assert.equal(OUTPUT_HEIGHT, 2160);
  assert.equal(validateOutputDimensions(OUTPUT_WIDTH, OUTPUT_HEIGHT), true);
});

test("Refresh Preview does not require network — model render is self-contained", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11", playoffCut: 16 }, rows: makeDrivers(20) },
    {
      races: [
        { track: "A", points: "yes", winner: "X", status: "points" },
      ],
    },
  );
  // Refresh Preview reuses this model object; no fetch fields required.
  assert.ok(model.drivers.length > 0);
  assert.ok(model.latestCompletedRace);
  assert.equal(typeof model.filename, "string");
});

test("Refresh Snapshot updates preview data from new schedule payload", () => {
  const standingsData = {
    settings: { seasonName: "Season 11", playoffCut: 16 },
    rows: makeDrivers(10),
  };
  const first = buildStandingsGraphicModel(standingsData, {
    races: [{ track: "Daytona", points: "yes", winner: "A", status: "points" }],
  });
  const second = buildStandingsGraphicModel(standingsData, {
    raceResults: {
      latestCompletedRaceNumber: 17,
      completedRaces: [
        { raceNumber: 17, track: "Homestead Miami Speedway Oval Night" },
      ],
    },
    races: homesteadScheduleFixture(),
  });
  assert.equal(first.latestCompletedRace.raceNumber, 1);
  assert.equal(first.latestCompletedRace.trackName, "Daytona");
  assert.equal(second.latestCompletedRace.raceNumber, 17);
  assert.equal(second.latestCompletedRace.trackName, "Homestead Miami Speedway Oval Night");
  assert.notEqual(first.filename, second.filename);
});

test("fewer than 43 drivers show correct preview count", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11" }, rows: makeDrivers(38) },
    { races: homesteadScheduleFixture() },
  );
  assert.equal(model.drivers.length, 38);
  const status = formatPreviewStatus(model);
  assert.match(status, /38 drivers · 3840×2160/);
});

test("preview/export preserve 15/14/14 column distribution", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11" }, rows: makeDrivers(43) },
    { races: homesteadScheduleFixture() },
  );
  assert.deepEqual(
    model.columns.map((c) => c.length),
    [15, 14, 14],
  );
});

test("sponsor footer still shows Ohio & Indiana Roofing", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11" }, rows: makeDrivers(5) },
    { races: homesteadScheduleFixture() },
  );
  assert.equal(model.sponsor.name, SPONSOR_NAME);
  const fallback = buildSponsorFooterText({ hasLogo: false });
  assert.equal(fallback.sponsorLine, "OHIO & INDIANA ROOFING");
  assert.match(fallback.presentedBy, /PRESENTED BY/i);
});

test("filename uses season + official points race (no track)", () => {
  assert.equal(
    buildStandingsGraphicFilename({
      seasonName: "Season 11",
      latestCompletedRace: { raceNumber: 17, trackName: "Homestead" },
    }),
    "BP-S11-R17-Standings.png",
  );
  assert.equal(formatSeasonHeading("Season 11"), "SEASON 11 STANDINGS");
  assert.equal(parseSeasonNumber("Season 11"), 11);
});

test("long driver-name fitting reduces font size", () => {
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

test("no new routable API file was added for standings graphic", () => {
  const apiDir = path.join(root, "api");
  const routable = fs
    .readdirSync(apiDir)
    .filter((name) => name.endsWith(".js") && !name.startsWith("_"));
  assert.ok(!routable.includes("standings-graphic.js"));
  assert.ok(!routable.includes("standings-graphic-export.js"));
  // Hobby-safe baseline: keep counting stable (no new public API route file).
  assert.equal(routable.length, 12);
});

test("Vercel function count remains unchanged (12 routable api/*.js)", () => {
  const apiDir = path.join(root, "api");
  const routable = fs
    .readdirSync(apiDir)
    .filter((name) => name.endsWith(".js") && !name.startsWith("_"));
  assert.equal(routable.length, 12);
});

console.log(`\n${passed} standings-graphic tests passed.`);
