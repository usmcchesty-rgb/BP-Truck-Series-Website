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
export const SITE_URL = "blazingpedalsracing.com";
export const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

/** Top 16 playoff field stays together in column 1. */
export const COLUMN_SIZES = [16, 14, 13];

export const DEFAULT_PLATE = {
  fill: "#1a1a1e",
  outline: "#d0d0d4",
  keyline: "#c81010",
  numberFill: "#ffffff",
};

export function isNonPointsRace(race) {
  if (race?.nonPoints === true) return true;
  const points = String(race?.points ?? "").trim().toLowerCase();
  const status = String(race?.status ?? "").trim().toLowerCase();
  if (points === "no" || status === "non-points") return true;
  if (points && points !== "yes") return true;
  return NON_POINTS_LABEL_PATTERN.test(String(race?.track ?? race?.trackName ?? ""));
}

export function sanitizeTrackName(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^(undefined|null|n\/?a|—|-–—)$/i.test(raw)) return "";
  return raw;
}

/**
 * Client-side enrich matching api/_schedule-points-races.js / transcript helpers.
 * Assigns officialPointsRaceNumber; never treats scheduleRow as the official number.
 */
export function enrichClientScheduleRaces(rawRaces) {
  let officialPointsRaceNumber = 0;
  return (rawRaces || []).map((race) => {
    const scheduleRow = Number(race?.scheduleRow ?? race?.raceNumber);
    const nonPoints = isNonPointsRace(race);
    if (nonPoints) {
      return {
        ...race,
        scheduleRow: Number.isFinite(scheduleRow) && scheduleRow > 0 ? scheduleRow : null,
        nonPoints: true,
        officialPointsRaceNumber: null,
      };
    }
    officialPointsRaceNumber += 1;
    return {
      ...race,
      scheduleRow: Number.isFinite(scheduleRow) && scheduleRow > 0 ? scheduleRow : null,
      nonPoints: false,
      officialPointsRaceNumber,
    };
  });
}

export function resolveLatestCompletedPointsRaceFromRaces(races) {
  const enriched = enrichClientScheduleRaces(races);
  let latest = null;
  for (const race of enriched) {
    if (race.nonPoints || race.officialPointsRaceNumber == null) continue;
    if (!String(race?.winner || "").trim()) continue;
    latest = {
      raceNumber: race.officialPointsRaceNumber,
      trackName: sanitizeTrackName(race?.track || race?.trackName),
      scheduleRow: race.scheduleRow,
    };
  }
  return latest;
}

export function findPointsRaceDisplayByNumber(races, raceNumber) {
  const target = Number(raceNumber);
  if (!Number.isInteger(target) || target < 1) return null;
  const enriched = enrichClientScheduleRaces(races);
  const match = enriched.find((race) => race.officialPointsRaceNumber === target);
  if (!match) return null;
  return {
    raceNumber: match.officialPointsRaceNumber,
    trackName: sanitizeTrackName(match.track || match.trackName),
    scheduleRow: match.scheduleRow,
  };
}

/**
 * Race number + track from the SAME completed official points race.
 * Prefer raceResults official pairing; never display raw scheduleRow as race #.
 */
export function resolveLatestCompletedPointsRaceDisplay(scheduleData = {}) {
  const races = scheduleData?.races || [];
  const results = scheduleData?.raceResults || {};
  const apiNum = Number(results.latestCompletedRaceNumber);
  const completedRaces = Array.isArray(results.completedRaces) ? results.completedRaces : [];

  if (Number.isInteger(apiNum) && apiNum >= 1) {
    const fromCompleted = completedRaces.find((row) => Number(row?.raceNumber) === apiNum);
    if (fromCompleted) {
      return {
        raceNumber: apiNum,
        trackName: sanitizeTrackName(fromCompleted.track || fromCompleted.trackName),
      };
    }
    const fromRaces = findPointsRaceDisplayByNumber(races, apiNum);
    if (fromRaces) {
      return { raceNumber: fromRaces.raceNumber, trackName: fromRaces.trackName };
    }
  }

  const progressionNum = Number(scheduleData?.raceProgression?.effectiveCompletedPointsCount);
  if (Number.isInteger(progressionNum) && progressionNum >= 1) {
    const fromRaces = findPointsRaceDisplayByNumber(races, progressionNum);
    if (fromRaces) {
      return { raceNumber: fromRaces.raceNumber, trackName: fromRaces.trackName };
    }
  }

  const walked = resolveLatestCompletedPointsRaceFromRaces(races);
  if (walked) {
    return { raceNumber: walked.raceNumber, trackName: walked.trackName };
  }
  return { raceNumber: null, trackName: "" };
}

export function resolveLatestCompletedPointsRaceNumber(races) {
  return resolveLatestCompletedPointsRaceFromRaces(races)?.raceNumber ?? null;
}

export function resolvePointsRaceNumberFromSchedule(scheduleData = {}) {
  return resolveLatestCompletedPointsRaceDisplay(scheduleData).raceNumber;
}

export function parseSeasonNumber(seasonName) {
  const match = String(seasonName || DEFAULT_SEASON_NAME).match(/(\d+)/);
  if (!match) return 11;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : 11;
}

export function formatSeasonHeading(seasonName) {
  return `SEASON ${parseSeasonNumber(seasonName)} STANDINGS`;
}

export function formatAfterRaceLine(pointsRaceNumber) {
  const n = Number(pointsRaceNumber);
  if (!Number.isInteger(n) || n < 1) return "CURRENT STANDINGS";
  return `AFTER RACE ${n}`;
}

function ellipsisToWidth(measureFn, font, text, maxWidth) {
  const value = String(text || "");
  if (measureFn(font, value) <= maxWidth) return value;
  const ellipsis = "…";
  let lo = 0;
  let hi = value.length;
  let out = ellipsis;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${value.slice(0, mid).trimEnd()}${ellipsis}`;
    if (measureFn(font, candidate) <= maxWidth) {
      out = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return out;
}

export function fitTrackNameDisplay(measureFn, trackName, maxWidth, {
  fontFamily = "Arial, sans-serif",
  fontWeight = "bold",
  maxSize = 16,
  minSize = 11,
} = {}) {
  const full = sanitizeTrackName(trackName).toUpperCase();
  if (!full) {
    return { lines: [], fontSize: maxSize, truncated: false, fullTrackName: "" };
  }

  let size = maxSize;
  while (size >= minSize) {
    const font = `${fontWeight} ${size}px ${fontFamily}`;
    if (measureFn(font, full) <= maxWidth) {
      return { lines: [full], fontSize: size, truncated: false, fullTrackName: full };
    }
    size -= 1;
  }

  const font = `${fontWeight} ${minSize}px ${fontFamily}`;
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return {
      lines: [ellipsisToWidth(measureFn, font, full, maxWidth)],
      fontSize: minSize,
      truncated: true,
      fullTrackName: full,
    };
  }

  let best = null;
  for (let split = 1; split < words.length; split += 1) {
    const line1 = words.slice(0, split).join(" ");
    const line2 = words.slice(split).join(" ");
    const w1 = measureFn(font, line1);
    const w2 = measureFn(font, line2);
    if (w1 <= maxWidth && w2 <= maxWidth) {
      return { lines: [line1, line2], fontSize: minSize, truncated: false, fullTrackName: full };
    }
    const score = Math.max(w1, w2);
    if (!best || score < best._score) {
      best = {
        lines: [
          w1 <= maxWidth ? line1 : ellipsisToWidth(measureFn, font, line1, maxWidth),
          w2 <= maxWidth ? line2 : ellipsisToWidth(measureFn, font, line2, maxWidth),
        ],
        fontSize: minSize,
        truncated: w1 > maxWidth || w2 > maxWidth,
        fullTrackName: full,
        _score: score,
      };
    }
  }

  if (!best) {
    return {
      lines: [ellipsisToWidth(measureFn, font, full, maxWidth)],
      fontSize: minSize,
      truncated: true,
      fullTrackName: full,
    };
  }
  delete best._score;
  return best;
}

export function buildStandingsGraphicFilename({ seasonName, pointsRaceNumber, latestCompletedRace }) {
  const season = parseSeasonNumber(seasonName);
  const race = Number(
    latestCompletedRace?.raceNumber != null ? latestCompletedRace.raceNumber : pointsRaceNumber,
  );
  const racePart = Number.isInteger(race) && race >= 1 ? `R${race}` : "R0";
  return `BP-S${season}-${racePart}-Standings.png`;
}

/** Prefer first non-empty car number field (empty string must not block bp_number). */
export function pickCarNumber(row = {}) {
  for (const key of ["carNumber", "bp_number", "standingsCarNumber"]) {
    if (row[key] == null) continue;
    const s = String(row[key]).trim();
    if (s !== "") return s;
  }
  return "";
}

/**
 * Authoritative standings movement from /api/standings.
 * gainLoss > 0 = gained positions (matches public standings ▲).
 */
export function resolveMovementDelta(row = {}) {
  if (row.gainLoss != null && row.gainLoss !== "" && Number.isFinite(Number(row.gainLoss))) {
    return Number(row.gainLoss);
  }
  if (row.change != null && row.change !== "" && Number.isFinite(Number(row.change))) {
    return Number(row.change);
  }
  const cur = Number(row.position ?? row.place);
  const prev = Number(row.previousPosition);
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return prev - cur;
}

export function formatMovement(delta) {
  if (delta == null || !Number.isFinite(Number(delta))) {
    return { text: "—", dir: "flat", value: null };
  }
  const n = Number(delta);
  if (n === 0) return { text: "—", dir: "flat", value: 0 };
  if (n > 0) return { text: `▲${n}`, dir: "up", value: n };
  return { text: `▼${Math.abs(n)}`, dir: "down", value: n };
}

export function normalizeStandingsRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const position = Number(row.position ?? row.place ?? index + 1);
    const points = Number(row.points ?? 0);
    const wins = Number(row.wins ?? 0);
    const carNumber = pickCarNumber(row);
    const driverName = String(row.driver ?? row.driverName ?? "").trim() || "Unknown Driver";
    const movementDelta = resolveMovementDelta(row);
    const movement = formatMovement(movementDelta);
    return {
      position: Number.isFinite(position) && position > 0 ? position : index + 1,
      driverName,
      carNumber,
      carNumberMissing: !carNumber,
      points: Number.isFinite(points) ? points : 0,
      wins: Number.isFinite(wins) ? wins : 0,
      driverId: row.driverId != null ? String(row.driverId) : "",
      photoUrl: String(row.photoUrl || "").trim(),
      movementDelta,
      movement,
      previousPosition:
        row.previousPosition != null && Number.isFinite(Number(row.previousPosition))
          ? Number(row.previousPosition)
          : null,
    };
  });
}

export function takeTopDrivers(rows, max = MAX_DRIVERS) {
  const limit = Math.max(0, Number(max) || MAX_DRIVERS);
  return normalizeStandingsRows(rows).slice(0, limit);
}

export function distributeColumns(drivers, sizes = COLUMN_SIZES) {
  const list = Array.isArray(drivers) ? drivers : [];
  const columns = [];
  let cursor = 0;
  for (const size of sizes) {
    columns.push(list.slice(cursor, cursor + size));
    cursor += size;
    if (cursor >= list.length) break;
  }
  while (columns.length < sizes.length) columns.push([]);
  return columns.slice(0, sizes.length);
}

/** Playoff divider immediately below P16 — expected in column 1 with 16/14/13. */
export function findPlayoffCutPlacement(drivers, playoffCut = DEFAULT_PLAYOFF_CUT) {
  const cut = Number(playoffCut) || DEFAULT_PLAYOFF_CUT;
  const list = Array.isArray(drivers) ? drivers : [];
  if (list.length <= cut) return null;

  const cutDriver = list.find((d) => Number(d.position) === cut) || list[cut - 1];
  if (!cutDriver) return null;

  const columns = distributeColumns(list);
  for (let col = 0; col < columns.length; col += 1) {
    const rows = columns[col];
    const idx = rows.findIndex(
      (d) => d === cutDriver || Number(d.position) === Number(cutDriver.position),
    );
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
  return `${Number(points) || 0} PTS`;
}

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

export function plateNumberFontSize(carNumber, { maxSize = 22, minSize = 12 } = {}) {
  const raw = String(carNumber ?? "").trim();
  const digits = raw.replace(/\D/g, "").length || (raw ? raw.length : 1);
  if (digits <= 1) return maxSize;
  if (digits === 2) return Math.max(minSize, maxSize - 2);
  return Math.max(minSize, maxSize - 7);
}

export function formatPlateDisplay(carNumber) {
  const raw = String(carNumber ?? "").trim();
  return raw || "—";
}

export function relativeLuminanceHex(hex) {
  const raw = String(hex || "").replace("#", "");
  if (raw.length < 6) return 0;
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function pickReadableNumberColor(fillHex) {
  return relativeLuminanceHex(fillHex) > 0.45 ? "#0a0a0a" : "#ffffff";
}

export function resolvePlayoffCut(settings = {}) {
  const n = Number(settings?.playoffCut);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PLAYOFF_CUT;
}

/** Text-only sponsor footer for this graphic (no logo). */
export function buildSponsorFooterText() {
  return {
    presentedBy: "PRESENTED BY",
    sponsorLine: SPONSOR_NAME,
    combined: `PRESENTED BY ${SPONSOR_NAME}`,
    siteUrl: SITE_URL,
    useLogo: false,
  };
}

export function validateOutputDimensions(width, height) {
  return Number(width) === OUTPUT_WIDTH && Number(height) === OUTPUT_HEIGHT;
}

/**
 * Layout metrics for the 43-driver / 16-row first column case.
 * Ensures header + 16 rows + cut + footer fit in 1080 logical px.
 */
export function computeStandingsLayoutMetrics({
  driverCount = MAX_DRIVERS,
  hasTrackName = true,
  reserveCutGap = true,
} = {}) {
  const padX = 24;
  const headerH = hasTrackName ? 86 : 72;
  const footerH = 54;
  const topGap = 2;
  const bottomGap = 2;
  const gridTop = headerH + topGap;
  const gridBottom = LOGICAL_HEIGHT - footerH - bottomGap;
  const gridSpan = gridBottom - gridTop;
  const colGap = 16;
  const colCount = 3;
  const colW = (LOGICAL_WIDTH - padX * 2 - colGap * (colCount - 1)) / colCount;
  const columns = distributeColumns(new Array(Math.min(driverCount, MAX_DRIVERS)).fill(null));
  const maxRows = Math.max(1, ...columns.map((c) => c.length || 1));
  const cutGap = reserveCutGap ? 12 : 0;
  const rowGap = 2;
  const rowStackBudget = Math.max(0, gridSpan - cutGap);
  const rowH = Math.min(58, (rowStackBudget - rowGap * (maxRows - 1)) / maxRows);
  const rowsUsed = maxRows * rowH + Math.max(0, maxRows - 1) * rowGap;
  const usedH = rowsUsed + cutGap;
  const fits = usedH <= gridSpan + 0.01;

  return {
    padX,
    headerH,
    footerH,
    gridTop,
    gridBottom,
    colGap,
    colW,
    colCount,
    rowH,
    rowGap,
    cutGap,
    maxRows,
    gridSpan,
    rowsUsed,
    usedH,
    fits,
    plateW: 52,
    plateH: Math.min(34, Math.max(26, rowH - 8)),
  };
}

export function buildStandingsGraphicModel(standingsData, scheduleData, options = {}) {
  const seasonName =
    options.seasonName ||
    standingsData?.settings?.seasonName ||
    DEFAULT_SEASON_NAME;
  const seasonNumber = parseSeasonNumber(seasonName);
  const playoffCut = resolvePlayoffCut(
    options.playoffCut != null
      ? { playoffCut: options.playoffCut }
      : standingsData?.settings || {},
  );

  let latestCompletedRace =
    options.latestCompletedRace ||
    resolveLatestCompletedPointsRaceDisplay(scheduleData || {});

  if (options.pointsRaceNumber != null && options.latestCompletedRace == null) {
    const n = Number(options.pointsRaceNumber);
    latestCompletedRace = {
      raceNumber: Number.isInteger(n) && n >= 1 ? n : null,
      trackName: sanitizeTrackName(options.trackName),
    };
  }

  latestCompletedRace = {
    raceNumber:
      Number.isInteger(Number(latestCompletedRace?.raceNumber)) &&
      Number(latestCompletedRace.raceNumber) >= 1
        ? Number(latestCompletedRace.raceNumber)
        : null,
    trackName: sanitizeTrackName(latestCompletedRace?.trackName),
  };

  const drivers = takeTopDrivers(standingsData?.rows || [], MAX_DRIVERS);
  const columns = distributeColumns(drivers);
  const cutPlacement = findPlayoffCutPlacement(drivers, playoffCut);
  const filename = buildStandingsGraphicFilename({ seasonName, latestCompletedRace });
  const layoutHints = computeStandingsLayoutMetrics({
    driverCount: drivers.length,
    hasTrackName: Boolean(latestCompletedRace.trackName),
    reserveCutGap: Boolean(cutPlacement),
  });

  return {
    seasonName,
    seasonNumber,
    latestCompletedRace,
    pointsRaceNumber: latestCompletedRace.raceNumber,
    playoffCut,
    drivers,
    columns,
    cutPlacement,
    filename,
    layoutHints,
    sponsor: {
      name: SPONSOR_NAME,
      useLogo: false,
    },
  };
}

export function buildExportPayload(standingsData, scheduleData, options = {}) {
  return buildStandingsGraphicModel(standingsData, scheduleData, options);
}

export function formatPreviewStatus(model, dims = { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT }) {
  const season = model?.seasonName || DEFAULT_SEASON_NAME;
  const raceNumber = model?.latestCompletedRace?.raceNumber;
  const track = sanitizeTrackName(model?.latestCompletedRace?.trackName);
  const after =
    Number.isInteger(raceNumber) && raceNumber >= 1
      ? `After Race ${raceNumber}`
      : "Current standings";
  const count = Array.isArray(model?.drivers) ? model.drivers.length : 0;
  const cut = model?.playoffCut || DEFAULT_PLAYOFF_CUT;
  return [
    "Preview ready",
    season,
    after,
    track || "(track unavailable)",
    `${count} drivers · Top ${cut} · ${dims.width}×${dims.height}`,
  ].join("\n");
}
