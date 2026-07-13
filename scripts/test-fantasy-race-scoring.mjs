import assert from 'node:assert/strict';
import {
  calculateDriverRacePoints,
  rankCompetition,
  matchFantasyDriverToResult,
} from '../api/_fantasy-race-scoring.js';
import {
  finishPositionPoints,
  DEFAULT_FANTASY_RACE_SCORING_CONFIG,
} from '../api/_fantasy-race-scoring-config.js';
import { evaluateAutomaticTask } from '../api/_mission-control-task-engine.js';

// Finish points formula
{
  assert.equal(finishPositionPoints(1), 40);
  assert.equal(finishPositionPoints(2), 35);
  assert.equal(finishPositionPoints(3), 34);
  assert.equal(finishPositionPoints(4), 33);
  assert.equal(finishPositionPoints(10), 27);
}

// Five-driver lineup total
{
  const drivers = [
    { finish: 1, startingPos: 5 },
    { finish: 4, startingPos: 8 },
    { finish: 10, startingPos: 12 },
    { finish: 15, startingPos: 20 },
    { finish: 22, startingPos: 25 },
  ];
  const total = drivers.reduce(
    (sum, row) => sum + calculateDriverRacePoints(row, DEFAULT_FANTASY_RACE_SCORING_CONFIG).totalPoints,
    0,
  );
  assert.ok(total > 0);
  assert.equal(
    Number(total.toFixed(2)),
    Number(
      drivers
        .map((row) => calculateDriverRacePoints(row, DEFAULT_FANTASY_RACE_SCORING_CONFIG).totalPoints)
        .reduce((a, b) => a + b, 0)
        .toFixed(2),
    ),
  );
}

// Win / top5 / top10 / positions gained bonuses
{
  const winner = calculateDriverRacePoints({ finish: 1, startingPos: 8 }, DEFAULT_FANTASY_RACE_SCORING_CONFIG);
  assert.equal(winner.basePoints, 40);
  assert.ok(winner.bonusPoints >= 5 + 3 + 1);
  assert.ok(winner.breakdown.bonuses.positionsGained > 0);
}

// DNS / no finish
{
  const dns = calculateDriverRacePoints({ finish: null }, DEFAULT_FANTASY_RACE_SCORING_CONFIG);
  assert.equal(dns.totalPoints, 0);
}

// DNF still earns finish points
{
  const dnf = calculateDriverRacePoints({ finish: 28, startingPos: 10 }, DEFAULT_FANTASY_RACE_SCORING_CONFIG);
  assert.ok(dnf.totalPoints > 0);
}

// Tie rankings — competition ranking (1,2,2,4)
{
  const ranked = rankCompetition([
    { lineupId: 'a', totalPoints: 100 },
    { lineupId: 'b', totalPoints: 90 },
    { lineupId: 'c', totalPoints: 90 },
    { lineupId: 'd', totalPoints: 80 },
  ]);
  assert.deepEqual(
    ranked.map((row) => row.rank),
    [1, 2, 2, 4],
  );
}

// Driver matching priority
{
  const context = {
    driverResults: {
      '101': { finish: 3, startingPos: 10 },
    },
    driverLookup: new Map([
      ['101', { driverId: '101', driverName: 'Test Driver', carNumber: '12' }],
    ]),
    profileByDriverId: new Map(),
    raceNumber: 14,
  };
  const direct = matchFantasyDriverToResult(
    { driverId: '101', driverName: 'Test Driver' },
    context,
  );
  assert.equal(direct.matched, true);
  assert.equal(direct.method, 'driver_id');

  const unresolved = matchFantasyDriverToResult(
    { driverId: '999', driverName: 'Nobody Here', carNumber: '00' },
    context,
  );
  assert.equal(unresolved.matched, false);
}

// Mission Control detection
{
  const missingResults = evaluateAutomaticTask('sun-score-fantasy-lineups', {
    postRace: { raceNumber: 14 },
    fantasyScoringStatus: {
      raceComplete: true,
      resultsReady: false,
      status: 'not_ready',
      resultsReason: 'Official race results are not available yet.',
    },
  });
  assert.equal(missingResults.complete, false);
  assert.match(missingResults.reason, /not available yet/i);

  const ready = evaluateAutomaticTask('sun-score-fantasy-lineups', {
    postRace: { raceNumber: 14 },
    fantasyScoringStatus: {
      raceComplete: true,
      resultsReady: true,
      status: 'ready',
      lineupCount: 5,
    },
  });
  assert.equal(ready.complete, false);
  assert.match(ready.reason, /ready/i);

  const scored = evaluateAutomaticTask('sun-score-fantasy-lineups', {
    postRace: { raceNumber: 14 },
    fantasyScoringStatus: {
      raceComplete: true,
      resultsReady: true,
      status: 'scored',
      lineupCount: 8,
      scoringMeta: { lineupCount: 8, scoringVersion: 'fantasy-race-v1-default' },
    },
  });
  assert.equal(scored.complete, true);
  assert.match(scored.reason, /8 lineups scored/i);

  const review = evaluateAutomaticTask('sun-score-fantasy-lineups', {
    postRace: { raceNumber: 14 },
    fantasyScoringStatus: {
      raceComplete: true,
      resultsReady: true,
      status: 'needs_review',
      unresolvedDrivers: [{ driverId: '1', driverName: 'Unknown' }],
    },
  });
  assert.equal(review.complete, false);
  assert.match(review.reason, /unresolved driver mapping/i);
}

console.log('test-fantasy-race-scoring.mjs: all scenarios passed');
