import assert from 'node:assert/strict';
import {
  getEffectiveRaceDateStatus,
  getEffectivePointsRaceProgression,
  parseScheduleDateParts,
  parseRaceStartTimeToMinutes,
  resolveRaceProgressionSettings,
} from '../api/_race-date-status.js';
import { enrichScheduleRaces } from '../api/_schedule-points-races.js';

function makeEasternInstant({ year, month, day, hour, minute = 0 }) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  for (let offsetHours = -8; offsetHours <= 12; offsetHours += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0));
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value])
    );
    if (
      Number(parts.year) === year &&
      Number(parts.month) === month &&
      Number(parts.day) === day &&
      Number(parts.hour) === hour &&
      Number(parts.minute) === minute
    ) {
      return candidate;
    }
  }

  throw new Error(`Unable to build Eastern instant for ${year}-${month}-${day} ${hour}:${minute}`);
}

assert.deepEqual(parseScheduleDateParts('Jun 14, 2025'), {
  year: 2025,
  month: 6,
  day: 14,
});

assert.equal(parseRaceStartTimeToMinutes('6:30 PM ET'), 18 * 60 + 30);

const progressionSettings = resolveRaceProgressionSettings({
  raceStartTime: '6:30 PM ET',
  raceCompletionBufferMinutes: 180,
});

assert.equal(progressionSettings.effectiveAdvanceTime, '9:30 PM ET');

const raceDate = 'Jun 14, 2025';
const statusOptions = {
  raceStartTime: '6:30 PM ET',
  completionBufferMinutes: 180,
};

const beforeLock = makeEasternInstant({ year: 2025, month: 6, day: 14, hour: 16, minute: 0 });
const beforeLockStatus = getEffectiveRaceDateStatus({
  raceDate,
  hasResults: false,
  now: beforeLock,
  ...statusOptions,
});

assert.equal(beforeLockStatus.isRaceDay, true);
assert.equal(beforeLockStatus.isUpcoming, true);
assert.equal(beforeLockStatus.canAdvanceToNextRace, false);
assert.equal(beforeLockStatus.advanceReason, 'race-day-before-configured-completion-window');
assert.equal(beforeLockStatus.effectiveAdvanceTime, '9:30 PM ET');

const afterLock = makeEasternInstant({ year: 2025, month: 6, day: 14, hour: 21, minute: 31 });
const afterLockStatus = getEffectiveRaceDateStatus({
  raceDate,
  hasResults: false,
  now: afterLock,
  ...statusOptions,
});

assert.equal(afterLockStatus.canAdvanceToNextRace, true);
assert.equal(afterLockStatus.advanceReason, 'race-day-after-configured-completion-window');

const resultsOverride = makeEasternInstant({ year: 2025, month: 6, day: 14, hour: 20, minute: 45 });
const resultsStatus = getEffectiveRaceDateStatus({
  raceDate,
  hasResults: true,
  now: resultsOverride,
  ...statusOptions,
});

assert.equal(resultsStatus.isCompleted, true);
assert.equal(resultsStatus.advanceReason, 'results-posted');

const fallbackSettings = resolveRaceProgressionSettings({
  raceStartTime: 'invalid',
  raceCompletionBufferMinutes: 180,
});

assert.equal(fallbackSettings.effectiveAdvanceTime, '9:00 PM ET');
assert.equal(fallbackSettings.usingFallbackStart, true);

const schedule = enrichScheduleRaces([
  { scheduleRow: 11, date: 'May 31, 2025', points: 'Yes', track: 'Rockingham', winner: 'Driver A' },
  { scheduleRow: 12, date: 'Jun 14, 2025', points: 'Yes', track: 'Iowa', winner: '' },
  { scheduleRow: 13, date: 'Jun 28, 2025', points: 'Yes', track: 'Charlotte', winner: '' },
]);

const progressionOptions = {
  now: beforeLock,
  settings: {
    raceStartTime: '6:30 PM ET',
    raceCompletionBufferMinutes: 180,
  },
};

const lockedProgression = getEffectivePointsRaceProgression(schedule, progressionOptions);
assert.equal(lockedProgression.suggestedPointsRaceNumber, 2);

const advancedProgression = getEffectivePointsRaceProgression(schedule, {
  ...progressionOptions,
  now: afterLock,
});
assert.equal(advancedProgression.suggestedPointsRaceNumber, 3);

console.log('race-date-status tests passed');
