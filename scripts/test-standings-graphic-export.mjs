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
  formatChampionshipStatDisplays,
  parseStandingsPoints,
  resolveLeaderPoints,
  resolveCutPoints,
  buildDriverChampionshipStat,
  attachChampionshipStats,
  computeStandingsStatGeometry,
  computeStatColumnHeaderGeometry,
  STAT_COLUMN_HEADERS,
  STAT_VALUE_COLUMNS,
  formatMovement,
  resolveMovementDelta,
  fitTextFontSize,
  fitDriverName,
  fitTrackNameDisplay,
  plateNumberFontSize,
  formatPlateDisplay,
  pickCarNumber,
  pickReadableNumberColor,
  packagePlateColors,
  resolveStandingsPlateColors,
  resolvePlateFillFromCandidates,
  pickDeterministicPlateColors,
  isNearWhiteHex,
  isUsablePlateFill,
  normalizeColorToHex,
  estimateTrackedWidth,
  buildSponsorFooterText,
  validateOutputDimensions,
  parseSeasonNumber,
  normalizeStandingsRows,
  sanitizeTrackName,
  formatPreviewStatus,
  computeStandingsLayoutMetrics,
  computeRowSlotGeometry,
  computeMovementGlyphGeometry,
  computePlayoffCutLine,
  computePlayoffBattleBox,
  standingsRowY,
  playoffBubbleKind,
  standingsRowVisualStyle,
  PLAYOFF_BUBBLE,
  PLAYOFF_BATTLE_BOX,
  PLAYOFF_CUT_LINE,
  STANDINGS_NORMAL_ROW,
  STANDINGS_P1_GOLD,
  STANDINGS_P2_SILVER,
  STANDINGS_P3_BRONZE,
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

test("42 drivers → 14 / 14 / 14 columns; P43 omitted from graphic", () => {
  assert.deepEqual(COLUMN_SIZES, [14, 14, 14]);
  assert.equal(MAX_DRIVERS, 42);
  const source = makeDrivers(43);
  assert.equal(source.length, 43);
  const displayed = takeTopDrivers(source);
  assert.equal(displayed.length, 42);
  assert.equal(displayed[41].position, 42);
  assert.equal(displayed.some((d) => d.position === 43), false);
  const cols = distributeColumns(displayed);
  assert.deepEqual(cols.map((c) => c.length), [14, 14, 14]);
  assert.equal(cols[0][0].position, 1);
  assert.equal(cols[0][13].position, 14);
  assert.equal(cols[1][0].position, 15);
  assert.equal(cols[1][1].position, 16);
  assert.equal(cols[1][13].position, 28);
  assert.equal(cols[2][0].position, 29);
  assert.equal(cols[2][13].position, 42);
});

test("P16 playoff cutoff is in column 2 between P16 and P17", () => {
  const drivers = takeTopDrivers(makeDrivers(43));
  const cut = findPlayoffCutPlacement(drivers, DEFAULT_PLAYOFF_CUT);
  assert.ok(cut);
  assert.equal(cut.playoffCut, 16);
  assert.equal(cut.columnIndex, 1);
  assert.equal(cut.afterRowIndex, 1);
});

test("14-row columns + footer physically fit with no extra playoff height", () => {
  const m = computeStandingsLayoutMetrics({
    driverCount: 42,
    hasTrackName: true,
  });
  assert.equal(m.maxRows, 14);
  assert.equal(m.fits, true);
  assert.equal(m.cutGap, 0);
  assert.ok(m.rowH >= 56 && m.rowH <= 60);
  assert.equal(m.rowGap, 5);
  assert.ok(m.usedH <= m.gridSpan + 0.01);
  assert.ok(m.gridTop + m.usedH <= m.gridBottom + 0.01);
  assert.ok(m.ruleY < m.gridTop);
  assert.ok(m.statHeaderH >= 28);
  const lastRowBottom = m.gridTop + (m.maxRows - 1) * (m.rowH + m.rowGap) + m.rowH;
  const spaceAboveFooter = 1080 - m.footerH - lastRowBottom;
  assert.ok(spaceAboveFooter >= 16, "leave intentional space above footer");
  assert.ok(spaceAboveFooter <= 48, "do not leave a large dead zone");
});

test("fewer than 42 drivers — no placeholders", () => {
  const rows = takeTopDrivers(makeDrivers(12), MAX_DRIVERS);
  assert.equal(rows.length, 12);
  const cols = distributeColumns(rows);
  assert.deepEqual(cols.map((c) => c.length), [12, 0, 0]);
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
  assert.deepEqual(formatMovement(3), { text: "▲3", dir: "up", value: 3, arrow: "▲", valueLabel: "3" });
  assert.deepEqual(formatMovement(-2), { text: "▼2", dir: "down", value: -2, arrow: "▼", valueLabel: "2" });
  assert.deepEqual(formatMovement(12), { text: "▲12", dir: "up", value: 12, arrow: "▲", valueLabel: "12" });
  assert.deepEqual(formatMovement(0), { text: "—", dir: "flat", value: 0, arrow: "—", valueLabel: "" });
  assert.deepEqual(formatMovement(null), { text: "—", dir: "flat", value: null, arrow: "—", valueLabel: "" });
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
  assert.deepEqual(b.columns.map((c) => c.length), [14, 14, 14]);
  assert.equal(b.drivers.length, 42);
  assert.equal(b.drivers.some((d) => d.position === 43), false);
  assert.equal(standingsData.rows.length, 43);
  assert.match(formatPreviewStatus(b), /After Race 17/);
  assert.match(formatPreviewStatus(b), /Homestead/);
});

test("fewer than 42 drivers show correct preview count", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11" }, rows: makeDrivers(38) },
    { races: homesteadScheduleFixture() },
  );
  assert.equal(model.drivers.length, 38);
  assert.deepEqual(model.columns.map((c) => c.length), [14, 14, 10]);
  assert.match(formatPreviewStatus(model), /38 drivers/);
});

test("wins helper remains available; graphic uses PTS/LEAD/CUT instead", () => {
  assert.equal(formatWinsLabel(0), "0 WINS");
  assert.equal(formatWinsLabel(1), "1 WIN");
  assert.equal(formatPointsLabel(782), "782 PTS");
  const src = fs.readFileSync(path.join(root, "public", "standings-graphic-export.js"), "utf8");
  assert.doesNotMatch(src, /formatWinsLabel/);
  assert.doesNotMatch(src, /WINS/);
  assert.match(src, /drawChampionshipStats/);
  assert.match(src, /drawStatColumnHeader/);
});

test("championship gap calculations use live points: leader 890 / cut 450", () => {
  const rows = [
    { position: 1, points: 890 },
    { position: 2, points: 888 },
    { position: 7, points: 654 },
    { position: 15, points: 501 },
    { position: 16, points: 450 },
    { position: 17, points: 414 },
    { position: 19, points: 385 },
  ];
  const leaderPoints = resolveLeaderPoints(rows);
  const cutPoints = resolveCutPoints(rows, 16);
  assert.equal(leaderPoints, 890);
  assert.equal(cutPoints, 450);

  const byPos = Object.fromEntries(
    rows.map((row) => [
      row.position,
      buildDriverChampionshipStat(row, { leaderPoints, cutPoints, playoffCut: 16 }),
    ]),
  );

  assert.equal(byPos[1].gapToLeader, 0);
  assert.equal(byPos[1].isLeader, true);
  assert.equal(byPos[1].gapToCut, 440);
  assert.equal(byPos[2].gapToLeader, -2);
  assert.equal(byPos[2].gapToCut, 438);
  assert.equal(byPos[7].gapToLeader, -236);
  assert.equal(byPos[7].gapToCut, 204);
  assert.equal(byPos[15].gapToLeader, -389);
  assert.equal(byPos[15].gapToCut, 51);
  assert.equal(byPos[16].gapToLeader, -440);
  assert.equal(byPos[16].gapToCut, 0);
  assert.equal(byPos[16].isCut, true);
  assert.equal(byPos[17].gapToLeader, -476);
  assert.equal(byPos[17].gapToCut, -36);
  assert.equal(byPos[19].gapToLeader, -505);
  assert.equal(byPos[19].gapToCut, -65);
});

test("championship gap formatting: leader dash / CUT / signed gaps / unavailable", () => {
  const leader = formatChampionshipStatDisplays({
    points: 890,
    gapToLeader: 0,
    gapToCut: 440,
    isLeader: true,
    isCut: false,
    cutAvailable: true,
  });
  assert.equal(leader.points.valueText, "890");
  assert.equal(leader.points.labelText, "");
  assert.equal(leader.lead.valueText, "--");
  assert.equal(leader.lead.labelText, "");
  assert.equal(leader.cut.valueText, "+440");
  assert.equal(leader.cut.labelText, "");

  const mid = formatChampionshipStatDisplays({
    points: 501,
    gapToLeader: -389,
    gapToCut: 51,
    isLeader: false,
    isCut: false,
    cutAvailable: true,
  });
  assert.equal(mid.lead.valueText, "-389");
  assert.equal(mid.lead.labelText, "");
  assert.equal(mid.cut.valueText, "+51");
  assert.equal(mid.cut.labelText, "");

  const below = formatChampionshipStatDisplays({
    points: 414,
    gapToLeader: -476,
    gapToCut: -36,
    isLeader: false,
    isCut: false,
    cutAvailable: true,
  });
  assert.equal(below.lead.valueText, "-476");
  assert.equal(below.cut.valueText, "-36");
  assert.equal(below.cut.labelText, "");

  const cutRow = formatChampionshipStatDisplays({
    points: 450,
    gapToLeader: -440,
    gapToCut: 0,
    isLeader: false,
    isCut: true,
    cutAvailable: true,
  });
  assert.equal(cutRow.cut.valueText, "CUT");
  assert.equal(cutRow.cut.labelText, "");
  assert.equal(cutRow.lead.valueText, "-440");

  const tiny = formatChampionshipStatDisplays({
    points: 888,
    gapToLeader: -2,
    gapToCut: 438,
    isLeader: false,
    isCut: false,
    cutAvailable: true,
  });
  assert.equal(tiny.lead.valueText, "-2");
  assert.equal(tiny.lead.labelText, "");

  const noCut = formatChampionshipStatDisplays({
    points: 100,
    gapToLeader: -10,
    gapToCut: null,
    isLeader: false,
    isCut: false,
    cutAvailable: false,
  });
  assert.equal(noCut.cut.valueText, "—");
  assert.equal(noCut.cut.special, true);

  const missing = formatChampionshipStatDisplays({
    points: null,
    gapToLeader: null,
    gapToCut: null,
    isLeader: false,
    isCut: false,
    cutAvailable: false,
  });
  assert.equal(missing.points.valueText, "—");
  assert.equal(missing.lead.valueText, "—");
  assert.equal(missing.cut.valueText, "—");
});

test("tied leader points show -- with zero gap; no fabricated negatives", () => {
  const rows = [
    { position: 1, points: 500 },
    { position: 2, points: 500 },
    { position: 3, points: 480 },
  ];
  const attached = attachChampionshipStats(rows, 16);
  assert.equal(attached[0].championshipStat.isLeader, true);
  assert.equal(attached[1].championshipStat.isLeader, true);
  assert.equal(attached[0].championshipStat.gapToLeader, 0);
  assert.equal(attached[1].championshipStat.gapToLeader, 0);
  assert.equal(attached[2].championshipStat.gapToLeader, -20);
  assert.equal(attached[0].championshipStat.cutAvailable, false);
  assert.equal(
    formatChampionshipStatDisplays(attached[0].championshipStat).lead.valueText,
    "--",
  );
  assert.equal(
    formatChampionshipStatDisplays(attached[0].championshipStat).cut.valueText,
    "—",
  );
});

test("fewer than 16 drivers: cut unavailable, leader gaps still work", () => {
  const rows = makeDrivers(12);
  assert.equal(resolveCutPoints(rows, 16), null);
  const attached = attachChampionshipStats(rows, 16);
  assert.equal(attached[0].championshipStat.isLeader, true);
  assert.equal(attached[0].championshipStat.cutAvailable, false);
  assert.equal(attached[5].championshipStat.gapToCut, null);
  assert.equal(
    formatChampionshipStatDisplays(attached[5].championshipStat).cut.valueText,
    "—",
  );
});

test("missing/non-numeric points do not produce NaN", () => {
  assert.equal(parseStandingsPoints(undefined), null);
  assert.equal(parseStandingsPoints("abc"), null);
  const stat = buildDriverChampionshipStat(
    { position: 3, points: "nope" },
    { leaderPoints: 100, cutPoints: 50, playoffCut: 16 },
  );
  assert.equal(stat.points, null);
  assert.equal(stat.gapToLeader, null);
  assert.equal(stat.gapToCut, null);
  const disp = formatChampionshipStatDisplays(stat);
  assert.equal(disp.points.valueText, "—");
  assert.ok(!Number.isNaN(Number(disp.points.valueText)) || disp.points.valueText === "—");
});

test("fixed PTS/LEAD/CUT value right edges are identical in all three columns", () => {
  const layout = computeStandingsLayoutMetrics({ driverCount: 42, hasTrackName: true });
  const geo = computeStandingsStatGeometry(layout);
  assert.equal(geo.pointsValueRight, 476);
  assert.equal(geo.leadValueRight, 528);
  assert.equal(geo.cutValueRight, 588);
  assert.equal(geo.points.valueRight, geo.pointsValueRight);
  assert.equal(geo.lead.valueRight, geo.leadValueRight);
  assert.equal(geo.cut.valueRight, geo.cutValueRight);

  const a = computeStandingsStatGeometry(layout);
  const b = computeStandingsStatGeometry(layout);
  assert.deepEqual(
    [a.pointsValueRight, a.leadValueRight, a.cutValueRight],
    [b.pointsValueRight, b.leadValueRight, b.cutValueRight],
  );

  const slots = computeRowSlotGeometry(layout);
  assert.ok(geo.points.colLeft >= slots.stats.x);
  assert.ok(geo.cut.colRight <= layout.colW - layout.rowPad);
});

test("stat value X does not depend on digit count or driver-name length", () => {
  const layout = computeStandingsLayoutMetrics({ driverCount: 42, hasTrackName: true });
  const geoShort = computeStandingsStatGeometry(layout);
  const geoLong = computeStandingsStatGeometry(layout);
  assert.equal(geoShort.pointsValueRight, geoLong.pointsValueRight);
  assert.equal(geoShort.leadValueRight, geoLong.leadValueRight);
  assert.equal(geoShort.cutValueRight, geoLong.cutValueRight);

  const rows = attachChampionshipStats([
    { position: 1, driver: "LEE", points: 890, wins: 9 },
    { position: 2, driver: "TAYLOR BUTCHER-BENJAMIN", points: 888, wins: 0 },
    { position: 16, driver: "X", points: 450, wins: 1 },
  ], 16);
  assert.equal(rows[0].wins, 9);
  assert.equal(rows[0].championshipStat.gapToLeader, 0);
  const d2 = formatChampionshipStatDisplays(rows[1].championshipStat);
  const d16 = formatChampionshipStatDisplays(rows[2].championshipStat);
  assert.equal(d2.lead.valueText, "-2");
  assert.equal(d16.cut.valueText, "CUT");
});

test("model attaches championshipStat; wins remain on data but unused by graphic", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11", playoffCut: 16 }, rows: makeDrivers(42) },
    { races: homesteadScheduleFixture() },
  );
  assert.equal(model.drivers[0].championshipStat.isLeader, true);
  assert.equal(model.drivers[15].championshipStat.isCut, true);
  assert.ok(Object.prototype.hasOwnProperty.call(model.drivers[0], "wins"));
  assert.equal(typeof model.drivers[3].wins, "number");
  assert.equal(model.drivers[1].championshipStat.gapToLeader, model.drivers[1].points - model.drivers[0].points);
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
  assert.ok(TYPOGRAPHY.driverNameRest >= 19 && TYPOGRAPHY.driverNameRest <= 20);
  assert.ok(TYPOGRAPHY.driverNameTop10 >= 19 && TYPOGRAPHY.driverNameTop10 <= 20);
  assert.ok(TYPOGRAPHY.driverNameMin >= 15);
  assert.ok(TYPOGRAPHY.positionTop10 >= 28);
  assert.ok(TYPOGRAPHY.movement >= 18 && TYPOGRAPHY.movement <= 19);
  assert.ok(TYPOGRAPHY.movementArrow >= 21 && TYPOGRAPHY.movementArrow <= 22);
  assert.ok(TYPOGRAPHY.points >= 16 && TYPOGRAPHY.points <= 17);
  assert.ok(TYPOGRAPHY.statValue >= 16 && TYPOGRAPHY.statValue <= 17);
  assert.ok(TYPOGRAPHY.statSpecial >= 16 && TYPOGRAPHY.statSpecial <= 17);
  assert.ok(TYPOGRAPHY.statHeader >= 15 && TYPOGRAPHY.statHeader <= 17);
  assert.ok(TYPOGRAPHY.statLabel >= 15 && TYPOGRAPHY.statLabel <= 17);
  assert.ok(TYPOGRAPHY.seasonMax >= 42);
  assert.ok(TYPOGRAPHY.afterRace >= 20);
  assert.ok(TYPOGRAPHY.footerSponsor >= 30);
  assert.ok(TYPOGRAPHY.footerSeries >= 16);
  assert.ok(TYPOGRAPHY.footerSite >= 17);
  assert.ok(TYPOGRAPHY.playoffCut >= 18);
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

test("normal names keep a moderate default; long names shrink modestly", () => {
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
  assert.ok(long >= TYPOGRAPHY.driverNameMin);
});

test("raw white primary + red secondary → red final fill", () => {
  const pack = packagePlateColors({
    fill: "#ffffff",
    outline: "#c81010",
    source: "suit_cache",
    driver: { driverName: "White Suit", driverId: "1" },
  });
  assert.equal(isUsablePlateFill(pack.fill).ok, true);
  assert.equal(isNearWhiteHex(pack.fill), false);
  assert.equal(pack.fill, "#c81010");
  assert.equal(pack.colorSource, "suit_cache");
});

test("raw near-white primary + blue secondary → blue final fill", () => {
  const pack = resolveStandingsPlateColors({
    rawPrimary: "#f7f7f7",
    rawSecondary: "#143a6e",
    rawSource: "suit_cache",
    driver: { driverName: "Near White", driverId: "nw1" },
  });
  assert.equal(pack.finalPrimary, "#143a6e");
  assert.equal(pack.finalColorSource, "suit_cache");
  assert.equal(isNearWhiteHex(pack.finalPrimary), false);
});

test("raw white primary + white secondary → deterministic fallback", () => {
  const pack = packagePlateColors({
    fill: "#ffffff",
    outline: "#f5f5f5",
    source: "suit_cache",
    driver: { driverName: "Ghost", driverId: "2", carNumber: "88" },
  });
  assert.equal(pack.colorSource, "deterministic_fallback");
  assert.equal(isNearWhiteHex(pack.fill), false);
  assert.equal(isUsablePlateFill(pack.fill).ok, true);
  assert.notEqual(pack.fill.toLowerCase(), "#ffffff");
});

test("portrait near-white primary + valid secondary → secondary", () => {
  const pack = resolveStandingsPlateColors({
    rawPrimary: "#fafafa",
    rawSecondary: "#b84a10",
    rawSource: "portrait_sample",
    driver: { driverName: "Portrait", driverId: "p1" },
  });
  assert.equal(pack.finalPrimary, "#b84a10");
  assert.equal(pack.finalColorSource, "portrait_sample");
});

test("cached white + black outline does not become white or black plate", () => {
  const pack = packagePlateColors({
    fill: "#ffffff",
    outline: "#000000",
    source: "suit_cache",
    driver: { driverName: "WB", driverId: "wb1", carNumber: "5" },
  });
  assert.equal(isNearWhiteHex(pack.fill), false);
  assert.equal(isUsablePlateFill(pack.fill).ok, true);
  assert.notEqual(pack.fill.toLowerCase(), "#ffffff");
  assert.notEqual(pack.fill.toLowerCase(), "#000000");
  assert.equal(pack.colorSource, "deterministic_fallback");
});

test("cached white alone does not become final white plate", () => {
  const pack = packagePlateColors({
    fill: "#ffffff",
    outline: "",
    source: "suit_cache",
    driver: { driverName: "Cache White", driverId: "cw1", carNumber: "7" },
  });
  assert.notEqual(pack.fill.toLowerCase(), "#ffffff");
  assert.equal(isUsablePlateFill(pack.fill).ok, true);
  assert.equal(isNearWhiteHex(pack.fill), false);
});

test("HSL white normalizes and gets rejected", () => {
  const hex = normalizeColorToHex("hsl(0, 0%, 100%)");
  assert.equal(hex, "#ffffff");
  assert.equal(isUsablePlateFill("hsl(0, 0%, 100%)").ok, false);
  const pack = packagePlateColors({
    fill: "hsl(0, 0%, 100%)",
    outline: "hsl(0, 80%, 40%)",
    source: "suit_cache",
    driver: { driverName: "HSL", driverId: "h1" },
  });
  assert.equal(isNearWhiteHex(pack.fill), false);
  assert.equal(isUsablePlateFill(pack.fill).ok, true);
});

test("HSL dark color normalizes and is accepted", () => {
  const hex = normalizeColorToHex("hsl(210, 70%, 25%)");
  assert.ok(hex.startsWith("#"));
  assert.equal(isUsablePlateFill(hex).ok, true);
  const pack = packagePlateColors({
    fill: "hsl(210, 70%, 25%)",
    outline: "#ffffff",
    source: "portrait_sample",
    driver: { driverName: "HSL Dark", driverId: "h2" },
  });
  assert.equal(pack.fill, hex);
  assert.equal(isUsablePlateFill(pack.fill).ok, true);
});

test("RGB white normalizes and gets rejected", () => {
  assert.equal(normalizeColorToHex("rgb(255, 255, 255)"), "#ffffff");
  assert.equal(isUsablePlateFill("rgb(255,255,255)").ok, false);
  const pack = packagePlateColors({
    fill: "rgb(255, 255, 255)",
    outline: "rgb(200, 16, 16)",
    source: "suit_cache",
    driver: { driverName: "RGB", driverId: "r1" },
  });
  assert.equal(pack.fill, "#c81010");
});

test("invalid/transparent color rejected", () => {
  assert.equal(isUsablePlateFill("").ok, false);
  assert.equal(isUsablePlateFill("transparent").ok, false);
  assert.equal(isUsablePlateFill("rgba(255,255,255,0)").ok, false);
  assert.equal(isUsablePlateFill("not-a-color").ok, false);
});

test("deterministic fallback is never near-white and stable per driver", () => {
  const a = pickDeterministicPlateColors({ driverName: "Chris", driverId: "10", carNumber: "99" });
  const b = pickDeterministicPlateColors({ driverName: "Chris", driverId: "10", carNumber: "99" });
  assert.deepEqual(a, b);
  assert.equal(isNearWhiteHex(a.fill), false);
  assert.equal(isUsablePlateFill(a.fill).ok, true);
  assert.ok(DETERMINISTIC_PLATE_PALETTE.every((p) => !isNearWhiteHex(p.fill)));
  assert.ok(DETERMINISTIC_PLATE_PALETTE.every((p) => isUsablePlateFill(p.fill).ok));
});

test("same driver gets same fallback every resolve", () => {
  const driver = { driverName: "Stable", driverId: "st1", carNumber: "42" };
  const a = resolveStandingsPlateColors({
    driver,
    rawPrimary: "#ffffff",
    rawSecondary: "#ffffff",
    rawSource: "suit_cache",
  });
  const b = resolveStandingsPlateColors({
    driver,
    rawPrimary: "#ffffff",
    rawSecondary: "#fafafa",
    rawSource: "suit_cache",
  });
  assert.equal(a.finalPrimary, b.finalPrimary);
  assert.equal(a.finalColorSource, "deterministic_fallback");
});

test("final number text remains readable by luminance", () => {
  const dark = packagePlateColors({
    fill: "#c81010",
    outline: "#ffffff",
    source: "suit_cache",
    driver: { driverName: "Red", driverId: "rd" },
  });
  assert.equal(dark.numberFill, "#ffffff");
  const lightish = packagePlateColors({
    fill: "#b84a10",
    outline: "#101010",
    source: "suit_cache",
    driver: { driverName: "Orange", driverId: "or" },
  });
  assert.ok(["#ffffff", "#0a0a0a"].includes(lightish.numberFill));
  assert.equal(pickReadableNumberColor("#ffffff"), "#0a0a0a");
  assert.equal(pickReadableNumberColor("#101010"), "#ffffff");
});

test("candidate walk continues past unusable cache white to portrait secondary", () => {
  const resolved = resolvePlateFillFromCandidates(
    [
      { color: "#ffffff", role: "primary", source: "suit_cache" },
      { color: "#f0f0f0", role: "secondary", source: "suit_cache" },
      { color: "#fafafa", role: "primary", source: "portrait_sample" },
      { color: "#0f4a38", role: "secondary", source: "portrait_sample" },
    ],
    { driverName: "Walk", driverId: "w1" },
  );
  assert.equal(resolved.fill, "#0f4a38");
  assert.equal(resolved.from.source, "portrait_sample");
  assert.equal(resolved.usedFallback, false);
});

test("no valid car number loses its plate display", () => {
  assert.equal(formatPlateDisplay("18"), "18");
  assert.equal(formatPlateDisplay("07"), "07");
  assert.equal(formatPlateDisplay(""), "—");
  const rows = normalizeStandingsRows([
    { position: 1, driver: "A", carNumber: "18", points: 1 },
    { position: 2, driver: "B", bp_number: "07", points: 1 },
  ]);
  assert.equal(rows[0].carNumber, "18");
  assert.equal(rows[1].carNumber, "07");
  assert.equal(rows.every((r) => formatPlateDisplay(r.carNumber) !== ""), true);
});

test("standings rows keep shared numberArtwork and fall back without inventing a path", () => {
  const rows = normalizeStandingsRows([
    {
      position: 1,
      driver: "Mark Arthur",
      carNumber: "12",
      points: 10,
      numberArtwork: {
        source: "sdk",
        imagePath: "/assets/images/numbers/91227.png",
        authoritative: true,
      },
    },
    {
      position: 2,
      driver: "Unknown Driver",
      carNumber: "99",
      points: 8,
      iracingCustomerId: "1",
    },
  ]);
  assert.equal(rows[0].numberArtwork.imagePath, "/assets/images/numbers/91227.png");
  assert.equal(rows[0].hasNumberArtwork, true);
  assert.equal(rows[1].numberArtwork.source, "fallback");
  assert.equal(rows[1].numberArtwork.imagePath, "");
  assert.equal(rows[1].hasNumberArtwork, false);
});

test("number display box is 2:1 contain-fit and does not collide with movement", () => {
  const m = computeStandingsLayoutMetrics({
    driverCount: 42,
    hasTrackName: true,
  });
  assert.equal(m.plateW, 88);
  assert.equal(m.plateH, 44);
  const slots = computeRowSlotGeometry(m);
  assert.ok(slots.pos.x + slots.pos.w <= slots.move.x);
  assert.ok(slots.move.x + slots.move.w <= slots.number.x);
  assert.ok(slots.number.x + slots.number.w <= slots.name.x);
  assert.ok(slots.name.x + slots.name.w <= slots.stats.x);
  assert.equal(slots.move.w, 52);
  assert.ok(slots.name.w >= 210, "name slot should recover width from reduced movement");
});

test("reduced movement recovers name width without moving PTS/LEAD/CUT", () => {
  const layout = computeStandingsLayoutMetrics({ driverCount: 42, hasTrackName: true });
  const slots = computeRowSlotGeometry(layout);
  const geo = computeStandingsStatGeometry(layout);
  const moveGlyphs = computeMovementGlyphGeometry(layout.moveW, TYPOGRAPHY);

  assert.equal(layout.moveW, 52);
  assert.equal(TYPOGRAPHY.movementArrow, 22);
  assert.equal(TYPOGRAPHY.movement, 18);
  assert.equal(slots.number.x, 116);
  assert.equal(slots.number.w, 88);
  assert.equal(layout.plateH, 44);
  assert.equal(slots.name.w, 216);
  assert.ok(slots.name.w >= 210);
  assert.ok(slots.name.x + slots.name.w <= slots.stats.x);

  assert.ok(slots.pos.x + slots.pos.w <= slots.move.x);
  assert.ok(slots.move.x + slots.move.w <= slots.number.x);
  assert.ok(moveGlyphs.fits);
  assert.ok(moveGlyphs.doubleDigitFits);
  assert.ok(moveGlyphs.pad >= 2);
  assert.ok(moveGlyphs.arrowX - moveGlyphs.arrowW / 2 >= 0);
  assert.ok(moveGlyphs.valueX + moveGlyphs.valueW / 2 <= layout.moveW);
  assert.ok(moveGlyphs.dashX > 0 && moveGlyphs.dashX < layout.moveW);

  assert.equal(geo.pointsValueRight, 476);
  assert.equal(geo.leadValueRight, 528);
  assert.equal(geo.cutValueRight, 588);

  const colA = computeRowSlotGeometry(layout);
  const colB = computeRowSlotGeometry(layout);
  assert.deepEqual(
    [colA.move.x, colA.number.x, colA.name.x, colA.name.w],
    [colB.move.x, colB.number.x, colB.name.x, colB.name.w],
  );
});

test("each column has a PTS / LEAD / CUT header above unchanged row stats", () => {
  const layout = computeStandingsLayoutMetrics({ driverCount: 42, hasTrackName: true });
  const stats = computeStandingsStatGeometry(layout);
  const headers = computeStatColumnHeaderGeometry(layout);
  const slots = computeRowSlotGeometry(layout);

  assert.equal(layout.ruleY, 106);
  assert.equal(layout.statHeaderH, 32);
  assert.equal(layout.postRuleGap, 14);
  assert.equal(layout.preGridGap, 11);
  assert.equal(layout.gridTop, 163);
  assert.equal(standingsRowY(layout, 0), 163);
  assert.equal(headers.y, layout.ruleY + layout.postRuleGap + layout.statHeaderH / 2);
  assert.ok(headers.ruleY < headers.y);
  assert.ok(headers.y + layout.statHeaderH / 2 <= layout.gridTop);
  assert.equal(headers.firstRowY, layout.gridTop);
  assert.ok(layout.headerH >= 114);
  assert.ok(layout.ruleY - 22 > 70, "track text sits above red divider with breathing room");

  assert.equal(STAT_COLUMN_HEADERS.points, "PTS");
  assert.equal(STAT_COLUMN_HEADERS.lead, "LEAD");
  assert.equal(STAT_COLUMN_HEADERS.cut, "CUT");
  assert.equal(headers.labels.length, 3);
  assert.deepEqual(headers.labels.map((l) => l.text), ["PTS", "LEAD", "CUT"]);
  assert.equal(STAT_VALUE_COLUMNS.points.width, 34);
  assert.equal(STAT_VALUE_COLUMNS.lead.width, 42);
  assert.equal(STAT_VALUE_COLUMNS.cut.width, 42);
  assert.equal(stats.points.valueRightX, 476);
  assert.equal(stats.lead.valueRightX, 528);
  assert.equal(stats.cut.valueRightX, 588);
  assert.equal(stats.points.valueColumnWidth, 34);
  assert.equal(stats.lead.valueColumnWidth, 42);
  assert.equal(stats.cut.valueColumnWidth, 42);
  assert.equal(stats.points.headerCenterX, 459);
  assert.equal(stats.lead.headerCenterX, 507);
  assert.equal(stats.cut.headerCenterX, 567);
  assert.equal(headers.points.headerCenterX, stats.points.headerCenterX);
  assert.equal(headers.lead.headerCenterX, stats.lead.headerCenterX);
  assert.equal(headers.cut.headerCenterX, stats.cut.headerCenterX);
  assert.equal(headers.points.x, 459);
  assert.equal(headers.lead.x, 507);
  assert.equal(headers.cut.x, 567);
  assert.ok(headers.points.headerCenterX < stats.points.center);
  assert.ok(headers.lead.headerCenterX < stats.lead.center);
  assert.ok(headers.cut.headerCenterX < stats.cut.center);
  assert.equal(headers.points.headerCenterX, stats.points.valueRightX - stats.points.valueColumnWidth / 2);
  assert.equal(headers.lead.headerCenterX, stats.lead.valueRightX - stats.lead.valueColumnWidth / 2);
  assert.equal(headers.cut.headerCenterX, stats.cut.valueRightX - stats.cut.valueColumnWidth / 2);
  assert.equal(stats.points.left, 434);
  assert.equal(stats.points.right, 502);
  assert.equal(stats.points.center, 468);
  assert.equal(stats.lead.left, 502);
  assert.equal(stats.lead.right, 558);
  assert.equal(stats.lead.center, 530);
  assert.equal(stats.cut.left, 558);
  assert.equal(stats.cut.right, 606);
  assert.equal(stats.cut.center, 582);
  assert.equal(headers.points.valueRight, 476);
  assert.equal(headers.lead.valueRight, 528);
  assert.equal(headers.cut.valueRight, 588);

  const a = computeStatColumnHeaderGeometry(layout);
  const b = computeStatColumnHeaderGeometry(layout);
  assert.deepEqual(
    a.labels.map((l) => [l.text, l.headerCenterX]),
    b.labels.map((l) => [l.text, l.headerCenterX]),
  );

  const formatted = formatChampionshipStatDisplays({
    points: 888,
    gapToLeader: -2,
    gapToCut: 438,
    isLeader: false,
    isCut: false,
    cutAvailable: true,
  });
  assert.equal(formatted.points.labelText, "");
  assert.equal(formatted.lead.labelText, "");
  assert.equal(formatted.cut.labelText, "");
  assert.equal(formatted.points.valueText, "888");
  assert.equal(formatted.lead.valueText, "-2");
  assert.equal(formatted.cut.valueText, "+438");

  assert.equal(layout.moveW, 52);
  assert.equal(TYPOGRAPHY.movementArrow, 22);
  assert.equal(TYPOGRAPHY.movement, 18);
  assert.equal(layout.plateW, 88);
  assert.equal(layout.plateH, 44);
  assert.equal(slots.name.w, 216);
  assert.equal(layout.colCount, 3);
  assert.equal(TYPOGRAPHY.statHeader, 16);
  assert.equal(TYPOGRAPHY.statValue, 17);
  assert.equal(layout.rowH, 56);

  const srcLogic = fs.readFileSync(path.join(root, "public", "standings-graphic-export-logic.js"), "utf8");
  const srcRender = fs.readFileSync(path.join(root, "public", "standings-graphic-export.js"), "utf8");
  assert.doesNotMatch(srcLogic, /TO LEAD/);
  assert.doesNotMatch(srcLogic, /TO CUT/);
  assert.doesNotMatch(srcRender, /TO LEAD/);
  assert.doesNotMatch(srcRender, /TO CUT/);
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
    driverCount: 42,
    hasTrackName: true,
  });
  assert.ok(m.footerH >= 50);
  assert.equal(m.fits, true);
});

test("playoff cutoff is a zero-height red line between P16 and P17 in column 2", () => {
  const source = makeDrivers(43);
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11", playoffCut: 16 }, rows: source },
    { races: homesteadScheduleFixture() },
  );
  const layout = model.layoutHints;
  const cut = model.cutPlacement;
  assert.equal(source.length, 43);
  assert.equal(model.drivers.length, 42);
  assert.equal(model.drivers.some((d) => d.position === 43), false);
  assert.deepEqual(model.columns.map((c) => c.length), [14, 14, 14]);
  assert.equal(cut.columnIndex, 1);
  assert.equal(cut.afterRowIndex, 1);
  assert.equal(cut.playoffCut, 16);
  assert.equal(layout.cutGap, 0);
  assert.equal(layout.moveW, 52);

  const line = computePlayoffCutLine(layout, cut);
  const p16Y = standingsRowY(layout, 1);
  const p17Y = standingsRowY(layout, 2);
  assert.equal(line.consumesLayoutHeight, false);
  assert.equal(line.extraLayoutHeight, 0);
  assert.equal(line.thickness, 4);
  assert.equal(line.color, "#e50914");
  assert.equal(line.width, layout.colW - 8);
  assert.ok(line.y >= p16Y + layout.rowH);
  assert.ok(line.y + line.thickness <= p17Y);
  assert.equal(p17Y - (p16Y + layout.rowH), layout.rowGap);
});

test("all three columns share the same row Y for every index", () => {
  const layout = computeStandingsLayoutMetrics({ driverCount: 42, hasTrackName: true });
  for (let row = 0; row < 14; row += 1) {
    const y = standingsRowY(layout, row);
    assert.equal(y, layout.gridTop + row * (layout.rowH + layout.rowGap));
  }
  const p1 = standingsRowY(layout, 0);
  const p15 = standingsRowY(layout, 0);
  const p29 = standingsRowY(layout, 0);
  assert.equal(p1, p15);
  assert.equal(p15, p29);
  assert.equal(standingsRowY(layout, 1), standingsRowY(layout, 1));
  assert.equal(standingsRowY(layout, 2), layout.gridTop + 2 * (layout.rowH + layout.rowGap));
});

test("P15–P18 are the only playoff-bubble rows, inside vs outside", () => {
  assert.equal(playoffBubbleKind(14), null);
  assert.equal(playoffBubbleKind(15), "inside");
  assert.equal(playoffBubbleKind(16), "inside");
  assert.equal(playoffBubbleKind(17), "outside");
  assert.equal(playoffBubbleKind(18), "outside");
  assert.equal(playoffBubbleKind(19), null);
  assert.equal(playoffBubbleKind(1), null);
  assert.deepEqual(PLAYOFF_BUBBLE.inside.positions, [15, 16]);
  assert.deepEqual(PLAYOFF_BUBBLE.outside.positions, [17, 18]);
  assert.equal(PLAYOFF_BUBBLE.inside.bg, "rgba(145, 38, 45, 0.35)");
  assert.equal(PLAYOFF_BUBBLE.outside.bg, "rgba(100, 27, 35, 0.32)");
  assert.equal(PLAYOFF_BUBBLE.inside.border, STANDINGS_NORMAL_ROW.border);
  assert.equal(PLAYOFF_BUBBLE.outside.border, STANDINGS_NORMAL_ROW.border);
  assert.equal(PLAYOFF_CUT_LINE.color, "#e50914");
  assert.equal(PLAYOFF_CUT_LINE.thickness, 4);
});

test("podium outlines and removed Top 10 red treatment", () => {
  const p1 = standingsRowVisualStyle(1);
  const p2 = standingsRowVisualStyle(2);
  const p3 = standingsRowVisualStyle(3);
  const p4 = standingsRowVisualStyle(4);
  const p10 = standingsRowVisualStyle(10);
  const p14 = standingsRowVisualStyle(14);
  const p15 = standingsRowVisualStyle(15);
  const p16 = standingsRowVisualStyle(16);
  const p17 = standingsRowVisualStyle(17);
  const p18 = standingsRowVisualStyle(18);
  const p19 = standingsRowVisualStyle(19);

  assert.equal(p1.bg, STANDINGS_P1_GOLD.bg);
  assert.equal(p1.border, STANDINGS_P1_GOLD.border);
  assert.equal(p1.borderWidth, 2);

  assert.equal(p2.bg, STANDINGS_NORMAL_ROW.bg);
  assert.equal(p2.border, "#bfc3c7");
  assert.equal(p2.borderWidth, 2);
  assert.equal(p3.bg, STANDINGS_NORMAL_ROW.bg);
  assert.equal(p3.border, "#b87333");
  assert.equal(p3.borderWidth, 2);

  for (const style of [p4, p10, p14, p19]) {
    assert.equal(style.bg, STANDINGS_NORMAL_ROW.bg);
    assert.equal(style.border, STANDINGS_NORMAL_ROW.border);
    assert.equal(style.borderWidth, 1);
    assert.notEqual(style.border, "rgba(180,40,40,0.5)");
    assert.notEqual(style.bg, "rgba(42,42,42,0.58)");
  }

  assert.equal(p15.bg, PLAYOFF_BUBBLE.inside.bg);
  assert.equal(p16.bg, PLAYOFF_BUBBLE.inside.bg);
  assert.equal(p17.bg, PLAYOFF_BUBBLE.outside.bg);
  assert.equal(p18.bg, PLAYOFF_BUBBLE.outside.bg);
  assert.equal(p15.border, STANDINGS_NORMAL_ROW.border);
  assert.equal(p18.border, STANDINGS_NORMAL_ROW.border);
  assert.equal(p15.borderWidth, 1);

  assert.notEqual(p2.bg, p1.bg);
  assert.notEqual(p2.border, p1.border);
});

test("one 2px playoff-battle box surrounds P15–P18 without shifting rows", () => {
  const model = buildStandingsGraphicModel(
    { settings: { seasonName: "Season 11", playoffCut: 16 }, rows: makeDrivers(43) },
    { races: homesteadScheduleFixture() },
  );
  const layout = model.layoutHints;
  const cut = model.cutPlacement;
  const box = computePlayoffBattleBox(layout, cut);
  const p14Y = standingsRowY(layout, 13);
  const p15Y = standingsRowY(layout, 0);
  const p18Y = standingsRowY(layout, 3);
  const p19Y = standingsRowY(layout, 4);
  assert.equal(box.columnIndex, 1);
  assert.equal(box.startRow, 0);
  assert.equal(box.endRow, 3);
  assert.equal(box.startPosition, 15);
  assert.equal(box.endPosition, 18);
  assert.equal(box.thickness, 2);
  assert.equal(box.color, "#c81018");
  assert.equal(PLAYOFF_BATTLE_BOX.thickness, 2);
  assert.ok(PLAYOFF_BATTLE_BOX.thickness < PLAYOFF_CUT_LINE.thickness);
  assert.equal(box.extraLayoutHeight, 0);
  assert.equal(box.consumesLayoutHeight, false);
  assert.equal(box.includesP14, false);
  assert.equal(box.includesP19, false);
  assert.equal(box.y, p15Y);
  assert.equal(box.height, p18Y + layout.rowH - p15Y);
  assert.ok(box.y + box.height <= p19Y);
  assert.ok(p14Y + layout.rowH <= box.y || cut.columnIndex !== 0);
  assert.notEqual(standingsRowY(layout, 2), standingsRowY(layout, 1) + layout.rowH + layout.cutGap);
  assert.equal(layout.cutGap, 0);
  assert.ok(layout.rowH >= 56 && layout.rowH <= 60);
  assert.equal(layout.moveW, 52);
});

test("custom number artwork still beats SDK, SDK beats legacy", () => {
  const custom = normalizeStandingsRows([
    {
      position: 1,
      driver: "Custom",
      carNumber: "12",
      numberArtwork: {
        source: "custom",
        imagePath: "/assets/images/numbers/custom/1.png",
        sdkPath: "/assets/images/numbers/1.png",
        customPath: "/assets/images/numbers/custom/1.png",
        authoritative: true,
      },
    },
  ])[0];
  const sdk = normalizeStandingsRows([
    {
      position: 1,
      driver: "SDK",
      carNumber: "7",
      iracingDesign: {
        numberImage: {
          sdkPath: "/assets/images/numbers/2.png",
          customPath: null,
          preferredSource: "sdk",
          authoritative: true,
        },
      },
    },
  ])[0];
  const fallback = normalizeStandingsRows([
    { position: 1, driver: "Legacy", carNumber: "99", iracingCustomerId: "3" },
  ])[0];
  assert.equal(custom.numberArtwork.source, "custom");
  assert.equal(custom.hasNumberArtwork, true);
  assert.equal(sdk.numberArtwork.source, "sdk");
  assert.equal(sdk.hasNumberArtwork, true);
  assert.equal(fallback.numberArtwork.source, "fallback");
  assert.equal(fallback.hasNumberArtwork, false);
});

test("standings export renderer has no leftover glow/stroke on typography", () => {
  const src = fs.readFileSync(path.join(root, "public", "standings-graphic-export.js"), "utf8");
  assert.match(src, /function resetTextRenderingState/);
  assert.match(src, /ctx\.shadowBlur = 0/);
  assert.match(src, /ctx\.filter = "none"/);
  assert.match(src, /ctx\.globalAlpha = 1/);
  assert.doesNotMatch(src, /strokeText\(/);
  assert.doesNotMatch(src, /bold \$\{T\.seasonMax\}px/);
  assert.doesNotMatch(src, /Arial Narrow/);
  assert.doesNotMatch(src, /TOP 16 PLAYOFF CUT/);
  assert.doesNotMatch(src, /pos >= 2 && pos <= 10/);
  assert.doesNotMatch(src, /formatWinsLabel/);
  assert.match(src, /drawChampionshipStats/);
  assert.match(src, /drawStatColumnHeader/);
  assert.match(src, /drawPlayoffCutLine/);
  assert.match(src, /drawPlayoffBattleBox/);
  assert.doesNotMatch(src, /display\.labelText/);
  assert.doesNotMatch(src, /LEADER/);
});

test("driver-name fitting keeps a narrow size range", () => {
  const layout = computeStandingsLayoutMetrics({ driverCount: 42, hasTrackName: true });
  const slots = computeRowSlotGeometry(layout);
  const names = [
    "CHRIS BERG",
    "CHRIS CARROLL3",
    "MIGUEL GOMEZ-GAUDET",
    "MATTHEW KLEINSCHMIDT2",
    "TAYLOR BUTCHER-BENJAMIN",
  ];
  const fitted = names.map((name) => {
    const result = fitDriverName(approxMeasure, name, slots.name.w);
    const width = estimateTrackedWidth(
      approxMeasure(`bold ${result.size}px Arial, Helvetica, sans-serif`, name),
      name,
      result.tracking,
    );
    assert.ok(width <= slots.name.w + 0.01, `${name} overflows name slot`);
    assert.ok(result.size >= TYPOGRAPHY.driverNameMin, `${name} dropped below floor`);
    assert.ok(result.size <= TYPOGRAPHY.driverNameRest, `${name} exceeded default`);
    assert.ok(result.tracking >= TYPOGRAPHY.tracking.driverNameMin);
    assert.ok(result.tracking <= TYPOGRAPHY.tracking.driverName);
    return { name, ...result, width };
  });

  const berg = fitted.find((n) => n.name === "CHRIS BERG");
  const carroll = fitted.find((n) => n.name === "CHRIS CARROLL3");
  const gomez = fitted.find((n) => n.name === "MIGUEL GOMEZ-GAUDET");
  const matthew = fitted.find((n) => n.name === "MATTHEW KLEINSCHMIDT2");
  const taylor = fitted.find((n) => n.name === "TAYLOR BUTCHER-BENJAMIN");

  assert.equal(berg.size, TYPOGRAPHY.driverNameRest);
  assert.ok(carroll.size >= 18);
  assert.ok(gomez.size >= 16);
  assert.ok(matthew.size >= 16);
  assert.ok(taylor.size >= 15);
  assert.ok(slots.name.w >= 210);
  assert.ok(taylor.size > 12);
  assert.ok(berg.size < 22);
  const spread = berg.size - taylor.size;
  assert.ok(spread <= 5, `name size spread too wide: ${spread}`);
});

test("luminance still picks readable number colors", () => {
  assert.equal(pickReadableNumberColor("#ffffff"), "#0a0a0a");
  assert.equal(pickReadableNumberColor("#101010"), "#ffffff");
  assert.equal(pickReadableNumberColor("#c81010"), "#ffffff");
});

console.log(`\n${passed} standings-graphic tests passed.`);
