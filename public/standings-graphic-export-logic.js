/**
 * Pure standings-graphic helpers (no Canvas / DOM).
 * Shared by the browser export and Node regression tests.
 */

export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;
export const RENDER_SCALE = 2;
export const OUTPUT_WIDTH = LOGICAL_WIDTH * RENDER_SCALE; // 3840
export const OUTPUT_HEIGHT = LOGICAL_HEIGHT * RENDER_SCALE; // 2160
export const MAX_DRIVERS = 43;
export const DEFAULT_PLAYOFF_CUT = 16;
export const DEFAULT_SEASON_NAME = "Season 11";
export const SPONSOR_NAME = "OHIO & INDIANA ROOFING";
export const SPONSOR_LOGO_CANDIDATES = [
  "/assets/sponsors/OIRoofing_Logo_White_Transparent.png",
  "/assets/sponsors/oi-roofing-logo.png",
];
export const SITE_URL = "blazingpedalsracing.com";
export const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

/** Column sizes: P1–15 / P16–29 / P30–43 */
export const COLUMN_SIZES = [15, 14, 14];

export function isNonPointsRace(race) {
  const points = String(race?.points ?? "").trim().toLowerCase();
  const status = String(race?.status ?? "").trim().toLowerCase();
  if (points === "no" || status === "non-points") return true;
  return NON_POINTS_LABEL_PATTERN.test(String(race?.track ?? ""));
}

/**
 * Sequential official points-race numbering (excludes duel/non-points).
 * Completed = non-empty winner text (matches schedule scrape convention).
 */
export function resolveLatestCompletedPointsRaceNumber(races) {
  let pointsOrdinal = 0;
  let latest = null;
  for (const race of races || []) {
    if (isNonPointsRace(race)) continue;
    pointsOrdinal += 1;
    if (String(race?.winner || "").trim()) latest = pointsOrdinal;
  }
  return latest;
}

/**
 * Prefer authoritative schedule API fields, then fall back to raw race list.
 */
export function resolvePointsRaceNumberFromSchedule(scheduleData = {}) {
  const fromResults = Number(scheduleData?.raceResults?.latestCompletedRaceNumber);
  if (Number.isInteger(fromResults) && fromResults >= 1) return fromResults;

  const fromProgression = Number(scheduleData?.raceProgression?.effectiveCompletedPointsCount);
  if (Number.isInteger(fromProgression) && fromProgression >= 1) return fromProgression;

  return resolveLatestCompletedPointsRaceNumber(scheduleData?.races || []);
}

export function parseSeasonNumber(seasonName) {
  const match = String(seasonName || DEFAULT_SEASON_NAME).match(/(\d+)/);
  if (!match) return 11;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : 11;
}

export function formatSeasonHeading(seasonName) {
  const n = parseSeasonNumber(seasonName);
  return `SEASON ${n} STANDINGS`;
}

export function formatAfterRaceLine(pointsRaceNumber) {
  const n = Number(pointsRaceNumber);
  if (!Number.isInteger(n) || n < 1) return "CURRENT STANDINGS";
  return `AFTER RACE ${n}`;
}

export function buildStandingsGraphicFilename({ seasonName, pointsRaceNumber }) {
  const season = parseSeasonNumber(seasonName);
  const race = Number(pointsRaceNumber);
  const racePart = Number.isInteger(race) && race >= 1 ? `R${race}` : "R0";
  return `BP-S${season}-${racePart}-Standings.png`;
}

/**
 * Normalize API / client standings rows into a stable export shape.
 * Preserves incoming order (authoritative standings order).
 */
export function normalizeStandingsRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const position = Number(row.position ?? row.place ?? index + 1);
    const points = Number(row.points ?? 0);
    const wins = Number(row.wins ?? 0);
    const carNumber = String(row.carNumber ?? row.bp_number ?? row.standingsCarNumber ?? "").trim();
    const driverName = String(row.driver ?? row.driverName ?? "").trim() || "Unknown Driver";
    return {
      position: Number.isFinite(position) && position > 0 ? position : index + 1,
      driverName,
      carNumber,
      points: Number.isFinite(points) ? points : 0,
      wins: Number.isFinite(wins) ? wins : 0,
      driverId: row.driverId != null ? String(row.driverId) : "",
    };
  });
}

export function takeTopDrivers(rows, max = MAX_DRIVERS) {
  const limit = Math.max(0, Number(max) || MAX_DRIVERS);
  return normalizeStandingsRows(rows).slice(0, limit);
}

/**
 * Split drivers into three columns using COLUMN_SIZES.
 * Truncates empty trailing columns when fewer drivers exist.
 */
export function distributeColumns(drivers, sizes = COLUMN_SIZES) {
  const list = Array.isArray(drivers) ? drivers : [];
  const columns = [];
  let cursor = 0;
  for (const size of sizes) {
    const slice = list.slice(cursor, cursor + size);
    columns.push(slice);
    cursor += size;
    if (cursor >= list.length) break;
  }
  while (columns.length < sizes.length) columns.push([]);
  return columns.slice(0, sizes.length);
}

/**
 * Playoff cut is drawn AFTER position `playoffCut` (default 16).
 * Returns column/row indices for the divider (between cut and cut+1).
 */
export function findPlayoffCutPlacement(drivers, playoffCut = DEFAULT_PLAYOFF_CUT) {
  const cut = Number(playoffCut) || DEFAULT_PLAYOFF_CUT;
  const list = Array.isArray(drivers) ? drivers : [];
  if (list.length <= cut) return null;

  const cutDriver = list.find((d) => Number(d.position) === cut) || list[cut - 1];
  if (!cutDriver) return null;

  const columns = distributeColumns(list);
  for (let col = 0; col < columns.length; col += 1) {
    const rows = columns[col];
    const idx = rows.findIndex((d) => d === cutDriver || Number(d.position) === Number(cutDriver.position));
    if (idx >= 0) {
      return {
        playoffCut: cut,
        columnIndex: col,
        afterRowIndex: idx,
        label: `TOP ${cut} PLAYOFF CUT`,
      };
    }
  }
  return null;
}

export function formatWinsLabel(wins) {
  const n = Number(wins) || 0;
  return n === 1 ? "1 WIN" : `${n} WINS`;
}

export function formatPointsLabel(points) {
  const n = Number(points) || 0;
  return `${n} PTS`;
}

/**
 * Shrink font until text fits maxWidth (inclusive of minSize).
 * measureFn(fontCss, text) => width
 */
export function fitTextFontSize(measureFn, text, maxWidth, {
  fontFamily = "Arial, sans-serif",
  fontWeight = "bold",
  maxSize = 22,
  minSize = 11,
} = {}) {
  const value = String(text || "");
  let size = maxSize;
  while (size > minSize) {
    const font = `${fontWeight} ${size}px ${fontFamily}`;
    if (measureFn(font, value) <= maxWidth) return size;
    size -= 1;
  }
  return minSize;
}

/** Plate digit font size for fixed plate width. */
export function plateNumberFontSize(carNumber, { maxSize = 20, minSize = 12 } = {}) {
  const digits = String(carNumber || "").replace(/\D/g, "").length || 1;
  if (digits <= 1) return maxSize;
  if (digits === 2) return Math.max(minSize, maxSize - 2);
  return Math.max(minSize, maxSize - 6);
}

export function resolvePlayoffCut(settings = {}) {
  const n = Number(settings?.playoffCut);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PLAYOFF_CUT;
}

export function buildSponsorFooterText({ hasLogo } = {}) {
  if (hasLogo) {
    return {
      presentedBy: "PRESENTED BY",
      sponsorLine: null,
      siteUrl: SITE_URL,
      useLogo: true,
    };
  }
  return {
    presentedBy: "PRESENTED BY",
    sponsorLine: SPONSOR_NAME,
    siteUrl: SITE_URL,
    useLogo: false,
  };
}

export function validateOutputDimensions(width, height) {
  return Number(width) === OUTPUT_WIDTH && Number(height) === OUTPUT_HEIGHT;
}
