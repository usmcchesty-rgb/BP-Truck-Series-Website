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

/** Strip unusable track labels so the graphic never shows undefined/null/dashes. */
export function sanitizeTrackName(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^(undefined|null|n\/?a|—|-–—)$/i.test(raw)) return "";
  return raw;
}

/**
 * Single walk of schedule rows: official points ordinal + track from the same race.
 * Completed = non-empty winner (matches schedule scrape convention).
 * Non-points / duel rows are skipped and do not inflate the ordinal.
 */
export function resolveLatestCompletedPointsRaceFromRaces(races) {
  let pointsOrdinal = 0;
  let latest = null;
  for (const race of races || []) {
    if (isNonPointsRace(race)) continue;
    pointsOrdinal += 1;
    if (String(race?.winner || "").trim()) {
      latest = {
        raceNumber: pointsOrdinal,
        trackName: sanitizeTrackName(race?.track),
      };
    }
  }
  return latest;
}

/** Look up a points-race ordinal in the same races list (same row → number + track). */
export function findPointsRaceDisplayByNumber(races, raceNumber) {
  const target = Number(raceNumber);
  if (!Number.isInteger(target) || target < 1) return null;
  let ordinal = 0;
  for (const race of races || []) {
    if (isNonPointsRace(race)) continue;
    ordinal += 1;
    if (ordinal === target) {
      return {
        raceNumber: ordinal,
        trackName: sanitizeTrackName(race?.track),
      };
    }
  }
  return null;
}

/**
 * Resolve latest completed official points race display from schedule payload.
 * Race number and track always come from the same race identity.
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
    if (fromRaces) return fromRaces;
    return { raceNumber: apiNum, trackName: "" };
  }

  const progressionNum = Number(scheduleData?.raceProgression?.effectiveCompletedPointsCount);
  if (Number.isInteger(progressionNum) && progressionNum >= 1) {
    const fromRaces = findPointsRaceDisplayByNumber(races, progressionNum);
    if (fromRaces) return fromRaces;
    return { raceNumber: progressionNum, trackName: "" };
  }

  return (
    resolveLatestCompletedPointsRaceFromRaces(races) || {
      raceNumber: null,
      trackName: "",
    }
  );
}

/** Number-only helper built on the paired race+track walk. */
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
  const n = parseSeasonNumber(seasonName);
  return `SEASON ${n} STANDINGS`;
}

export function formatAfterRaceLine(pointsRaceNumber) {
  const n = Number(pointsRaceNumber);
  if (!Number.isInteger(n) || n < 1) return "CURRENT STANDINGS";
  return `AFTER RACE ${n}`;
}

/**
 * Header race lines. Track is optional; never invent placeholders.
 */
export function formatHeaderRaceBlock(latestCompletedRace = {}) {
  const raceNumber = latestCompletedRace?.raceNumber;
  const trackName = sanitizeTrackName(latestCompletedRace?.trackName);
  return {
    afterRaceLine: formatAfterRaceLine(raceNumber),
    trackLines: trackName ? [trackName.toUpperCase()] : [],
    fullTrackName: trackName,
  };
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

/**
 * Fit a long track name into one or two right-aligned lines.
 * Prefer font shrink, then wrap; ellipsis only as last resort.
 */
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
  const n = Number(points) || 0;
  return `${n} PTS`;
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

/**
 * Central standings graphic model consumed by preview and download.
 */
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
  const filename = buildStandingsGraphicFilename({
    seasonName,
    latestCompletedRace,
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
    sponsor: {
      name: SPONSOR_NAME,
      logoCandidates: [...SPONSOR_LOGO_CANDIDATES],
    },
  };
}

/** Back-compat alias */
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
  const trackPart = track ? ` · ${track}` : "";
  const count = Array.isArray(model?.drivers) ? model.drivers.length : 0;
  return [
    "Preview ready",
    `${season} · ${after}${trackPart}`,
    `${count} drivers · ${dims.width}×${dims.height}`,
  ].join("\n");
}
