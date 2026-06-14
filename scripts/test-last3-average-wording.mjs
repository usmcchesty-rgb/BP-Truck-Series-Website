/**
 * Regression checks for last-3 average wording with partial starts / DNPs.
 * Run: node scripts/test-last3-average-wording.mjs
 */
import {
  validateLast3AverageFinishWording,
  validateMissedRaceMentions,
  validateWriteupVerifiedEvidence,
} from '../api/_power-rankings-factual-grounding.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const justinGrounding = {
  driverName: 'Justin Levine',
  last3RaceAverageFinish: 1.0,
  last3RaceStarts: 2,
  last3RaceWindowSize: 3,
  last3RaceDnpCount: 1,
  missedRecentRaceNames: ['Rockingham Speedway Oval'],
  missedRecentRaces: [{ raceNumber: 10, track: 'Rockingham Speedway Oval' }],
  recentRaceFinishes: [
    { raceNumber: 11, track: 'Charlotte Motor Speedway Oval Night', finish: 1 },
    { raceNumber: 12, track: 'Iowa Speedway Oval Night', finish: 1 },
  ],
  allowedSeasonStats: {
    pointsPosition: 23,
    pointsTotal: 100,
    winsTotal: 2,
    top5Total: 2,
    top10Total: 2,
  },
};

const context = {
  rank: 1,
  driverGrounding: justinGrounding,
  factualGrounding: justinGrounding,
};

const bad = validateLast3AverageFinishWording(
  'Back-to-back wins produced an average finish of 1.0 over the last three races, enough to jump to the top spot.',
  context
);
assert(bad.error, 'Expected misleading last-3 average wording to fail validation');
assert(
  bad.errorType === 'misleading-last3-average-wording',
  `Expected misleading-last3-average-wording, got ${bad.errorType}`
);

const badAcross = validateLast3AverageFinishWording(
  'An average finish of 1.0 across the last three races supports the top ranking this week.',
  context
);
assert(badAcross.error, 'Expected "across the last three races" to fail with only 2 starts');

const good = validateLast3AverageFinishWording(
  'Back-to-back wins at Charlotte and Iowa produced an average finish of 1.0 across 2 starts in the last 3 races, despite missing Rockingham.',
  context
);
assert(!good.error, `Expected valid partial-start wording, got: ${good.error}`);

const goodMissed = validateMissedRaceMentions(
  'Back-to-back wins despite missing Rockingham produced an average finish of 1.0 across 2 starts in the last 3 races.',
  context
);
assert(!goodMissed.error, `Expected verified missed-race mention, got: ${goodMissed.error}`);

const badMissed = validateMissedRaceMentions(
  'Strong form despite missing Talladega keeps the momentum rolling.',
  context
);
assert(badMissed.error, 'Expected unsupported missed-race mention to fail');
assert(
  badMissed.errorType === 'unsupported-missed-race-mention',
  `Expected unsupported-missed-race-mention, got ${badMissed.errorType}`
);

const fullWindowGrounding = {
  ...justinGrounding,
  last3RaceStarts: 3,
  last3RaceWindowSize: 3,
  last3RaceDnpCount: 0,
  missedRecentRaceNames: [],
  recentRaceFinishes: [
    { raceNumber: 10, track: 'Rockingham Speedway Oval', finish: 5 },
    { raceNumber: 11, track: 'Charlotte Motor Speedway Oval Night', finish: 1 },
    { raceNumber: 12, track: 'Iowa Speedway Oval Night', finish: 1 },
  ],
  last3RaceAverageFinish: 2.3,
};

const fullOk = validateLast3AverageFinishWording(
  'An average finish of 2.3 across the last three races keeps the driver in contention.',
  { rank: 3, driverGrounding: fullWindowGrounding, factualGrounding: fullWindowGrounding }
);
assert(!fullOk.error, `Expected full-window wording to pass, got: ${fullOk.error}`);

console.log('All last-3 average wording regression checks passed.');
