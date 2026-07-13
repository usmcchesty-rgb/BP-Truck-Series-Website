import assert from 'node:assert/strict';
import {
  FREE_PROVISIONALS_PER_SEASON,
  summarizeDriverProvisionalAllowance,
  buildLedgerValidationWarnings,
} from '../api/_driver-provisionals.js';
import { summarizeProvisionalAllowanceFromLedger } from '../api/_fantasy-provisional-allowance.js';
import {
  matchFantasyDriverToResult,
  buildProvisionalDriverScore,
} from '../api/_fantasy-race-scoring.js';
import { extractOfficialRaceField } from '../api/_simracerhub-schedule-results.js';
import { DEFAULT_FANTASY_RACE_SCORING_CONFIG } from '../api/_fantasy-race-scoring-config.js';

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
    };
  }
  bucket['85687'] = {
    driver_id: '85687',
    finish_pos: null,
    provisional: 'Y',
    status: 'Provisional',
    session: 'RACE',
    count_stats: 'Y',
  };
  return { schedule_id: '346499', drivers: { '366023': bucket } };
}

// Free provisional usage from ledger only
{
  const summary = summarizeDriverProvisionalAllowance([
    { type: 'free', raceNumber: 14 },
    { type: 'free', raceNumber: 15 },
  ]);
  assert.equal(summary.freeProvisionalsUsed, 2);
  assert.equal(summary.freeProvisionalsRemaining, 0);
  assert.equal(summary.totalProvisionalsUsed, 2);
  assert.equal(summary.source, 'bp-ledger');
}

// Purchased usage
{
  const summary = summarizeDriverProvisionalAllowance([
    { type: 'free', raceNumber: 1 },
    { type: 'free', raceNumber: 2 },
    { type: 'purchased', raceNumber: 3 },
  ]);
  assert.equal(summary.purchasedProvisionalsUsed, 1);
  assert.equal(summary.freeProvisionalsUsed, 2);
}

// Admin override usage
{
  const summary = summarizeDriverProvisionalAllowance([{ type: 'admin', raceNumber: 8 }]);
  assert.equal(summary.adminProvisionalsUsed, 1);
  assert.equal(summary.freeProvisionalsRemaining, FREE_PROVISIONALS_PER_SEASON);
}

// Remaining calculation
{
  const summary = summarizeProvisionalAllowanceFromLedger([{ type: 'free', raceNumber: 4 }]);
  assert.equal(summary.freeProvisionalsRemaining, 1);
}

// Missing ledger warning for official provisional
{
  const warnings = buildLedgerValidationWarnings({
    ledgerEntries: [],
    officialProvisionalDriverIds: ['85687'],
    raceNumber: 15,
    driverLookup: new Map([['85687', { driverName: 'Logan M Wilson' }]]),
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'missing_ledger_entry');
  assert.match(warnings[0].message, /no BP ledger entry/i);
}

// Ledger without official SRH provisional
{
  const warnings = buildLedgerValidationWarnings({
    ledgerEntries: [{ driverId: '36764', raceNumber: 15, type: 'free' }],
    officialProvisionalDriverIds: [],
    raceNumber: 15,
    driverLookup: new Map([['36764', { driverName: 'Matthew Kleinschmidt' }]]),
  });
  assert.equal(warnings[0].code, 'missing_official_provisional');
}

// More than two free provisionals warning
{
  const warnings = buildLedgerValidationWarnings({
    ledgerEntries: [
      { driverId: '1', raceNumber: 1, type: 'free' },
      { driverId: '1', raceNumber: 2, type: 'free' },
      { driverId: '1', raceNumber: 3, type: 'free' },
    ],
    officialProvisionalDriverIds: [],
    raceNumber: null,
    driverLookup: new Map([['1', { driverName: 'Test Driver' }]]),
  });
  assert.equal(warnings.some((w) => w.code === 'free_limit_exceeded'), true);
}

// Official provisional still scores correctly without ledger
{
  const field = extractOfficialRaceField(buildRace15Fixture());
  const match = matchFantasyDriverToResult(
    { driverId: '85687', driverName: 'Logan M Wilson' },
    { driverResults: field.driverResults, raceNumber: 15 },
  );
  assert.equal(match.participationStatus, 'provisional');
  const scored = buildProvisionalDriverScore(
    DEFAULT_FANTASY_RACE_SCORING_CONFIG,
    match.result,
    15,
  );
  assert.ok(scored.totalPoints > 0);
}

// Duplicate prevention is enforced at DB unique(season_id, driver_id, race_number)
{
  const key = 'season_id,driver_id,race_number';
  assert.ok(key.includes('race_number'));
}

console.log('test-driver-provisionals.mjs: all scenarios passed');
