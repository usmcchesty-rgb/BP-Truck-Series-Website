/**
 * Pure standings-graphic helpers (no Canvas / DOM).
 * Shared by the browser export and Node regression tests.
 */

import {
  hasUsableNumberArtwork,
  resolveNumberArtwork,
} from "./number-artwork-logic.js";

export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;
export const RENDER_SCALE = 2;
export const OUTPUT_WIDTH = LOGICAL_WIDTH * RENDER_SCALE; // 3840
export const OUTPUT_HEIGHT = LOGICAL_HEIGHT * RENDER_SCALE; // 2160
export const MAX_DRIVERS = 42;
export const DEFAULT_PLAYOFF_CUT = 16;
export const DEFAULT_SEASON_NAME = "Season 11";
export const SPONSOR_NAME = "OHIO & INDIANA ROOFING";
export const SITE_URL = "blazingpedalsracing.com";
export const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

/** Graphic presentation only: P1–P14 / P15–P28 / P29–P42. */
export const COLUMN_SIZES = [14, 14, 14];

/** Solid BP-red cutoff drawn inside the existing P16/P17 row gap. Adds no layout height. */
export const PLAYOFF_CUT_LINE = {
  color: "#e50914",
  thickness: 4,
  inset: 4,
};

/** Subtle row-background tints for the four drivers around the cutoff. */
export const PLAYOFF_BUBBLE = {
  inside: {
    positions: [15, 16],
    bg: "rgba(170, 35, 45, 0.30)",
    border: "rgba(190, 55, 65, 0.38)",
  },
  outside: {
    positions: [17, 18],
    bg: "rgba(105, 25, 38, 0.30)",
    border: "rgba(125, 35, 48, 0.38)",
  },
};

export function playoffBubbleKind(position) {
  const pos = Number(position);
  if (PLAYOFF_BUBBLE.inside.positions.includes(pos)) return "inside";
  if (PLAYOFF_BUBBLE.outside.positions.includes(pos)) return "outside";
  return null;
}

export const DEFAULT_PLATE = {
  fill: "#1a1a1e",
  outline: "#d0d0d4",
  keyline: "#c81010",
  numberFill: "#ffffff",
};

/** Typography targets (logical px). Impact titles are regular weight — Impact has no true bold. */
export const TYPOGRAPHY = {
  seasonMax: 42,
  afterRace: 20,
  trackMax: 17,
  trackMin: 12,
  driverNameTop10: 19,
  driverNameRest: 19,
  driverNameMin: 15,
  driverNamePreferredMin: 17,
  positionTop10: 28,
  positionRest: 24,
  movement: 22,
  movementArrow: 26,
  points: 18,
  wins: 15,
  playoffCut: 18,
  footerPresentedBy: 13,
  footerSponsor: 30,
  footerSeries: 16,
  footerSite: 17,
  tracking: {
    driverName: 0.65,
    driverNameMin: 0.35,
    season: 1.8,
    afterRace: 0.9,
    track: 0.7,
    playoffCut: 1.8,
    presentedBy: 2.2,
    sponsor: 2.4,
    series: 1.2,
    site: 0.5,
  },
};

/** BP-safe motorsports fallback fills (never pure white). */
export const DETERMINISTIC_PLATE_PALETTE = [
  { fill: "#b01010", outline: "#f2f2f2", keyline: "#3a0505" },
  { fill: "#6e0c0c", outline: "#e8e8e8", keyline: "#220000" },
  { fill: "#2a2a32", outline: "#d8d8dc", keyline: "#c81010" },
  { fill: "#3a4550", outline: "#f0f0f0", keyline: "#101820" },
  { fill: "#143a6e", outline: "#eef2ff", keyline: "#071830" },
  { fill: "#3a1a5c", outline: "#f3eaff", keyline: "#160828" },
  { fill: "#0f4a38", outline: "#e8fff6", keyline: "#062018" },
  { fill: "#b84a10", outline: "#fff4ec", keyline: "#3a1800" },
];

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

function ellipsisToWidth(measureFn, font, text, maxWidth, tracking = 0) {
  const value = String(text || "");
  const widthOf = (t) => estimateTrackedWidth(measureFn(font, t), t, tracking);
  if (widthOf(value) <= maxWidth) return value;
  const ellipsis = "…";
  let lo = 0;
  let hi = value.length;
  let out = ellipsis;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${value.slice(0, mid).trimEnd()}${ellipsis}`;
    if (widthOf(candidate) <= maxWidth) {
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
  tracking = 0,
} = {}) {
  const full = sanitizeTrackName(trackName).toUpperCase();
  if (!full) {
    return { lines: [], fontSize: maxSize, truncated: false, fullTrackName: "" };
  }

  const widthOf = (font, text) =>
    estimateTrackedWidth(measureFn(font, text), text, tracking);

  let size = maxSize;
  while (size >= minSize) {
    const font = `${fontWeight} ${size}px ${fontFamily}`;
    if (widthOf(font, full) <= maxWidth) {
      return { lines: [full], fontSize: size, truncated: false, fullTrackName: full };
    }
    size -= 1;
  }

  const font = `${fontWeight} ${minSize}px ${fontFamily}`;
  const words = full.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return {
      lines: [ellipsisToWidth(measureFn, font, full, maxWidth, tracking)],
      fontSize: minSize,
      truncated: true,
      fullTrackName: full,
    };
  }

  let best = null;
  for (let split = 1; split < words.length; split += 1) {
    const line1 = words.slice(0, split).join(" ");
    const line2 = words.slice(split).join(" ");
    const w1 = widthOf(font, line1);
    const w2 = widthOf(font, line2);
    if (w1 <= maxWidth && w2 <= maxWidth) {
      return { lines: [line1, line2], fontSize: minSize, truncated: false, fullTrackName: full };
    }
    const score = Math.max(w1, w2);
    if (!best || score < best._score) {
      best = {
        lines: [
          w1 <= maxWidth ? line1 : ellipsisToWidth(measureFn, font, line1, maxWidth, tracking),
          w2 <= maxWidth ? line2 : ellipsisToWidth(measureFn, font, line2, maxWidth, tracking),
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
      lines: [ellipsisToWidth(measureFn, font, full, maxWidth, tracking)],
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
    return { text: "—", dir: "flat", value: null, arrow: "—", valueLabel: "" };
  }
  const n = Number(delta);
  if (n === 0) return { text: "—", dir: "flat", value: 0, arrow: "—", valueLabel: "" };
  if (n > 0) {
    return { text: `▲${n}`, dir: "up", value: n, arrow: "▲", valueLabel: String(n) };
  }
  const abs = Math.abs(n);
  return { text: `▼${abs}`, dir: "down", value: n, arrow: "▼", valueLabel: String(abs) };
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
    const numberArtwork = row.numberArtwork || resolveNumberArtwork({
      ...row,
      driverName,
      carNumber,
      iracingCustomerId: row.iracingCustomerId || row.iracing_customer_id,
      numberImage: row.numberImage || row.iracingDesign?.numberImage,
    });
    return {
      position: Number.isFinite(position) && position > 0 ? position : index + 1,
      driverName,
      carNumber,
      carNumberMissing: !carNumber,
      points: Number.isFinite(points) ? points : 0,
      wins: Number.isFinite(wins) ? wins : 0,
      driverId: row.driverId != null ? String(row.driverId) : "",
      iracingCustomerId: String(row.iracingCustomerId || row.iracing_customer_id || numberArtwork.customerId || ""),
      photoUrl: String(row.photoUrl || "").trim(),
      numberArtwork,
      hasNumberArtwork: hasUsableNumberArtwork(numberArtwork),
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

/** Playoff cutoff is P16; with 14/14/14 the line sits in column 2 between P16 and P17. */
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
  tracking = 0,
} = {}) {
  const value = String(text || "");
  let size = maxSize;
  while (size > minSize) {
    const font = `${fontWeight} ${size}px ${fontFamily}`;
    const width = estimateTrackedWidth(measureFn(font, value), value, tracking);
    if (width <= maxWidth) return size;
    size -= 1;
  }
  return minSize;
}

/**
 * Fit a standings driver name into the name slot.
 * Sequence: normal size+tracking → modest size drop → modest tracking drop → size floor.
 */
export function fitDriverName(measureFn, text, maxWidth, {
  fontFamily = "Arial, Helvetica, sans-serif",
  fontWeight = "bold",
  maxSize = TYPOGRAPHY.driverNameRest,
  preferredMin = TYPOGRAPHY.driverNamePreferredMin,
  minSize = TYPOGRAPHY.driverNameMin,
  tracking = TYPOGRAPHY.tracking.driverName,
  trackingMin = TYPOGRAPHY.tracking.driverNameMin,
} = {}) {
  const value = String(text || "").toUpperCase();
  const widthOf = (size, track) => {
    const font = `${fontWeight} ${size}px ${fontFamily}`;
    return estimateTrackedWidth(measureFn(font, value), value, track);
  };

  if (widthOf(maxSize, tracking) <= maxWidth) {
    return { size: maxSize, tracking };
  }

  for (let size = maxSize - 1; size >= preferredMin; size -= 1) {
    if (widthOf(size, tracking) <= maxWidth) {
      return { size, tracking };
    }
  }

  let track = tracking;
  while (track > trackingMin + 0.049) {
    track = Math.round((track - 0.1) * 10) / 10;
    if (track < trackingMin) track = trackingMin;
    if (widthOf(preferredMin, track) <= maxWidth) {
      return { size: preferredMin, tracking: track };
    }
  }

  if (widthOf(preferredMin, trackingMin) <= maxWidth) {
    return { size: preferredMin, tracking: trackingMin };
  }

  for (let size = preferredMin - 1; size >= minSize; size -= 1) {
    if (widthOf(size, trackingMin) <= maxWidth) {
      return { size, tracking: trackingMin };
    }
  }

  return { size: minSize, tracking: trackingMin };
}

/** Extra width from letter-spacing: (charCount - 1) * tracking. */
export function estimateTrackedWidth(baseWidth, text, tracking = 0) {
  const n = Array.from(String(text || "")).length;
  return Number(baseWidth || 0) + Math.max(0, n - 1) * Number(tracking || 0);
}

/**
 * measureCharFn(font, char) => width of one glyph.
 * Returns total tracked width.
 */
export function measureTrackedTextWidth(measureCharFn, font, text, tracking = 0) {
  const chars = Array.from(String(text || ""));
  if (!chars.length) return 0;
  let width = 0;
  chars.forEach((ch, index) => {
    width += Number(measureCharFn(font, ch) || 0);
    if (index < chars.length - 1) width += Number(tracking || 0);
  });
  return width;
}

export function plateNumberFontSize(carNumber, { maxSize = 24, minSize = 12 } = {}) {
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

function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((n) => clampByte(n).toString(16).padStart(2, "0")).join("")}`;
}

function hslToRgb(h, s, l) {
  const hh = ((Number(h) % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, Number(s)));
  const ll = Math.max(0, Math.min(1, Number(l)));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh < 60) [rp, gp, bp] = [c, x, 0];
  else if (hh < 120) [rp, gp, bp] = [x, c, 0];
  else if (hh < 180) [rp, gp, bp] = [0, c, x];
  else if (hh < 240) [rp, gp, bp] = [0, x, c];
  else if (hh < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return {
    r: clampByte((rp + m) * 255),
    g: clampByte((gp + m) * 255),
    b: clampByte((bp + m) * 255),
  };
}

/**
 * Canonicalize any color candidate to #rrggbb before luminance/usability checks.
 * Supports hex, rgb/rgba, hsl/hsla, and basic named colors.
 */
export function normalizeColorToHex(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "white") return "#ffffff";
  if (lower === "black") return "#000000";
  if (lower === "transparent" || lower === "none") return "";

  const hexMatch = lower.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    const body = hexMatch[1];
    if (body.length === 3) {
      return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toLowerCase();
    }
    return `#${body.slice(0, 6)}`.toLowerCase();
  }

  const rgbMatch = lower.match(
    /^rgba?\(\s*([.\d]+)\s*,\s*([.\d]+)\s*,\s*([.\d]+)(?:\s*,\s*([.\d]+))?\s*\)$/,
  );
  if (rgbMatch) {
    const alpha = rgbMatch[4] == null ? 1 : Number(rgbMatch[4]);
    if (!(alpha > 0.2)) return "";
    return rgbToHex(rgbMatch[1], rgbMatch[2], rgbMatch[3]);
  }

  const hslMatch = lower.match(
    /^hsla?\(\s*([.\d]+)\s*,\s*([.\d]+)%\s*,\s*([.\d]+)%(?:\s*,\s*([.\d]+))?\s*\)$/,
  );
  if (hslMatch) {
    const alpha = hslMatch[4] == null ? 1 : Number(hslMatch[4]);
    if (!(alpha > 0.2)) return "";
    const rgb = hslToRgb(hslMatch[1], Number(hslMatch[2]) / 100, Number(hslMatch[3]) / 100);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  // Bare 6-digit hex without #
  if (/^[0-9a-f]{6}$/i.test(lower)) return `#${lower}`;
  return "";
}

/** @deprecated Prefer normalizeColorToHex — kept for callers. */
export function normalizeHexColor(value) {
  return normalizeColorToHex(value);
}

export function getRgbChannels(hex) {
  const n = normalizeColorToHex(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function getSaturationLightness(hex) {
  const rgb = getRgbChannels(hex);
  if (!rgb) return { s: 0, l: 0 };
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { s, l };
}

export function relativeLuminanceHex(hex) {
  const rgb = getRgbChannels(hex);
  if (!rgb) return 0;
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/**
 * Strict usable-fill gate for number-plate bodies.
 * White/near-white/washed-out candidates are rejected — they may still be used as keylines.
 */
export function isUsablePlateFill(color) {
  const hex = normalizeColorToHex(color);
  if (!hex) return { ok: false, reason: "invalid_or_transparent", hex: "" };

  const rgb = getRgbChannels(hex);
  const lum = relativeLuminanceHex(hex);
  const { s, l } = getSaturationLightness(hex);

  if (rgb.r >= 235 && rgb.g >= 235 && rgb.b >= 235) {
    return { ok: false, reason: "rgb_near_white", hex };
  }
  if (lum >= 0.9 && s < 0.15) {
    return { ok: false, reason: "high_luminance_low_saturation", hex };
  }
  if (lum >= 0.85 && s < 0.08) {
    return { ok: false, reason: "washed_out_near_white", hex };
  }
  if (l >= 0.92 && s < 0.2) {
    return { ok: false, reason: "hsl_near_white", hex };
  }
  // Extremely light gray that still reads as a white plate on dark rows.
  if (lum >= 0.82 && s < 0.05) {
    return { ok: false, reason: "near_white_grayscale", hex };
  }
  // Pure / near-black only — charcoal/steel palette fills must remain usable.
  if (rgb.r <= 22 && rgb.g <= 22 && rgb.b <= 22) {
    return { ok: false, reason: "rgb_near_black", hex };
  }
  if (lum <= 0.03 && s < 0.08) {
    return { ok: false, reason: "near_black_background_collapse", hex };
  }
  return { ok: true, reason: null, hex };
}

export function isNearWhiteHex(hex, threshold = 0.82) {
  const n = normalizeColorToHex(hex);
  if (!n) return false;
  const usable = isUsablePlateFill(n);
  if (
    !usable.ok &&
    [
      "rgb_near_white",
      "high_luminance_low_saturation",
      "washed_out_near_white",
      "hsl_near_white",
      "near_white_grayscale",
    ].includes(usable.reason)
  ) {
    return true;
  }
  return relativeLuminanceHex(n) >= threshold && getSaturationLightness(n).s < 0.2;
}

export function isNearBlackHex(hex, threshold = 0.08) {
  const n = normalizeColorToHex(hex);
  if (!n) return true;
  return relativeLuminanceHex(n) <= threshold;
}

export function darkenHex(hex, factor = 0.42) {
  const n = normalizeColorToHex(hex) || "#ffffff";
  const rgb = getRgbChannels(n);
  const scale = Math.min(1, Math.max(0.15, Number(factor) || 0.42));
  // Preserve hue: scale channels, then bump saturation slightly for identity.
  let r = rgb.r * scale;
  let g = rgb.g * scale;
  let b = rgb.b * scale;
  const max = Math.max(r, g, b) || 1;
  const min = Math.min(r, g, b);
  if (max - min < 12) {
    // Was nearly gray/white — do not pretend this is a brand color.
    return rgbToHex(r, g, b);
  }
  const boost = 1.15;
  const avg = (r + g + b) / 3;
  r = avg + (r - avg) * boost;
  g = avg + (g - avg) * boost;
  b = avg + (b - avg) * boost;
  return rgbToHex(r, g, b);
}

export function pickReadableNumberColor(fillHex) {
  return relativeLuminanceHex(fillHex) > 0.45 ? "#0a0a0a" : "#ffffff";
}

export function hashStringStable(value) {
  const raw = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickDeterministicPlateColors(driver = {}) {
  const key = [
    driver.driverId || "",
    driver.driverName || driver.driver || "",
    driver.carNumber || "",
  ].join("|");
  const idx = hashStringStable(key) % DETERMINISTIC_PLATE_PALETTE.length;
  const pick = DETERMINISTIC_PLATE_PALETTE[idx];
  return {
    fill: pick.fill,
    outline: pick.outline,
    keyline: pick.keyline,
    numberFill: pickReadableNumberColor(pick.fill),
    source: "deterministic_fallback",
    colorSource: "deterministic_fallback",
  };
}

/**
 * Walk ordered color candidates until a usable plate fill is found.
 * Does not treat cached white as proof of a white car/suit.
 */
export function resolvePlateFillFromCandidates(candidates = [], driver = {}) {
  const rejected = [];
  for (const candidate of candidates) {
    const check = isUsablePlateFill(candidate?.color);
    if (check.ok) {
      return {
        fill: check.hex,
        from: candidate,
        rejected,
        usedFallback: false,
      };
    }
    rejected.push({
      color: candidate?.color ?? "",
      normalized: check.hex || "",
      role: candidate?.role || "",
      source: candidate?.source || "",
      reason: check.reason || "rejected",
    });
  }

  const fallback = pickDeterministicPlateColors(driver);
  return {
    fill: fallback.fill,
    from: {
      color: fallback.fill,
      role: "fallback",
      source: "deterministic_fallback",
    },
    rejected,
    usedFallback: true,
    fallback,
  };
}

function pickKeylineForFill(fillHex, secondaryHex) {
  const secondary = normalizeColorToHex(secondaryHex);
  if (secondary && isUsablePlateFill(secondary).ok === false && isNearWhiteHex(secondary)) {
    return secondary;
  }
  if (secondary && normalizeColorToHex(secondary) !== normalizeColorToHex(fillHex)) {
    if (!isNearBlackHex(secondary, 0.03) || relativeLuminanceHex(fillHex) > 0.35) {
      // Prefer a contrasting accent when available.
    }
  }
  if (relativeLuminanceHex(fillHex) > 0.35) return "#0a0a0a";
  return "#c81010";
}

function pickOutlineForFill(fillHex, secondaryHex) {
  const secondary = normalizeColorToHex(secondaryHex);
  if (secondary && secondary !== normalizeColorToHex(fillHex)) {
    if (isNearWhiteHex(secondary) || isNearBlackHex(secondary) || isUsablePlateFill(secondary).ok) {
      return secondary;
    }
  }
  return pickReadableNumberColor(fillHex) === "#ffffff" ? "#f2f2f2" : "#101010";
}

/**
 * Resolve final plate colors from ordered candidates.
 * White/near-white primaries never remain as final fill — walk the list,
 * then use deterministic fallback (never plain white).
 */
export function resolveStandingsPlateColors({
  driver = {},
  rawPrimary = "",
  rawSecondary = "",
  rawSource = "unknown",
  candidates: explicitCandidates = null,
  extraCandidates = [],
} = {}) {
  const candidates = (Array.isArray(explicitCandidates) && explicitCandidates.length
    ? explicitCandidates
    : [
        { color: rawPrimary, role: "primary", source: rawSource },
        { color: rawSecondary, role: "secondary", source: rawSource },
        ...extraCandidates,
      ]
  ).filter((c) => c && c.color != null && String(c.color).trim() !== "");

  const resolved = resolvePlateFillFromCandidates(candidates, driver);
  const fill = resolved.fill;

  const secondaryCandidate =
    candidates.find(
      (c) =>
        c !== resolved.from &&
        normalizeColorToHex(c.color) &&
        normalizeColorToHex(c.color) !== normalizeColorToHex(fill),
    ) || null;
  const pairedSecondary =
    normalizeColorToHex(secondaryCandidate?.color) ||
    normalizeColorToHex(rawSecondary) ||
    (isNearWhiteHex(rawPrimary) ? normalizeColorToHex(rawPrimary) : "");

  const outline = pickOutlineForFill(fill, pairedSecondary);
  const keyline = pickKeylineForFill(fill, outline);
  const numberFill = pickReadableNumberColor(fill);

  // Safety: never emit an unusable final fill.
  const finalCheck = isUsablePlateFill(fill);
  const safe = finalCheck.ok
    ? { fill, outline, keyline, numberFill, source: resolved.from?.source || rawSource }
    : pickDeterministicPlateColors(driver);

  const colorSource =
    String(safe.source || "").includes("deterministic") || resolved.usedFallback
      ? "deterministic_fallback"
      : String(resolved.from?.source || safe.source || "unknown");

  const rejectedReasonText = (resolved.rejected || [])
    .map((r) => `${r.source}:${r.role}:${r.reason}`)
    .join("; ");

  return {
    fill: safe.fill,
    outline: safe.outline || outline,
    keyline: safe.keyline || keyline,
    numberFill: safe.numberFill || pickReadableNumberColor(safe.fill),
    source: colorSource,
    colorSource,
    platePrimary: safe.fill,
    plateSecondary: safe.outline || outline,
    plateTextColor: safe.numberFill || pickReadableNumberColor(safe.fill),
    rawPrimary: rawPrimary || candidates.find((c) => c.role === "primary")?.color || "",
    rawSecondary: rawSecondary || candidates.find((c) => c.role === "secondary")?.color || "",
    rawColorSource: rawSource || candidates[0]?.source || "unknown",
    finalPrimary: safe.fill,
    finalSecondary: safe.outline || outline,
    finalTextColor: safe.numberFill || pickReadableNumberColor(safe.fill),
    finalColorSource: colorSource,
    rejectedReasons: resolved.rejected,
    rejectedReasonText,
    usedFallback: Boolean(resolved.usedFallback || !finalCheck.ok),
  };
}

/**
 * Back-compat wrapper used by older tests/call sites.
 */
export function packagePlateColors({
  fill,
  outline,
  keyline,
  source = "unknown",
  driver = {},
  extraCandidates = [],
} = {}) {
  const result = resolveStandingsPlateColors({
    driver,
    rawPrimary: fill,
    rawSecondary: outline || keyline,
    rawSource: source,
    extraCandidates,
  });
  return result;
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
 * Layout metrics for the 42-driver / 14 / 14 / 14 board.
 * Playoff cutoff is a line inside the normal P16/P17 gap — no extra column height.
 */
export function computeStandingsLayoutMetrics({
  driverCount = MAX_DRIVERS,
  hasTrackName = true,
} = {}) {
  const padX = 24;
  const headerH = hasTrackName ? 98 : 82;
  const footerH = 80;
  const topGap = 6;
  const bottomGap = 6;
  const gridTop = headerH + topGap;
  const gridBottom = LOGICAL_HEIGHT - footerH - bottomGap;
  const gridSpan = gridBottom - gridTop;
  const colGap = 18;
  const colCount = 3;
  const colW = Math.floor((LOGICAL_WIDTH - padX * 2 - colGap * (colCount - 1)) / colCount);
  const columns = distributeColumns(new Array(Math.min(driverCount, MAX_DRIVERS)).fill(null));
  const maxRows = Math.max(1, ...columns.map((c) => c.length || 1));
  const rowGap = 5;
  const rawRowH = (gridSpan - rowGap * (maxRows - 1)) / maxRows;
  const rowH = Math.max(36, Math.min(58, Math.floor(rawRowH)));
  const rowsUsed = maxRows * rowH + Math.max(0, maxRows - 1) * rowGap;
  const fits = rowsUsed <= gridSpan + 0.01;
  const plateH = Math.max(36, Math.min(44, rowH - 12));
  const plateW = plateH * 2;

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
    cutGap: 0,
    cutLineThickness: PLAYOFF_CUT_LINE.thickness,
    maxRows,
    gridSpan,
    rowsUsed,
    usedH: rowsUsed,
    fits,
    plateW,
    plateH,
    posW: 44,
    moveW: 68,
    statsW: 160,
    gapPosMove: 6,
    gapMovePlate: 8,
    gapPlateName: 8,
    gapNameStats: 8,
    gapPtsWins: 12,
    rowPad: 6,
  };
}

/** Horizontal slots inside a standings row. Used to keep movement / numbers / names from colliding. */
export function computeRowSlotGeometry(layout = computeStandingsLayoutMetrics()) {
  const pad = layout.rowPad ?? 6;
  const posX = pad;
  const moveX = posX + layout.posW + layout.gapPosMove;
  const numberX = moveX + layout.moveW + layout.gapMovePlate;
  const nameX = numberX + layout.plateW + layout.gapPlateName;
  const statsX = layout.colW - pad - layout.statsW;
  const nameW = Math.max(0, statsX - layout.gapNameStats - nameX);
  return {
    pos: { x: posX, w: layout.posW },
    move: { x: moveX, w: layout.moveW },
    number: { x: numberX, w: layout.plateW },
    name: { x: nameX, w: nameW },
    stats: { x: statsX, w: layout.statsW },
  };
}

export function standingsRowY(layout, rowIndex) {
  return layout.gridTop + Number(rowIndex) * (layout.rowH + layout.rowGap);
}

/** Horizontal cutoff line sitting inside the existing P16/P17 gap. Zero extra layout height. */
export function computePlayoffCutLine(layout, placement) {
  if (!placement) return null;
  const thickness = PLAYOFF_CUT_LINE.thickness;
  const inset = PLAYOFF_CUT_LINE.inset;
  const p16Bottom = standingsRowY(layout, placement.afterRowIndex) + layout.rowH;
  const p17Top = standingsRowY(layout, placement.afterRowIndex + 1);
  const gap = p17Top - p16Bottom;
  const y = p16Bottom + Math.max(0, Math.floor((gap - thickness) / 2));
  return {
    columnIndex: placement.columnIndex,
    afterRowIndex: placement.afterRowIndex,
    y,
    thickness,
    width: layout.colW - inset * 2,
    inset,
    color: PLAYOFF_CUT_LINE.color,
    consumesLayoutHeight: false,
    extraLayoutHeight: 0,
    p16Bottom,
    p17Top,
    gap,
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
