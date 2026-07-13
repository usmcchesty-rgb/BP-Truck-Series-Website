import assert from 'node:assert/strict';
import {
  buildOfficialProvisionalRows,
  resolveAutoProvisionalType,
  buildAutoSyncMetadata,
  buildProvisionalSyncMessage,
  summarizeProvisionalLedgerSyncStatus,
  syncOfficialProvisionalsToLedger,
  clearProvisionalSyncCache,
} from '../api/_driver-provisional-sync.js';
import { FREE_PROVISIONALS_PER_SEASON } from '../api/_driver-provisionals.js';

const driverLookup = new Map([
  ['36764', { driverName: 'Matthew Kleinschmidt2' }],
  ['85687', { driverName: 'Logan M Wilson' }],
  ['99999', { driverName: 'Unknown Driver' }],
]);

// Official rows from driverResults
{
  const rows = buildOfficialProvisionalRows(
    {
      '36764': { isProvisional: true, finishPosition: 31, status: 'Provisional' },
      '85687': { isProvisional: true, finish: 32, status: 'Provisional' },
      '1001': { isProvisional: false, finish: 1 },
    },
    driverLookup,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].driverId, '36764');
  assert.equal(rows[1].finishPosition, 32);
}

// First official provisional auto-creates Free
{
  const decision = resolveAutoProvisionalType([], 15);
  assert.equal(decision.type, 'free');
  assert.equal(decision.needsReview, false);
}

// Second official provisional auto-creates Free
{
  const decision = resolveAutoProvisionalType(
    [{ type: 'free', raceNumber: 10 }],
    15,
  );
  assert.equal(decision.type, 'free');
  assert.equal(decision.needsReview, false);
}

// Third official provisional requires review
{
  const decision = resolveAutoProvisionalType(
    [
      { type: 'free', raceNumber: 10 },
      { type: 'free', raceNumber: 12 },
    ],
    15,
  );
  assert.equal(decision.type, 'admin');
  assert.equal(decision.needsReview, true);
  assert.match(decision.notes, /free allowance exhausted/i);
}

// Current race free usage does not count against itself
{
  const decision = resolveAutoProvisionalType(
    [{ type: 'free', raceNumber: 15 }],
    15,
  );
  assert.equal(decision.type, 'free');
}

// Metadata shape
{
  const metadata = buildAutoSyncMetadata({
    finishPosition: 31,
    status: 'Provisional',
    needsReview: false,
  });
  assert.equal(metadata.source, 'simracerhub');
  assert.equal(metadata.autoCreated, true);
  assert.equal(metadata.officialFinishPosition, 31);
  assert.equal(metadata.officialStatus, 'Provisional');
}

// Repeated sync creates no duplicate
{
  clearProvisionalSyncCache('27987', 15);
  const createdEntries = [];
  const officialRows = [
    { driverId: '36764', driverName: 'Matthew Kleinschmidt2', finishPosition: 31, status: 'Provisional' },
    { driverId: '85687', driverName: 'Logan M Wilson', finishPosition: 32, status: 'Provisional' },
  ];

  const first = await syncOfficialProvisionalsToLedger({
    seasonId: '27987',
    raceNumber: 15,
    officialProvisionalRows: officialRows,
    existingEntries: [],
    knownDriverIds: new Set(['36764', '85687']),
    driverLookup,
    useCache: false,
    insertEntry: async (payload) => {
      const entry = {
        id: createdEntries.length + 1,
        seasonId: payload.seasonId,
        driverId: payload.driverId,
        raceNumber: payload.raceNumber,
        type: payload.type,
        notes: payload.notes || '',
        metadata: payload.metadata || {},
        createdBy: payload.createdBy,
      };
      createdEntries.push(entry);
      return entry;
    },
  });

  const second = await syncOfficialProvisionalsToLedger({
    seasonId: '27987',
    raceNumber: 15,
    officialProvisionalRows: officialRows,
    existingEntries: createdEntries,
    knownDriverIds: new Set(['36764', '85687']),
    driverLookup,
    useCache: false,
    insertEntry: async () => {
      throw new Error('should not insert on second sync');
    },
  });

  assert.equal(first.created.length, 2);
  assert.equal(second.created.length, 0);
  assert.equal(second.preserved, 2);
}

// Existing Purchased entry is preserved
{
  const existing = [
    {
      driverId: '36764',
      raceNumber: 15,
      type: 'purchased',
      metadata: { autoCreated: false },
    },
  ];
  const result = await syncOfficialProvisionalsToLedger({
    seasonId: '27987',
    raceNumber: 15,
    officialProvisionalRows: [
      { driverId: '36764', driverName: 'Matthew Kleinschmidt2', finishPosition: 31, status: 'Provisional' },
    ],
    existingEntries: existing,
    knownDriverIds: new Set(['36764']),
    driverLookup,
    useCache: false,
    insertEntry: async () => {
      throw new Error('duplicate should not be inserted');
    },
  });
  assert.equal(result.created.length, 0);
  assert.equal(result.preserved, 1);
}

// Existing Admin entry is preserved
{
  const result = await syncOfficialProvisionalsToLedger({
    seasonId: '27987',
    raceNumber: 15,
    officialProvisionalRows: [
      { driverId: '85687', driverName: 'Logan M Wilson', finishPosition: 32, status: 'Provisional' },
    ],
    existingEntries: [
      { driverId: '85687', raceNumber: 15, type: 'admin', metadata: { needsReview: true } },
    ],
    knownDriverIds: new Set(['85687']),
    driverLookup,
    useCache: false,
    insertEntry: async () => {
      throw new Error('should not insert');
    },
  });
  assert.equal(result.needsReview.length, 1);
  assert.equal(result.created.length, 0);
}

// Unmatched driver produces warning
{
  const result = await syncOfficialProvisionalsToLedger({
    seasonId: '27987',
    raceNumber: 15,
    officialProvisionalRows: [
      { driverId: '99999', driverName: 'Unknown Driver', finishPosition: 31, status: 'Provisional' },
    ],
    existingEntries: [],
    knownDriverIds: new Set(['36764', '85687']),
    driverLookup,
    useCache: false,
  });
  assert.equal(result.created.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'unmatched_driver');
}

// Ledger-only row is not auto-deleted
{
  const warnings = [];
  const status = summarizeProvisionalLedgerSyncStatus({
    officialProvisionalRows: [],
    raceEntries: [{ driverId: '36764', raceNumber: 15, type: 'free' }],
    syncWarnings: warnings,
    needsReview: [],
  });
  assert.equal(status.ledgerOnlyCount, 1);
  assert.equal(status.complete, true);
}

// Multiple races accumulate seasonal allowance correctly
{
  const decision = resolveAutoProvisionalType(
    [
      { type: 'free', raceNumber: 5 },
      { type: 'free', raceNumber: 9 },
    ],
    15,
  );
  assert.equal(decision.type, 'admin');
  assert.equal(FREE_PROVISIONALS_PER_SEASON, 2);
}

// Sync status message
{
  const message = buildProvisionalSyncMessage({
    created: [{ driverId: '36764' }, { driverId: '85687' }],
    needsReview: [],
  });
  assert.match(message, /2 official provisionals auto-added/i);
}

// Cached results avoid duplicate work
{
  clearProvisionalSyncCache('27987', 20);
  let insertCount = 0;
  const officialRows = [
    { driverId: '36764', driverName: 'Matthew Kleinschmidt2', finishPosition: 31, status: 'Provisional' },
  ];
  const entries = [];

  await syncOfficialProvisionalsToLedger({
    seasonId: '27987',
    raceNumber: 20,
    officialProvisionalRows: officialRows,
    existingEntries: entries,
    knownDriverIds: new Set(['36764']),
    driverLookup,
    useCache: true,
    insertEntry: async (payload) => {
      insertCount += 1;
      const entry = {
        driverId: payload.driverId,
        raceNumber: payload.raceNumber,
        type: payload.type,
        metadata: payload.metadata,
      };
      entries.push(entry);
      return entry;
    },
  });

  await syncOfficialProvisionalsToLedger({
    seasonId: '27987',
    raceNumber: 20,
    officialProvisionalRows: officialRows,
    existingEntries: entries,
    knownDriverIds: new Set(['36764']),
    driverLookup,
    useCache: true,
    insertEntry: async () => {
      insertCount += 1;
      throw new Error('cache bypassed');
    },
  });

  assert.equal(insertCount, 1);
}

console.log('test-driver-provisional-sync.mjs: all scenarios passed');
