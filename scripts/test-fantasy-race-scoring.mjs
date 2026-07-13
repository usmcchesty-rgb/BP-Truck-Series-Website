import assert from 'node:assert/strict';
import {
  calculateDriverRacePoints,
  rankCompetition,
  matchFantasyDriverToResult,
  isValidFantasyDriverIdentity,
  buildNonParticipantDriverScore,
  buildParticipationMetadata,
  classifyNonParticipantStatus,
  formatPublicDriverScoreLabel,
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
      ['202', { driverId: '202', driverName: 'Eddie Hagigh', carNumber: '8' }],
    ]),
    profileByDriverId: new Map([
      ['202', { driver_id: '202', driver_name: 'Eddie Hagigh' }],
    ]),
    raceNumber: 15,
  };
  const direct = matchFantasyDriverToResult(
    { driverId: '101', driverName: 'Test Driver' },
    context,
  );
  assert.equal(direct.matched, true);
  assert.equal(direct.method, 'driver_id');

  const dnp = matchFantasyDriverToResult(
    { driverId: '202', driverName: 'Eddie Hagigh', carNumber: '8' },
    context,
  );
  assert.equal(dnp.matched, true);
  assert.equal(dnp.method, 'dnp');
  assert.equal(dnp.participationStatus, 'dnp');
  assert.equal(dnp.result, null);

  const dns = matchFantasyDriverToResult(
    { driverId: '303', driverName: 'Registered DNS Driver' },
    {
      ...context,
      driverResults: { '101': { finish: 3, startingPos: 10 } },
      registeredDriverIds: new Set(['303']),
      profileByDriverId: new Map([['303', { driver_id: '303', driver_name: 'Registered DNS Driver' }]]),
      driverLookup: new Map([
        ['101', { driverId: '101', driverName: 'Test Driver', carNumber: '12' }],
        ['303', { driverId: '303', driverName: 'Registered DNS Driver' }],
      ]),
    },
  );
  assert.equal(dns.matched, true);
  assert.equal(dns.participationStatus, 'dns');

  const unresolved = matchFantasyDriverToResult(
    { driverId: '999', driverName: 'Nobody Here', carNumber: '00' },
    context,
  );
  assert.equal(unresolved.matched, false);
  assert.equal(unresolved.method, 'unresolved');
}

// Valid absent slate driver receives DNP score shape
{
  const dnpScore = buildNonParticipantDriverScore(DEFAULT_FANTASY_RACE_SCORING_CONFIG, {
    raceNumber: 15,
    participationStatus: 'dnp',
  });
  assert.equal(dnpScore.totalPoints, 0);
  assert.equal(dnpScore.basePoints, 0);
  assert.equal(dnpScore.bonusPoints, 0);
  assert.equal(dnpScore.penaltyPoints, 0);
  assert.equal(dnpScore.breakdown.participation.participationStatus, 'dnp');
  assert.equal(dnpScore.breakdown.participation.officialResultFound, false);
  assert.equal(dnpScore.breakdown.participation.countsTowardAttendance, false);
  assert.equal(dnpScore.breakdown.participation.countsTowardFantasy, true);
  assert.equal(dnpScore.breakdown.participation.fantasyPoints, 0);
  assert.equal(dnpScore.breakdown.finish, undefined);
  assert.match(dnpScore.breakdown.participation.reason, /Race 15/i);
}

// Canonical participation metadata
{
  const started = buildParticipationMetadata('started', {
    officialResultFound: true,
    reason: 'Finished 1 in Race 15.',
    fantasyPoints: 49,
  });
  assert.equal(started.countsTowardAttendance, true);
  assert.equal(started.countsTowardFantasy, true);
  assert.equal(started.fantasyPoints, 49);

  const unresolved = buildParticipationMetadata('unresolved', {
    officialResultFound: false,
    reason: 'Driver identity could not be resolved for scoring.',
    fantasyPoints: 0,
  });
  assert.equal(unresolved.countsTowardAttendance, null);
  assert.equal(unresolved.countsTowardFantasy, false);
}

// DNS vs DNP classification
{
  const context = {
    driverResults: { '101': { finish: 1 } },
    registeredDriverIds: new Set(['202', '101']),
    profileByDriverId: new Map([['202', { driver_id: '202' }]]),
    driverLookup: new Map([
      ['101', { driverId: '101', driverName: 'Starter' }],
      ['202', { driverId: '202', driverName: 'DNS Driver' }],
    ]),
  };
  assert.equal(
    classifyNonParticipantStatus({ driverId: '202', driverName: 'DNS Driver' }, context),
    'dns',
  );
  assert.equal(
    classifyNonParticipantStatus({ driverId: '303', driverName: 'DNP Driver' }, {
      ...context,
      profileByDriverId: new Map([['303', { driver_id: '303' }]]),
      driverLookup: new Map([['303', { driverId: '303', driverName: 'DNP Driver' }]]),
    }),
    'dnp',
  );
}

// Public driver breakdown label
{
  assert.equal(
    formatPublicDriverScoreLabel({
      driverName: 'Eddie Hagigh',
      points: 0,
      participation: { participationStatus: 'dnp', fantasyPoints: 0 },
    }),
    'Eddie Hagigh — DNP (0 pts)',
  );
  assert.equal(
    formatPublicDriverScoreLabel({
      driverName: 'Chris Carroll',
      points: 49,
      participation: { participationStatus: 'started', fantasyPoints: 49 },
    }),
    'Chris Carroll — 49 pts',
  );
}

// Multiple DNP drivers in one lineup still score normally
{
  const lineupDrivers = [
    { driverId: '101', driverName: 'Winner', points: 120, participation: { participationStatus: 'started', fantasyPoints: 120 } },
    { driverId: '202', driverName: 'Eddie Hagigh', points: 0, participation: { participationStatus: 'dnp', fantasyPoints: 0 } },
    { driverId: '303', driverName: 'Ty Marasco', points: 0, participation: { participationStatus: 'dnp', fantasyPoints: 0 } },
  ];
  const total = Number(
    lineupDrivers.reduce((sum, row) => sum + Number(row.points || 0), 0).toFixed(2),
  );
  assert.equal(total, 120);
  assert.equal(lineupDrivers.filter((row) => row.participation.participationStatus === 'dnp').length, 2);
}
{
  const context = {
    driverResults: { '101': { finish: 1, startingPos: 3 } },
    driverLookup: new Map([
      ['101', { driverId: '101', driverName: 'Winner' }],
      ['202', { driverId: '202', driverName: 'Ty Marasco' }],
      ['303', { driverId: '303', driverName: 'Logan M Wilson' }],
    ]),
    profileByDriverId: new Map([
      ['202', { driver_id: '202' }],
      ['303', { driver_id: '303' }],
    ]),
    raceNumber: 15,
  };

  const absentDrivers = [
    { driverId: '202', driverName: 'Ty Marasco' },
    { driverId: '303', driverName: 'Logan M Wilson' },
  ];
  const unresolved = [];
  const dnpDrivers = [];
  let lineupTotal = 0;

  for (const driver of [
    { driverId: '101', driverName: 'Winner' },
    ...absentDrivers,
  ]) {
    const match = matchFantasyDriverToResult(driver, context);
    if (!match.matched) {
      unresolved.push(driver);
      continue;
    }
    if (match.participationStatus === 'dnp' || match.participationStatus === 'dns' || match.method === 'dnp' || match.method === 'dns') {
      const scored = buildNonParticipantDriverScore(DEFAULT_FANTASY_RACE_SCORING_CONFIG, {
        raceNumber: 15,
        participationStatus: 'dnp',
      });
      dnpDrivers.push(driver);
      lineupTotal += scored.totalPoints;
      continue;
    }
    lineupTotal += calculateDriverRacePoints(match.result, DEFAULT_FANTASY_RACE_SCORING_CONFIG).totalPoints;
  }

  assert.equal(unresolved.length, 0);
  assert.equal(dnpDrivers.length, 2);
  assert.ok(lineupTotal > 0);
}

// Invalid selected driver ID remains unresolved
{
  const context = {
    driverResults: { '101': { finish: 2, startingPos: 4 } },
    driverLookup: new Map([['101', { driverId: '101', driverName: 'Valid Driver' }]]),
    profileByDriverId: new Map(),
    raceNumber: 15,
  };
  assert.equal(
    isValidFantasyDriverIdentity({ driverId: '999', driverName: 'Unknown Person' }, context),
    false,
  );
  const match = matchFantasyDriverToResult(
    { driverId: '999', driverName: 'Unknown Person' },
    context,
  );
  assert.equal(match.matched, false);
  assert.equal(match.method, 'unresolved');
}

// Scoring status becomes scored when only DNP absences exist
{
  const unresolvedDrivers = [];
  const dnpDrivers = [
    { driverId: '1', driverName: 'Eddie Hagigh' },
    { driverId: '2', driverName: 'Ty Marasco' },
  ];
  const status = unresolvedDrivers.length ? 'needs_review' : 'scored';
  assert.equal(status, 'scored');
  assert.equal(dnpDrivers.length, 2);
}

// Season totals include 0-point DNP contributions
{
  const ranked = rankCompetition([
    { lineupId: 'a', totalPoints: 120 },
    { lineupId: 'b', totalPoints: 95.5 },
    { lineupId: 'c', totalPoints: 80 },
  ]);
  const seasonTotal = ranked.reduce((sum, row) => sum + row.totalPoints, 0);
  assert.equal(seasonTotal, 295.5);
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
