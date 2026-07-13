import assert from 'node:assert/strict';
import {
  extractOfficialRaceField,
  isProvisionalRawResult,
  buildCanonicalOfficialRaceResult,
} from '../api/_simracerhub-schedule-results.js';
import {
  matchFantasyDriverToResult,
  calculateProvisionalDriverRacePoints,
  buildProvisionalDriverScore,
  formatPublicDriverScoreLabel,
} from '../api/_fantasy-race-scoring.js';
import { isDriverDnpInRace } from '../api/_fantasy-salary-guardrails.js';
import { DEFAULT_FANTASY_RACE_SCORING_CONFIG } from '../api/_fantasy-race-scoring-config.js';
import { summarizeProvisionalAllowanceFromLedger } from '../api/_fantasy-provisional-allowance.js';

function buildRace15Fixture() {
  const bucket = {};
  for (let finish = 1; finish <= 30; finish += 1) {
    bucket[String(1000 + finish)] = {
      driver_id: String(1000 + finish),
      finish_pos: String(finish),
      provisional: 'N',
      status: 'Running',
      session: 'RACE',
      count_stats: 'Y',
      qualify_pos: String(finish),
    };
  }
  bucket['36764'] = {
    driver_id: '36764',
    finish_pos: null,
    provisional: 'Y',
    status: 'Provisional',
    session: 'RACE',
    count_stats: 'Y',
    qualify_pos: null,
  };
  bucket['85687'] = {
    driver_id: '85687',
    finish_pos: null,
    provisional: 'Y',
    status: 'Provisional',
    session: 'RACE',
    count_stats: 'Y',
    qualify_pos: null,
  };

  return {
    schedule_id: '346499',
    drivers: {
      '366023': bucket,
    },
  };
}

// SRH provisional rows survive normalization
{
  const schedule = buildRace15Fixture();
  const field = extractOfficialRaceField(schedule);
  assert.equal(field.meta.officialStarterCount, 30);
  assert.equal(field.meta.provisionalCount, 2);
  assert.equal(field.meta.totalScoredFieldCount, 32);
  assert.equal(field.finishes['36764'], 31);
  assert.equal(field.finishes['85687'], 32);
  assert.equal(field.driverResults['36764'].isProvisional, true);
  assert.equal(field.driverResults['85687'].participationStatus, 'provisional');
}

// Physical starter count remains separate from total scored field
{
  const field = extractOfficialRaceField(buildRace15Fixture());
  assert.equal(Object.keys(field.finishes).length, 32);
  assert.equal(field.meta.officialStarterCount, 30);
}

// Multiple provisionals ordered in SRH bucket order
{
  const field = extractOfficialRaceField(buildRace15Fixture());
  assert.deepEqual(field.meta.provisionalDriverIds, ['36764', '85687']);
}

// Provisional receives base finish points only
{
  const points = calculateProvisionalDriverRacePoints(31, DEFAULT_FANTASY_RACE_SCORING_CONFIG);
  assert.equal(points.basePoints, 6);
  assert.equal(points.bonusPoints, 0);
  assert.equal(points.totalPoints, 6);
}

// Fantasy matching treats provisionals as official results, not DNP
{
  const field = extractOfficialRaceField(buildRace15Fixture());
  const match = matchFantasyDriverToResult(
    { driverId: '85687', driverName: 'Logan M Wilson', carNumber: '76' },
    { driverResults: field.driverResults, raceNumber: 15 },
  );
  assert.equal(match.matched, true);
  assert.equal(match.participationStatus, 'provisional');
  assert.notEqual(match.participationStatus, 'dnp');
  assert.notEqual(match.method, 'unresolved');
}

// Provisional score breakdown
{
  const field = extractOfficialRaceField(buildRace15Fixture());
  const scored = buildProvisionalDriverScore(
    DEFAULT_FANTASY_RACE_SCORING_CONFIG,
    field.driverResults['36764'],
    15,
  );
  assert.equal(scored.participation.participationStatus, 'provisional');
  assert.equal(scored.participation.countsTowardAttendance, false);
  assert.equal(scored.participation.countsTowardFantasy, true);
  assert.equal(scored.totalPoints, 6);
}

// Public label formatting
{
  const label = formatPublicDriverScoreLabel({
    driverName: 'Logan M Wilson',
    participationStatus: 'provisional',
    finishPosition: 32,
    points: 5,
  });
  assert.match(label, /Provisional/);
  assert.match(label, /32nd/);
}

// Salary attendance remains non-start for provisionals
{
  const alignedRace = {
    pointsRaceNumber: 15,
    finishes: { '85687': 32 },
    driverResults: {
      '85687': { isProvisional: true, finish: 32 },
    },
    provisionalDriverIds: ['85687'],
  };
  assert.equal(isDriverDnpInRace(alignedRace, '85687'), true);
}

// Allowance accounting from BP ledger entries only
{
  const allowance = summarizeProvisionalAllowanceFromLedger([
    { type: 'free' },
    { type: 'free' },
    { type: 'purchased' },
  ]);
  assert.equal(allowance.freeProvisionalsUsed, 2);
  assert.equal(allowance.freeProvisionalsRemaining, 0);
  assert.equal(allowance.purchasedProvisionalsUsed, 1);
  assert.equal(allowance.totalProvisionalsUsed, 3);
  assert.equal(allowance.source, 'bp-ledger');
}

// Raw provisional detection fields
{
  assert.equal(
    isProvisionalRawResult({ provisional: 'Y', status: 'Provisional', finish_pos: null }),
    true,
  );
  const canonical = buildCanonicalOfficialRaceResult(
    '85687',
    { provisional: 'Y', status: 'Provisional', finish_pos: null, session: 'RACE' },
    { isProvisional: true, assignedFinishPosition: 32 },
  );
  assert.equal(canonical.isProvisional, true);
  assert.equal(canonical.finishPosition, 32);
  assert.equal(canonical.source, 'simracerhub');
}

console.log('test-provisional-results.mjs: all scenarios passed');
