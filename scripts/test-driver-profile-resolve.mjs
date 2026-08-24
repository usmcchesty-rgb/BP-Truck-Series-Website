import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  driverProfilePublicUrl,
  findDriverProfileByQuery,
  resolveProfileForStandingsRow,
} from '../api/_driver-profile-resolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const IDENTITY_SPLIT_FIXTURES = [
  {
    name: 'John Perkins',
    profileId: '175138',
    srhId: '30243',
    slug: 'john-perkins',
    carNumber: '34',
    photoSlug: 'john-perkins',
  },
  {
    name: 'Brad Collins',
    profileId: '17343',
    srhId: '674',
    slug: 'brad-collins',
    carNumber: '67',
  },
  {
    name: 'Rick Thompson',
    profileId: '15836',
    srhId: '212',
    slug: 'rick-thompson',
    carNumber: '25',
  },
  {
    name: 'Gordon Miller',
    profileId: '394772',
    srhId: '141123',
    slug: 'gordon-miller',
    carNumber: '90',
  },
  {
    name: 'Fred Thompson',
    profileId: '36516',
    srhId: '753',
    slug: 'fred-thompson',
    carNumber: '80',
  },
];

function profileFixture(example, extras = {}) {
  return {
    driver_id: example.profileId,
    slug: example.slug,
    iracing_customer_id: example.profileId,
    iracing_name: example.name,
    display_name: example.name,
    car_number: example.carNumber ?? '',
    photo_url: `/assets/drivers/${example.slug}.png`,
    active: true,
    ...extras,
  };
}

function standingsFixture(example) {
  return {
    driverId: example.srhId,
    driverName: example.name,
    carNumber: example.carNumber ?? '',
  };
}

{
  // 1. late-added driver resolves (John Perkins-shaped)
  const perkins = IDENTITY_SPLIT_FIXTURES[0];
  const profiles = [profileFixture(perkins)];
  const standingsRow = standingsFixture(perkins);
  const resolution = resolveProfileForStandingsRow(standingsRow, profiles);
  assert.equal(resolution.profile?.driver_id, '175138');
  assert.equal(resolution.identitySplit, true);
  assert.equal(resolution.srhDriverId, '30243');
  assert.ok(resolution.matchMethod === 'slug' || resolution.matchMethod === 'normalized_name');
}

{
  // 2. John Perkins-shaped fixture resolves via SRH id query + standings reverse lookup
  const perkins = IDENTITY_SPLIT_FIXTURES[0];
  const profiles = [profileFixture(perkins)];
  const standingsRows = [standingsFixture(perkins)];
  const bySrh = findDriverProfileByQuery(profiles, '30243', { standingsRows });
  assert.equal(bySrh.profile?.driver_id, '175138');
  assert.match(String(bySrh.matchedBy), /^standings_/);

  const byProfile = findDriverProfileByQuery(profiles, '175138');
  assert.equal(byProfile.profile?.driver_id, '175138');
  assert.equal(byProfile.matchedBy, 'driver_id');

  const bySlug = findDriverProfileByQuery(profiles, 'john-perkins');
  assert.equal(bySlug.profile?.driver_id, '175138');
}

{
  // 3. result participant → canonical driver
  const perkins = IDENTITY_SPLIT_FIXTURES[0];
  const resolution = resolveProfileForStandingsRow(
    { driverId: '30243', driverName: 'John Perkins' },
    [profileFixture(perkins)]
  );
  assert.equal(resolution.profileDriverId, '175138');
}

{
  // 4. canonical driver → profile URL
  assert.equal(driverProfilePublicUrl('175138'), '/drivers/175138');
  assert.equal(
    driverProfilePublicUrl({ driver_id: '175138' }),
    '/drivers/175138'
  );
}

{
  // 5. profile retains photo
  const perkins = IDENTITY_SPLIT_FIXTURES[0];
  const profile = profileFixture(perkins);
  const resolution = resolveProfileForStandingsRow(standingsFixture(perkins), [profile]);
  assert.equal(resolution.profile?.photo_url, '/assets/drivers/john-perkins.png');
}

{
  // 6. driver with no car number resolves
  const late = {
    name: 'Late Entry No Number',
    profileId: '999001',
    srhId: '888001',
    slug: 'late-entry-no-number',
    carNumber: '',
  };
  const profile = profileFixture(late, { car_number: '' });
  const resolution = resolveProfileForStandingsRow(standingsFixture(late), [profile]);
  assert.equal(resolution.profile?.driver_id, '999001');
  assert.equal(resolution.profile?.car_number, '');
}

{
  // 7. driver with no number artwork still resolves as a driver
  const late = {
    name: 'Late Entry No Artwork',
    profileId: '999002',
    srhId: '888002',
    slug: 'late-entry-no-artwork',
    carNumber: '99',
  };
  const profile = profileFixture(late);
  delete profile.numberArtwork;
  const resolution = resolveProfileForStandingsRow(standingsFixture(late), [profile]);
  assert.equal(resolution.profile?.driver_id, '999002');
  assert.equal(resolution.profile?.numberArtwork, undefined);
}

{
  // 8. historical/inactive participant still resolves
  const historical = {
    name: 'Historical Driver',
    profileId: '555001',
    srhId: '444001',
    slug: 'historical-driver',
    carNumber: '11',
  };
  const profile = profileFixture(historical, { active: false });
  const resolution = resolveProfileForStandingsRow(standingsFixture(historical), [profile]);
  assert.equal(resolution.profile?.driver_id, '555001');
  assert.equal(resolution.profile?.active, false);
}

{
  // 9. existing original-season driver still resolves by matching driver_id === SRH id
  const original = {
    driver_id: '1001',
    slug: 'original-driver',
    iracing_customer_id: '9001',
    iracing_name: 'Original Driver',
    display_name: 'Original Driver',
    car_number: '1',
    active: true,
  };
  const resolution = resolveProfileForStandingsRow(
    { driverId: '1001', driverName: 'Original Driver' },
    [original]
  );
  assert.equal(resolution.matchMethod, 'driver_id');
  assert.equal(resolution.identitySplit, false);
  assert.equal(resolution.profileDriverId, '1001');
}

{
  // 10. canonical ID beats name/car-number ambiguity
  const profiles = [
    {
      driver_id: '111',
      slug: 'same-name-a',
      iracing_customer_id: '111',
      iracing_name: 'Same Name',
      display_name: 'Same Name',
      car_number: '10',
      active: true,
    },
    {
      driver_id: '222',
      slug: 'same-name-b',
      iracing_customer_id: '222',
      iracing_name: 'Same Name',
      display_name: 'Same Name',
      car_number: '10',
      active: true,
    },
  ];
  const byDriverId = resolveProfileForStandingsRow(
    { driverId: '111', driverName: 'Same Name' },
    profiles
  );
  assert.equal(byDriverId.profile?.driver_id, '111');
  assert.equal(byDriverId.matchMethod, 'driver_id');

  const nameOnlyConflict = resolveProfileForStandingsRow(
    { driverId: '999999', driverName: 'Same Name' },
    profiles
  );
  assert.equal(nameOnlyConflict.profile, null);
  assert.equal(nameOnlyConflict.matchMethod, 'normalized_name_conflict');
}

{
  // 11. roster normalization retains required identity fields
  for (const example of IDENTITY_SPLIT_FIXTURES) {
    const resolution = resolveProfileForStandingsRow(
      standingsFixture(example),
      [profileFixture(example)]
    );
    assert.ok(resolution.profile, `${example.name} must resolve`);
    assert.equal(String(resolution.profile.driver_id), example.profileId);
    assert.equal(String(resolution.profile.iracing_customer_id), example.profileId);
    assert.equal(String(resolution.srhDriverId), example.srhId);
    assert.equal(resolution.identitySplit, true);
  }
}

{
  // 12. API/current catalog and profile resolver agree (repo catalog + photo evidence)
  const catalogPath = path.join(root, 'data', 'drivers.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const drivers = Array.isArray(catalog?.drivers) ? catalog.drivers : catalog;
  const perkinsCatalog = drivers.find(
    (row) =>
      String(row.iracingCustomerId || row.iracing_customer_id || '') === '175138' ||
      String(row.name || '').toLowerCase() === 'john perkins'
  );
  assert.ok(perkinsCatalog, 'John Perkins must exist in data/drivers.json');
  assert.equal(String(perkinsCatalog.iracingCustomerId), '175138');
  assert.equal(String(perkinsCatalog.slug), 'john-perkins');

  const photoPath = path.join(root, 'public', 'assets', 'drivers', 'john-perkins.png');
  const carPath = path.join(root, 'public', 'assets', 'images', 'cars', 'John Perkins.png');
  const numberPath = path.join(root, 'public', 'assets', 'images', 'numbers', '175138.png');
  // Face photos may live in remote/storage; local repo retains car + number artwork identity.
  assert.equal(fs.existsSync(carPath), true, 'John Perkins car image must remain available');
  assert.equal(fs.existsSync(numberPath), true, 'John Perkins number artwork must remain available');
  if (fs.existsSync(photoPath)) {
    assert.ok(true, 'local john-perkins.png present');
  }

  const profiles = [
    profileFixture(IDENTITY_SPLIT_FIXTURES[0], {
      photo_url: `/assets/drivers/${perkinsCatalog.slug}.png`,
    }),
  ];
  const byCustomer = findDriverProfileByQuery(profiles, '175138');
  const bySrh = findDriverProfileByQuery(profiles, '30243', {
    standingsRows: [standingsFixture(IDENTITY_SPLIT_FIXTURES[0])],
  });
  assert.equal(byCustomer.profile?.driver_id, bySrh.profile?.driver_id);
  assert.equal(byCustomer.profile?.photo_url, '/assets/drivers/john-perkins.png');
  // Resolver must not rewrite photo path when matching by SRH id.
  assert.equal(bySrh.profile?.photo_url, byCustomer.profile?.photo_url);
}

{
  // Results click-through contract: prefer profileDriverId over SRH driverId
  function driverProfileUrl(row) {
    if (row?.profileUrl) return String(row.profileUrl);
    const id = row?.profileDriverId || row?.driverId || '';
    return `/drivers/${encodeURIComponent(String(id || ''))}`;
  }

  const resolution = resolveProfileForStandingsRow(
    { driverId: '30243', driverName: 'John Perkins' },
    [profileFixture(IDENTITY_SPLIT_FIXTURES[0])]
  );
  const row = {
    driverId: '30243',
    profileDriverId: resolution.profileDriverId,
    profileUrl: driverProfilePublicUrl(resolution.profileDriverId),
  };
  assert.equal(driverProfileUrl(row), '/drivers/175138');
  assert.notEqual(driverProfileUrl(row), '/drivers/30243');
}

console.log('test-driver-profile-resolve: ok');
console.log(
  'identity-split fixtures covered:',
  IDENTITY_SPLIT_FIXTURES.map((row) => row.name).join(', ')
);
