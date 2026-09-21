import { fetchHtml, getSettings } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces, getPointsRaceByNumber } from './_schedule-points-races.js';
import {
  EASTERN_TIMEZONE,
  getEasternDateParts,
  parseScheduleDateParts,
  parseRaceStartTimeToMinutes,
} from './_race-date-status.js';

export const DEFAULT_FANTASY_LOCK_DISPLAY = '6:30pm EST';

export function parseDisplayLockTimeMinutes(displayText) {
  let raw = String(displayText || '').trim();
  if (!raw) return null;
  raw = raw.replace(/\b(EST|ET|Eastern)\b/gi, '').trim();
  return parseRaceStartTimeToMinutes(raw);
}

export function easternLocalDateTimeToUtcIso({ year, month, day, hour, minute }) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  for (let deltaMs = -16 * 3600000; deltaMs <= 4 * 3600000; deltaMs += 60000) {
    const candidate = new Date(utcGuess + deltaMs);
    const eastern = getEasternDateParts(candidate);
    if (
      eastern.year === year &&
      eastern.month === month &&
      eastern.day === day &&
      eastern.hour === hour &&
      eastern.minute === minute
    ) {
      return candidate.toISOString();
    }
  }
  return null;
}

export function formatComputedLockLabel(lockAtIso, lockTimeDisplay = '') {
  if (!lockAtIso) return null;
  const date = new Date(lockAtIso);
  if (Number.isNaN(date.getTime())) return null;

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

  const display = String(lockTimeDisplay || '').trim() || DEFAULT_FANTASY_LOCK_DISPLAY;
  return `${formattedDate} ${display}`;
}

export function formatLockTimeLinePretty(lockTimeDisplay = '') {
  const raw = String(lockTimeDisplay || '').trim() || DEFAULT_FANTASY_LOCK_DISPLAY;
  const withoutTz = raw.replace(/\b(EST|EDT|ET|Eastern)\b/gi, '').trim();
  const minutes = parseRaceStartTimeToMinutes(withoutTz);
  const tzMatch = raw.match(/\b(EST|EDT|ET|Eastern)\b/i);
  const tz = tzMatch ? tzMatch[0].toUpperCase().replace('EASTERN', 'EST') : 'EST';

  if (minutes == null) return raw.toUpperCase().includes('PM') || raw.toUpperCase().includes('AM') ? raw : raw;

  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hour24 % 12 || 12;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm} ${tz}`;
}

function isUsableDateLabel(value) {
  const text = String(value || '').trim();
  return Boolean(text) && !/invalid/i.test(text) && text !== 'undefined';
}

function formatCalendarDateWeekdayShort(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || y < 1000 || m < 1 || m > 12 || d < 1 || d > 31) {
    return '';
  }

  const utcDate = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(utcDate.getTime())) return '';

  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(utcDate);
  const monthShort = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(utcDate);
  if (!isUsableDateLabel(weekday) || !isUsableDateLabel(monthShort)) return '';
  return `${weekday}, ${monthShort} ${d}`;
}

function formatEasternWeekdayShortDate(value) {
  if (value == null || value === '') return '';

  const raw = value instanceof Date ? value.toISOString() : String(value).trim();
  if (!raw || /invalid/i.test(raw) || raw === 'undefined') return '';

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return formatCalendarDateWeekdayShort(dateOnly[1], dateOnly[2], dateOnly[3]);
  }

  const scheduleParts = parseScheduleDateParts(raw);
  if (scheduleParts) {
    return formatCalendarDateWeekdayShort(scheduleParts.year, scheduleParts.month, scheduleParts.day);
  }

  const date = value instanceof Date ? value : new Date(raw);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: EASTERN_TIMEZONE,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === 'weekday')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!isUsableDateLabel(weekday) || !isUsableDateLabel(month) || !day) return '';
    return `${weekday}, ${month} ${Number(day)}`;
  } catch {
    return '';
  }
}

export function resolvePublicLockRaceDate(scheduleRaces, raceNumber) {
  const race = getPointsRaceByNumber(scheduleRaces || [], raceNumber);
  return race?.date || null;
}

export function formatPublicLockDateLabel({ lockAt, raceDate } = {}) {
  const fromRaceDate = formatEasternWeekdayShortDate(raceDate);
  if (fromRaceDate) return fromRaceDate;
  return formatEasternWeekdayShortDate(lockAt);
}

export function formatPublicLockTimeEt(lockTimeDisplay = '') {
  const raw = String(lockTimeDisplay || '').trim();
  if (!raw) return '';
  const pretty = formatLockTimeLinePretty(raw);
  const labeled = String(pretty || raw).replace(/\b(EST|EDT|EASTERN)\b/gi, 'ET');
  return /invalid/i.test(labeled) || labeled === 'undefined' ? '' : labeled;
}

export function formatPublicFantasyLockDisplay({ lockTime, lockAt, raceDate } = {}) {
  const dateLabel = formatPublicLockDateLabel({ lockAt, raceDate });
  const timeLabel = formatPublicLockTimeEt(lockTime);
  if (dateLabel && timeLabel) return `${dateLabel} · ${timeLabel}`;
  if (dateLabel) return dateLabel;
  return timeLabel;
}

export function getLockDisplayState(lockAtIso, now = new Date()) {
  if (!lockAtIso) return { state: 'normal', hoursUntil: null, isLocked: false };
  const lockAt = new Date(lockAtIso);
  if (Number.isNaN(lockAt.getTime())) return { state: 'normal', hoursUntil: null, isLocked: false };

  const ms = lockAt.getTime() - now.getTime();
  if (ms <= 0) return { state: 'locked', hoursUntil: 0, isLocked: true };
  const hoursUntil = ms / (3600 * 1000);
  if (hoursUntil <= 48) return { state: 'warning', hoursUntil, isLocked: false };
  return { state: 'normal', hoursUntil, isLocked: false };
}

export function buildLockDisplayCard(fields = {}, now = new Date()) {
  const { lock_at, lock_time } = fields;
  let lockDateLine = null;
  const lockTimeLine = formatLockTimeLinePretty(lock_time);

  if (lock_at) {
    lockDateLine = new Intl.DateTimeFormat('en-US', {
      timeZone: EASTERN_TIMEZONE,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(lock_at));
  }

  const { state, hoursUntil, isLocked } = getLockDisplayState(lock_at, now);
  return {
    lockDateLine,
    lockTimeLine,
    lockState: state,
    lockStateLabel: isLocked ? 'Locked' : state === 'warning' ? 'Closing soon' : 'Open',
    hoursUntilLock: hoursUntil,
  };
}

function enrichLockPreview(base, now = new Date()) {
  return {
    ...base,
    ...buildLockDisplayCard(base, now),
  };
}

export async function resolveRaceDateForSlate(raceNumber, settings = null) {
  const resolvedSettings = settings || (await getSettings());
  const html = await fetchHtml(resolvedSettings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(html));
  const race = getPointsRaceByNumber(scheduleRaces, Number(raceNumber));

  if (!race?.date) {
    return {
      race: race || null,
      dateParts: null,
      warning: `No schedule date found for Race ${raceNumber}. Set an advanced lock datetime manually.`,
    };
  }

  const dateParts = parseScheduleDateParts(race.date);
  if (!dateParts) {
    return {
      race,
      dateParts: null,
      warning: `Could not parse schedule date "${race.date}" for Race ${raceNumber}. Set an advanced lock datetime manually.`,
    };
  }

  return { race, dateParts, warning: null };
}

export async function computeFantasyLockAt(options = {}) {
  const display =
    String(options.lockTimeDisplay || DEFAULT_FANTASY_LOCK_DISPLAY).trim() ||
    DEFAULT_FANTASY_LOCK_DISPLAY;
  const settings = options.settings || (await getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');

  if (options.useLockOverride && options.lockAtOverride) {
    const parsed = new Date(options.lockAtOverride);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error('Invalid manual lock datetime override.');
    }
    return enrichLockPreview(
      {
        lock_time: display,
        lock_at: parsed.toISOString(),
        computedLockLabel: formatComputedLockLabel(parsed.toISOString(), display),
        warning: null,
        usedOverride: true,
        raceDate: null,
        seasonId,
      },
      options.now
    );
  }

  const raceNumber = Number(options.raceNumber);
  if (!Number.isFinite(raceNumber) || raceNumber < 1) {
    return enrichLockPreview(
      {
        lock_time: display,
        lock_at: null,
        computedLockLabel: null,
        warning: 'Slate race number missing — set an advanced lock datetime manually.',
        usedOverride: false,
        raceDate: null,
        seasonId,
      },
      options.now
    );
  }

  const { race, dateParts, warning } = await resolveRaceDateForSlate(raceNumber, settings);
  if (!dateParts) {
    return enrichLockPreview(
      {
        lock_time: display,
        lock_at: null,
        computedLockLabel: null,
        warning,
        usedOverride: false,
        raceDate: race?.date || null,
        seasonId,
      },
      options.now
    );
  }

  const minutes = parseDisplayLockTimeMinutes(display);
  if (minutes == null) {
    throw new Error('Could not parse lineup lock display time. Use a format like "6:30pm EST".');
  }

  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const lock_at = easternLocalDateTimeToUtcIso({
    year: dateParts.year,
    month: dateParts.month,
    day: dateParts.day,
    hour,
    minute,
  });

  if (!lock_at) {
    throw new Error('Failed to compute lineup lock datetime from schedule date and display time.');
  }

  return enrichLockPreview(
    {
      lock_time: display,
      lock_at,
      computedLockLabel: formatComputedLockLabel(lock_at, display),
      warning: null,
      usedOverride: false,
      raceDate: race?.date || null,
      seasonId,
    },
    options.now
  );
}
