import assert from 'node:assert/strict';
import {
  buildDriverProfileLookupMaps,
  mergeApprovedSyncInputs,
  registerProfileInLookupMaps,
  resolveExistingProfileFromMaps,
} from '../api/_driver-profile-sync-identity.js';

const standingsProfile = {
  driver_id: '39765',
  iracing_customer_id: '843974',
  iracing_name: 'Chris Carroll3',
  display_name: 'Chris Carroll3',
  form_email: 'carroll@example.com',
  active: true,
};

const applicationProfile = {
  driver_id: '843974',
  iracing_customer_id: '843974',
  iracing_name: 'Chris Carroll3',
  display_name: 'Chris Carroll3',
  source_application_id: 'app-1',
  form_email: 'carroll@example.com',
  active: true,
};

{
  const maps = buildDriverProfileLookupMaps([standingsProfile]);
  const match = resolveExistingProfileFromMaps(
    {
      id: 'app-2',
      iracing_customer_id: '843974',
      iracing_display_name: 'Chris Carroll3',
      email: 'carroll@example.com',
    },
    maps
  );
  assert.equal(match.profile.driver_id, '39765');
  assert.equal(match.matchedBy, 'iracing_customer_id');
}

{
  const maps = buildDriverProfileLookupMaps([
    {
      driver_id: '39765',
      iracing_name: 'Chris Carroll3',
      display_name: 'Chris Carroll3',
      active: true,
    },
  ]);
  const match = resolveExistingProfileFromMaps(
    {
      id: 'app-1',
      iracing_customer_id: '843974',
      srh_driver_id: '39765',
      iracing_display_name: 'Chris Carroll3',
    },
    maps
  );
  assert.equal(match.profile.driver_id, '39765');
  assert.equal(match.matchedBy, 'srh_driver_id');
}

{
  const maps = buildDriverProfileLookupMaps([
    {
      driver_id: '39765',
      iracing_name: 'Chris Carroll3',
      display_name: 'Chris Carroll3',
      active: true,
    },
  ]);
  const match = resolveExistingProfileFromMaps(
    {
      id: 'app-1',
      iracing_customer_id: '843974',
      iracing_display_name: 'Chris Carroll3',
      email: 'carroll@example.com',
    },
    maps
  );
  assert.equal(match.profile.driver_id, '39765');
  assert.equal(match.matchedBy, 'normalized_name');
}

{
  const maps = buildDriverProfileLookupMaps([
    {
      driver_id: 'app-profile',
      iracing_name: 'Applicant Driver',
      display_name: 'Applicant Driver',
      source_application_id: 'app-1',
      active: true,
    },
  ]);
  const match = resolveExistingProfileFromMaps(
    {
      id: 'app-1',
      iracing_customer_id: '999001',
      iracing_display_name: 'Applicant Driver',
    },
    maps
  );
  assert.equal(match.profile.driver_id, 'app-profile');
  assert.equal(match.matchedBy, 'source_application_id');
}

{
  const merged = mergeApprovedSyncInputs(
    [
      {
        id: 'app-1',
        iracing_customer_id: '843974',
        iracing_display_name: 'Chris Carroll3',
        email: 'carroll@example.com',
        created_at: '2026-01-01',
      },
      {
        id: 'app-2',
        iracing_customer_id: '843974',
        iracing_display_name: 'Chris Carroll3',
        discord_name: 'carroll',
        created_at: '2026-01-02',
      },
    ],
    new Map([['app-2', { matched_driver_id: '39765' }]])
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].discord_name, 'carroll');
  assert.equal(merged[0].srh_driver_id, '39765');
}

{
  let maps = buildDriverProfileLookupMaps([standingsProfile]);
  const created = {
    driver_id: '39765',
    iracing_customer_id: '843974',
    iracing_name: 'Chris Carroll3',
    source_application_id: 'app-9',
  };
  maps = registerProfileInLookupMaps(maps, created);
  const secondPass = resolveExistingProfileFromMaps(
    {
      id: 'app-9',
      iracing_customer_id: '843974',
      iracing_display_name: 'Chris Carroll3',
    },
    maps
  );
  assert.equal(secondPass.profile.driver_id, '39765');
  assert.equal(secondPass.matchedBy, 'iracing_customer_id');
}

console.log('test-driver-profile-sync-identity: ok');
