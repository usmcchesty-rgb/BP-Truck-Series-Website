import assert from 'node:assert/strict';
import {
  getEffectiveRaceDateStatus,
  getEffectivePointsRaceProgression,
  parseScheduleDateParts,
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

const raceDate = 'Jun 14, 2025';

const beforeLock = makeEasternInstant({ year: 2025, month: 6, day: 14, hour: 16, minute: 0 });
const beforeLockStatus = getEffectiveRaceDateStatus({
  raceDate,
  hasResults: false,
  now: beforeLock,
});

assert.equal(beforeLockStatus.isRaceDay, true);
assert.equal(beforeLockStatus.isUpcoming, true);
assert.equal(beforeLockStatus.canAdvanceToNextRace, false);
assert.equal(beforeLockStatus.advanceReason, 'race-day-before-9pm-et');

const afterLock = makeEasternInstant({ year: 2025, month: 6, day: 14, hour: 21, minute: 1 });
const afterLockStatus = getEffectiveRaceDateStatus({
  raceDate,
  hasResults: false,
  now: afterLock,
});

assert.equal(afterLockStatus.isRaceDay, true);
assert.equal(afterLockStatus.canAdvanceToNextRace, true);
assert.equal(afterLockStatus.advanceReason, 'race-day-after-9pm-et-no-results');

const resultsOverride = makeEasternInstant({ year: 2025, month: 6, day: 14, hour: 16, minute: 0 });
const resultsStatus = getEffectiveRaceDateStatus({
  raceDate,
  hasResults: true,
  now: resultsOverride,
});

assert.equal(resultsStatus.isCompleted, true);
assert.equal(resultsStatus.canAdvanceToNextRace, true);
assert.equal(resultsStatus.advanceReason, 'results-posted');

const schedule = enrichScheduleRaces([
  { scheduleRow: 11, date: 'May 31, 2025', points: 'Yes', track: 'Rockingham', winner: 'Driver A' },
  { scheduleRow: 12, date: 'Jun 14, 2025', points: 'Yes', track: 'Iowa', winner: '' },
  { scheduleRow: 13, date: 'Jun 28, 2025', points: 'Yes', track: 'Charlotte', winner: '' },
]);

const lockedProgression = getEffectivePointsRaceProgression(schedule, { now: beforeLock });
assert.equal(lockedProgression.suggestedPointsRaceNumber, 2);
assert.equal(lockedProgression.currentUpcomingPointsRace?.officialPointsRaceNumber, 2);

const advancedProgression = getEffectivePointsRaceProgression(schedule, { now: afterLock });
assert.equal(advancedProgression.suggestedPointsRaceNumber, 3);
assert.equal(advancedProgression.currentUpcomingPointsRace?.officialPointsRaceNumber, 3);

console.log('race-date-status tests passed');
