import assert from 'node:assert/strict';
import {
  buildDriverProfileLookupMaps,
  buildStandingsDriverIdSet,
  DRIVER_PROFILE_SYNC_VERSION,
  enrichSyncInputsWithStandings,
  mergeApprovedSyncInputs,
  pickCanonicalProfileMatch,
  registerProfileInLookupMaps,
  resolveExistingProfileFromMaps,
  resolveIncomingDriverId,
  shouldHideDuplicateApprovedProfile,
} from '../api/_driver-profile-sync-identity.js';

const standingsProfile = {
  driver_id: '51234',
  iracing_customer_id: '900111',
  iracing_name: 'Brad Collins',
  display_name: 'Brad Collins',
  active: true,
};

const applicationProfile = {
  driver_id: '900111',
  iracing_customer_id: '900111',
  iracing_name: 'Brad Collins',
  display_name: 'Brad Collins',
  source_application_id: 'app-brad',
  form_email: 'brad@example.com',
  active: true,
};

const standingsRows = [{ driverId: '51234', driverName: 'Brad Collins' }];
const standingsDriverIds = buildStandingsDriverIdSet(standingsRows);

{
  const maps = buildDriverProfileLookupMaps([standingsProfile, applicationProfile]);
  const match = resolveExistingProfileFromMaps(
    {
      id: 'app-brad',
      iracing_customer_id: '900111',
      iracing_display_name: 'Brad Collins',
      email: 'brad@example.com',
      srh_driver_id: '51234',
    },
    maps,
    { standingsDriverIds }
  );
  assert.equal(match.profile.driver_id, '51234');
  assert.equal(match.matchedBy, 'incoming_driver_id');
}

{
  const maps = buildDriverProfileLookupMaps([standingsProfile]);
  const enriched = enrichSyncInputsWithStandings(
    [
      {
        id: 'app-brad',
        iracing_customer_id: '900111',
        iracing_display_name: 'Brad Collins',
      },
    ],
    standingsRows,
    maps
  );
  assert.equal(enriched[0].srh_driver_id, '51234');
  assert.equal(enriched[0].in_current_standings, true);
}

{
  const maps = buildDriverProfileLookupMaps([standingsProfile, applicationProfile]);
  const candidates = [
    { profile: applicationProfile, matchedBy: 'driver_id' },
    { profile: standingsProfile, matchedBy: 'srh_driver_id' },
  ];
  const best = pickCanonicalProfileMatch(candidates, standingsDriverIds, '900111');
  assert.equal(best.profile.driver_id, '51234');
}

{
  const maps = buildDriverProfileLookupMaps([standingsProfile, applicationProfile]);
  assert.equal(
    shouldHideDuplicateApprovedProfile(
      applicationProfile,
      standingsDriverIds,
      maps,
      {
        id: 'app-brad',
        iracing_customer_id: '900111',
        iracing_display_name: 'Brad Collins',
      }
    ),
    true
  );
}

{
  const incomingId = resolveIncomingDriverId({
    iracing_customer_id: '900111',
    srh_driver_id: '51234',
  });
  assert.equal(incomingId, '51234');
}

{
  const maps = buildDriverProfileLookupMaps([standingsProfile]);
  const enriched = enrichSyncInputsWithStandings(
    mergeApprovedSyncInputs(
      [
        {
          id: 'app-1',
          iracing_customer_id: '900111',
          iracing_display_name: 'Brad Collins',
          email: 'brad@example.com',
          created_at: '2026-01-01',
        },
      ],
      new Map()
    ),
    standingsRows,
    maps
  );
  const match = resolveExistingProfileFromMaps(enriched[0], maps, { standingsDriverIds });
  assert.equal(match.profile.driver_id, '51234');
  assert.notEqual(match.profile.driver_id, '900111');
}

{
  let maps = buildDriverProfileLookupMaps([standingsProfile]);
  const updated = {
    ...standingsProfile,
    source_application_id: 'app-brad',
    form_email: 'brad@example.com',
  };
  maps = registerProfileInLookupMaps(maps, updated);
  const secondPass = resolveExistingProfileFromMaps(
    {
      id: 'app-brad',
      iracing_customer_id: '900111',
      iracing_display_name: 'Brad Collins',
      srh_driver_id: '51234',
    },
    maps,
    { standingsDriverIds }
  );
  assert.equal(secondPass.profile.driver_id, '51234');
}

assert.equal(DRIVER_PROFILE_SYNC_VERSION, 'driver-profile-sync-v2');

console.log('test-driver-profile-sync-identity: ok');
