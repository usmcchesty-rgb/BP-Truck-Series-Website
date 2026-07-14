import assert from 'node:assert/strict';
import {
  compareDraftToEligiblePool,
  enrichStandingsRowWithProfile,
  filterEligibleStandingsRows,
  FANTASY_DRIVER_POOL_EXCLUSIONS,
  resolveFantasyDriverActivity,
  resolveFantasyDriverEligibility,
  resolveProfileForStandingsRow,
} from '../api/_fantasy-driver-pool.js';

function activeContext(extra = {}) {
  return {
    activity: {
      active: true,
      consecutiveMissedRaces: 0,
      ...extra,
    },
    ...extra,
  };
}

const bradProfile = {
  driver_id: '17343',
  slug: 'brad-collins',
  iracing_customer_id: '17343',
  iracing_name: 'Brad Collins',
  display_name: 'Brad Collins',
  car_number: '67',
  active: true,
};

const bradStandings = {
  driverId: '674',
  driverName: 'Brad Collins',
  carNumber: '67',
  position: 18,
  races: 1,
};

{
  const resolution = resolveProfileForStandingsRow(bradStandings, [bradProfile]);
  assert.equal(resolution.matchMethod, 'slug');
  assert.equal(resolution.identitySplit, true);
  const enriched = enrichStandingsRowWithProfile(bradStandings, resolution);
  const eligibility = resolveFantasyDriverEligibility(enriched, {
    inStandings: true,
    activity: { active: true, consecutiveMissedRaces: 0 },
  });
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.seasonStarts, 1);
  assert.equal(enriched.profileDriverId, '17343');
  assert.equal(enriched.driverId, '674');
}

{
  const inactive = resolveFantasyDriverEligibility(
    {
      driverId: '100',
      position: 10,
      races: 2,
      profileActive: false,
      profileResolved: true,
    },
    {
      inStandings: true,
      activity: { active: false, reason: FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_PROFILE },
    }
  );
  assert.equal(inactive.eligible, false);
  assert.equal(inactive.reason, FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_PROFILE);
}

{
  const zeroStarts = resolveFantasyDriverEligibility(
    { driverId: '101', position: 12, races: 0, profileActive: true, activity: { active: true } },
    { inStandings: true, activity: { active: true } }
  );
  assert.equal(zeroStarts.eligible, false);
  assert.equal(zeroStarts.reason, FANTASY_DRIVER_POOL_EXCLUSIONS.ZERO_STARTS);
}

{
  const filtered = filterEligibleStandingsRows([
    { driverId: '1', position: 5, races: 3 },
    { driverId: '2', position: 31, races: 2 },
    { driverId: '3', position: 8, races: 0 },
    { driverId: '4', position: 61, races: 1 },
  ]);
  assert.deepEqual(filtered.map((row) => row.driverId), ['1', '2', '4']);
}

{
  const comparison = compareDraftToEligiblePool(
    [{ driverId: '10', driverName: 'Existing Driver' }],
    [
      { driverId: '10', driverName: 'Existing Driver', races: 4, eligibility: { eligible: true } },
      { driverId: '674', driverName: 'Brad Collins', races: 1, eligibility: { eligible: true } },
    ]
  );
  assert.equal(comparison.missingEligible.length, 1);
  assert.equal(comparison.missingEligible[0].driverId, '674');
  assert.equal(comparison.driverPoolChanged, true);
}

{
  const staleDraft = compareDraftToEligiblePool(
    [{ driverId: '10', driverName: 'Old Draft Driver' }],
    [{ driverId: '10', driverName: 'Old Draft Driver', races: 4, eligibility: { eligible: true } }]
  );
  assert.equal(staleDraft.driverPoolChanged, false);
}

{
  const publishedSafety = compareDraftToEligiblePool(
    [{ driverId: '10', driverName: 'Published Driver' }],
    [
      { driverId: '10', driverName: 'Published Driver', races: 4, eligibility: { eligible: true } },
      { driverId: '99', driverName: 'New Driver', races: 1, eligibility: { eligible: true } },
    ]
  );
  assert.equal(publishedSafety.missingEligible.length, 1);
  assert.equal(publishedSafety.addedDriverIds[0], '99');
}

{
  const oneStartLowerPosition = resolveFantasyDriverEligibility(
    {
      driverId: '674',
      position: 61,
      races: 1,
      profileActive: true,
      profileResolved: true,
      activity: { active: true, consecutiveMissedRaces: 0 },
    },
    activeContext()
  );
  assert.equal(oneStartLowerPosition.eligible, true);
  assert.equal(oneStartLowerPosition.seasonStarts, 1);
}

{
  const duplicateGuard = compareDraftToEligiblePool(
    [
      { driverId: '10', driverName: 'A' },
      { driverId: '10', driverName: 'A duplicate row' },
    ],
    [{ driverId: '10', driverName: 'A', races: 2, eligibility: { eligible: true } }]
  );
  assert.equal(duplicateGuard.missingEligible.length, 0);
  assert.equal(duplicateGuard.driverPoolChanged, false);
}

{
  const alignedRaces = [
    { finishes: {} },
    { finishes: {} },
    { finishes: {} },
    { finishes: {} },
    { finishes: {} },
  ];
  const fiveMissed = resolveFantasyDriverActivity(
    { driverId: '900', profileActive: true },
    { alignedRaces }
  );
  assert.equal(fiveMissed.active, false);
  assert.equal(fiveMissed.consecutiveMissedRaces, 5);
  assert.equal(fiveMissed.reason, FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_ATTENDANCE);

  const eligibility = resolveFantasyDriverEligibility(
    {
      driverId: '900',
      position: 20,
      races: 10,
      activity: fiveMissed,
    },
    { inStandings: true, activity: fiveMissed }
  );
  assert.equal(eligibility.eligible, false);
}

{
  const alignedRaces = [
    { finishes: { 901: 5 } },
    { finishes: {} },
    { finishes: {} },
    { finishes: {} },
    { finishes: {} },
  ];
  const fourMissed = resolveFantasyDriverActivity(
    { driverId: '901', profileActive: true },
    { alignedRaces }
  );
  assert.equal(fourMissed.consecutiveMissedRaces, 4);
  assert.equal(fourMissed.active, true);

  const eligibility = resolveFantasyDriverEligibility(
    {
      driverId: '901',
      position: 12,
      races: 8,
      activity: fourMissed,
    },
    { inStandings: true, activity: fourMissed }
  );
  assert.equal(eligibility.eligible, true);
}

console.log('test-fantasy-driver-pool: all tests passed');
