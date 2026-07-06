import {
  getEasternDateParts,
  parseScheduleDateParts,
} from './_race-date-status.js';

/** Post-race window: race day (Sunday) through following Wednesday. */
export const POST_RACE_WINDOW_END_OFFSET = 3;

/** Next-race prep window: Wednesday before race through race day (Sunday). */
export const NEXT_RACE_PREP_START_OFFSET = -4;

export function easternDateKeyFromParts({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function easternDateKey(date = new Date()) {
  return easternDateKeyFromParts(getEasternDateParts(date));
}

function addCalendarDays(dateParts, deltaDays) {
  const anchor = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day));
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

export function isDateKeyInRange(todayKey, startKey, endKey) {
  if (!todayKey || !startKey || !endKey) return false;
  return todayKey >= startKey && todayKey <= endKey;
}

function buildRaceWindow(date, { startOffset, endOffset }) {
  const parts = parseScheduleDateParts(date);
  if (!parts) {
    return { active: false, startKey: null, endKey: null };
  }

  const startKey = easternDateKeyFromParts(addCalendarDays(parts, startOffset));
  const endKey = easternDateKeyFromParts(addCalendarDays(parts, endOffset));
  return { startKey, endKey, raceDateParts: parts };
}

export function buildMissionControlWindowContext({
  postRace = null,
  nextRace = null,
  now = new Date(),
} = {}) {
  const todayKey = easternDateKey(now);

  const postRaceMeta = postRace?.date
    ? buildRaceWindow(postRace.date, {
        startOffset: 0,
        endOffset: POST_RACE_WINDOW_END_OFFSET,
      })
    : { startKey: null, endKey: null, raceDateParts: null };

  const nextRaceMeta = nextRace?.date
    ? buildRaceWindow(nextRace.date, {
        startOffset: NEXT_RACE_PREP_START_OFFSET,
        endOffset: 0,
      })
    : { startKey: null, endKey: null, raceDateParts: null };

  const postRaceWindow = {
    active: isDateKeyInRange(todayKey, postRaceMeta.startKey, postRaceMeta.endKey),
    startKey: postRaceMeta.startKey,
    endKey: postRaceMeta.endKey,
    raceNumber: postRace?.raceNumber ?? null,
    track: postRace?.track ?? null,
    date: postRace?.date ?? null,
  };

  const nextRaceWindow = {
    active: isDateKeyInRange(todayKey, nextRaceMeta.startKey, nextRaceMeta.endKey),
    startKey: nextRaceMeta.startKey,
    endKey: nextRaceMeta.endKey,
    raceNumber: nextRace?.raceNumber ?? null,
    track: nextRace?.track ?? null,
    date: nextRace?.date ?? null,
  };

  const isOffWeek = !postRaceWindow.active && !nextRaceWindow.active;
  let phase = 'offweek';
  if (postRaceWindow.active && nextRaceWindow.active) phase = 'overlap';
  else if (postRaceWindow.active) phase = 'postRace';
  else if (nextRaceWindow.active) phase = 'nextRacePrep';

  return {
    todayKey,
    isOffWeek,
    phase,
    postRaceWindow,
    nextRaceWindow,
    latestCompletedRace: postRace?.raceNumber
      ? {
          raceNumber: postRace.raceNumber,
          track: postRace.track || null,
          date: postRace.date || null,
        }
      : null,
    nextUpcomingRace: nextRace?.raceNumber
      ? {
          raceNumber: nextRace.raceNumber,
          track: nextRace.track || null,
          date: nextRace.date || null,
        }
      : null,
  };
}

export function isWorkflowWindowActive(workflow, windowContext = {}) {
  if (workflow === 'postRace') return Boolean(windowContext?.postRaceWindow?.active);
  if (workflow === 'nextRace') return Boolean(windowContext?.nextRaceWindow?.active);
  return false;
}

export function computeWindowAwareTaskStatus({
  completed,
  dueDateKey,
  todayKey,
  hasRaceDate,
  windowActive = true,
  workflow,
  windowContext = null,
}) {
  if (completed) return 'done';

  if (!windowActive) {
    if (
      workflow === 'nextRace' &&
      windowContext?.nextRaceWindow?.startKey &&
      todayKey &&
      todayKey < windowContext.nextRaceWindow.startKey
    ) {
      return 'upcoming';
    }
    return 'inactive';
  }

  if (!hasRaceDate || !dueDateKey) return 'pending';
  if (dueDateKey > todayKey) return 'upcoming';
  if (dueDateKey === todayKey) return 'due';
  return 'overdue';
}
