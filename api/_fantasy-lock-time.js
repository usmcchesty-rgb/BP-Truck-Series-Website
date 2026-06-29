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
    return {
      lock_time: display,
      lock_at: parsed.toISOString(),
      computedLockLabel: formatComputedLockLabel(parsed.toISOString(), display),
      warning: null,
      usedOverride: true,
      raceDate: null,
      seasonId,
    };
  }

  const raceNumber = Number(options.raceNumber);
  if (!Number.isFinite(raceNumber) || raceNumber < 1) {
    return {
      lock_time: display,
      lock_at: null,
      computedLockLabel: null,
      warning: 'Slate race number missing — set an advanced lock datetime manually.',
      usedOverride: false,
      raceDate: null,
      seasonId,
    };
  }

  const { race, dateParts, warning } = await resolveRaceDateForSlate(raceNumber, settings);
  if (!dateParts) {
    return {
      lock_time: display,
      lock_at: null,
      computedLockLabel: null,
      warning,
      usedOverride: false,
      raceDate: race?.date || null,
      seasonId,
    };
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

  return {
    lock_time: display,
    lock_at,
    computedLockLabel: formatComputedLockLabel(lock_at, display),
    warning: null,
    usedOverride: false,
    raceDate: race?.date || null,
    seasonId,
  };
}
