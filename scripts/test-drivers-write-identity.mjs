import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIncomingDriverSlug,
  mergeDriverProfilePatch,
  resolveExistingProfileFromLoadedProfiles,
  sanitizeIncomingCustomerId,
} from '../api/_drivers-write-identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadAdminDriverRoster() {
  const source = readFileSync(
    join(__dirname, '../public/admin/admin-driver-roster.js'),
    'utf8'
  );
  const runner = new Function(`${source}; return BPAdminDriverRoster;`);
  return runner();
}

const existingBrad = {
  driver_id: '17343',
  slug: 'brad-collins',
  iracing_customer_id: '17343',
  iracing_name: 'Brad Collins',
  display_name: 'Brad Collins',
  form_email: 'bradley_collins1@yahoo.com',
  hometown: 'Charlotte',
  twitch_url: 'https://twitch.tv/brad',
  car_number: '67',
  active: true,
};

const standingsBrad = {
  driverId: '674',
  driver: 'Brad Collins',
};

{
  const incoming = {
    driver_id: '674',
    iracing_customer_id: '674',
    display_name: 'Brad Collins',
    iracing_name: 'Brad Collins',
    car_number: '67',
    active: true,
  };
  const resolution = resolveExistingProfileFromLoadedProfiles(incoming, [existingBrad]);
  assert.equal(resolution.conflict, false);
  assert.equal(resolution.profile.driver_id, '17343');
  assert.equal(resolution.matchMethod, 'slug');

  const patch = mergeDriverProfilePatch(existingBrad, {
    driver_id: '674',
    slug: 'brad-collins',
    iracing_customer_id: '674',
    iracing_name: 'Brad Collins',
    display_name: 'Brad Collins',
    car_number: '67',
    active: true,
    photo_url: '',
    hometown: '',
    twitch_url: '',
  }, incoming);

  assert.equal(patch.driver_id, undefined);
  assert.equal(patch.iracing_customer_id, '17343');
  assert.equal(patch.slug, 'brad-collins');
  assert.equal(patch.hometown, 'Charlotte');
  assert.equal(patch.twitch_url, 'https://twitch.tv/brad');
}

{
  const incoming = {
    driver_id: '212',
    iracing_customer_id: '212',
    display_name: 'Rick Thompson',
    iracing_name: 'Rick Thompson',
  };
  const existingRick = {
    driver_id: '15836',
    slug: 'rick-thompson',
    iracing_customer_id: '15836',
    iracing_name: 'Rick Thompson',
    display_name: 'Rick Thompson',
  };
  const resolution = resolveExistingProfileFromLoadedProfiles(incoming, [existingRick]);
  assert.equal(resolution.profile.driver_id, '15836');
  assert.equal(resolution.matchMethod, 'slug');
}

{
  const incoming = {
    driver_id: '99999',
    iracing_customer_id: '17343',
    display_name: 'Brad Collins',
    iracing_name: 'Brad Collins',
  };
  const resolution = resolveExistingProfileFromLoadedProfiles(incoming, [existingBrad]);
  assert.equal(resolution.profile.driver_id, '17343');
  assert.ok(['slug', 'iracing_customer_id'].includes(resolution.matchMethod));
}

{
  const incoming = {
    driver_id: '99999',
    display_name: 'Brad Collins',
    iracing_name: 'Brad Collins',
  };
  const noSlug = { ...existingBrad, slug: 'different-slug' };
  const resolution = resolveExistingProfileFromLoadedProfiles(incoming, [noSlug]);
  assert.equal(resolution.profile.driver_id, '17343');
  assert.equal(resolution.matchMethod, 'normalized_name');
}

{
  const profiles = [
    { driver_id: '1', slug: 'brad-collins', iracing_name: 'Brad Collins', display_name: 'Brad Collins' },
    { driver_id: '2', slug: 'brad-collins-2', iracing_name: 'Brad Collins', display_name: 'Brad Collins' },
  ];
  const resolution = resolveExistingProfileFromLoadedProfiles(
    {
      driver_id: '674',
      display_name: 'Brad Collins',
      iracing_name: 'Brad Collins',
    },
    profiles
  );
  assert.equal(resolution.conflict, true);
  assert.equal(resolution.matches.length, 2);
}

{
  const sanitized = sanitizeIncomingCustomerId(
    { driver_id: '674', iracing_customer_id: '674' },
    existingBrad
  );
  assert.equal(sanitized, '17343');
}

{
  assert.equal(buildIncomingDriverSlug({ display_name: 'Brad Collins' }), 'brad-collins');
}

{
  const Roster = loadAdminDriverRoster();
  const list = Roster.buildDriverList(
    [standingsBrad],
    [existingBrad]
  );
  assert.equal(list.length, 1);
  assert.equal(list[0].driver_id, '17343');
  assert.equal(list[0].srh_driver_id, '674');
  assert.equal(list[0].iracing_customer_id, '17343');
  assert.equal(list[0].identity_match_method, 'slug');
  assert.equal(list[0].roster_status, 'current');
}

{
  const Roster = loadAdminDriverRoster();
  const examples = [
    { standingsId: '212', profileId: '15836', name: 'Rick Thompson', slug: 'rick-thompson' },
    { standingsId: '674', profileId: '17343', name: 'Brad Collins', slug: 'brad-collins' },
    { standingsId: '753', profileId: '36516', name: 'Fred Thompson', slug: 'fred-thompson' },
    { standingsId: '141123', profileId: '394772', name: 'Gordon Miller', slug: 'gordon-miller' },
    { standingsId: '30243', profileId: '175138', name: 'John Perkins', slug: 'john-perkins' },
  ];

  for (const example of examples) {
    const list = Roster.buildDriverList(
      [{ driverId: example.standingsId, driver: example.name }],
      [
        {
          driver_id: example.profileId,
          slug: example.slug,
          iracing_customer_id: example.profileId,
          iracing_name: example.name,
          display_name: example.name,
          active: true,
        },
      ]
    );
    assert.equal(list.length, 1, `${example.name} should render once`);
    assert.equal(list[0].driver_id, example.profileId, `${example.name} keeps profile id`);
    assert.equal(list[0].srh_driver_id, example.standingsId, `${example.name} exposes SRH id`);
    assert.equal(
      list[0].iracing_customer_id,
      example.profileId,
      `${example.name} keeps customer id`
    );
  }
}

{
  const Roster = loadAdminDriverRoster();
  const first = Roster.buildDriverList([standingsBrad], [existingBrad]);
  const second = Roster.buildDriverList([standingsBrad], [existingBrad]);
  assert.deepEqual(
    first.map((row) => row.driver_id),
    second.map((row) => row.driver_id)
  );
}

console.log('test-drivers-write-identity: ok');
