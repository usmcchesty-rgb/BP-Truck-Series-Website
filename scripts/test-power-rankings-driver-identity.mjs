import assert from 'node:assert/strict';
import {
  buildPowerRankingsIdentityContext,
  buildPreviousRankByDriver,
  canonicalizePowerRankingsDriverId,
  resolveDriverOptionForStoredId,
  resolvePowerRankingsDriver,
} from '../api/_power-rankings-driver-identity.js';
import { buildDriverLookup } from '../api/_standings-rows.js';

function profileFixture({
  driver_id,
  display_name,
  iracing_name = display_name,
  car_number = '',
  photo_url = '',
}) {
  return {
    driver_id: String(driver_id),
    display_name,
    iracing_name,
    iracing_customer_id: String(driver_id),
    car_number,
    photo_url,
    active: true,
  };
}

function standingsRowFixture({ srhId, name, profileDriverId }) {
  return {
    driverId: String(srhId),
    driverName: name,
    driver: name,
    profileDriverId: profileDriverId ? String(profileDriverId) : String(srhId),
    carNumber: '',
  };
}

{
  // Rick Thompson (#9 prod): stored SRH id 212 → profile 15836
  const profiles = [
    profileFixture({
      driver_id: '15836',
      display_name: 'Rick Thompson',
      car_number: '76',
      photo_url: 'https://example.com/rick.png',
    }),
  ];
  const rows = [
    standingsRowFixture({
      srhId: '212',
      name: 'Rick Thompson',
      profileDriverId: '15836',
    }),
  ];
  const ctx = buildPowerRankingsIdentityContext(profiles, rows);
  const resolved = resolvePowerRankingsDriver('212', ctx);
  assert.equal(resolved.driverName, 'Rick Thompson');
  assert.equal(resolved.profile?.driver_id, '15836');
  assert.equal(resolved.canonicalDriverId, '15836');
  assert.equal(canonicalizePowerRankingsDriverId('212', ctx), '15836');
}

{
  // Justin Levine: matching ids, no photo should not affect name
  const profiles = [
    profileFixture({
      driver_id: '30961',
      display_name: 'Justin Levine',
      car_number: '19',
      photo_url: '',
    }),
  ];
  const rows = [standingsRowFixture({ srhId: '30961', name: 'Justin Levine', profileDriverId: '30961' })];
  const ctx = buildPowerRankingsIdentityContext(profiles, rows);
  const resolved = resolvePowerRankingsDriver('30961', ctx);
  assert.equal(resolved.driverName, 'Justin Levine');
  assert.equal(resolved.profile?.driver_id, '30961');
}

{
  // Honorable mention uses same resolver as top 10
  const profiles = [
    profileFixture({ driver_id: '175138', display_name: 'John Perkins', car_number: '34' }),
  ];
  const rows = [
    standingsRowFixture({ srhId: '30243', name: 'John Perkins', profileDriverId: '175138' }),
  ];
  const ctx = buildPowerRankingsIdentityContext(profiles, rows);
  const hm = resolvePowerRankingsDriver('30243', ctx);
  assert.equal(hm.driverName, 'John Perkins');
  assert.equal(hm.canonicalDriverId, '175138');
}

{
  // Slightly different names across sources — standings name + slug match
  const profiles = [
    profileFixture({
      driver_id: '15836',
      display_name: 'Rick Thompson',
      iracing_name: 'Frederick Thompson',
      car_number: '76',
    }),
  ];
  const rows = [
    standingsRowFixture({ srhId: '212', name: 'Rick Thompson', profileDriverId: '15836' }),
  ];
  const ctx = buildPowerRankingsIdentityContext(profiles, rows);
  const resolved = resolvePowerRankingsDriver('212', ctx);
  assert.equal(resolved.driverName, 'Rick Thompson');
}

{
  // Historical stored SRH id still resolves when row remains in standings
  const profiles = [
    profileFixture({ driver_id: '555001', display_name: 'Historical Driver', car_number: '11' }),
  ];
  const rows = [
    standingsRowFixture({ srhId: '444001', name: 'Historical Driver', profileDriverId: '555001' }),
  ];
  const ctx = buildPowerRankingsIdentityContext(profiles, rows);
  const resolved = resolvePowerRankingsDriver('444001', ctx);
  assert.equal(resolved.driverName, 'Historical Driver');
}

{
  // Missing catalog profile — standings name only (never Unknown Driver)
  const ctx = buildPowerRankingsIdentityContext([], [
    standingsRowFixture({ srhId: '999', name: 'Guest Driver', profileDriverId: '999' }),
  ]);
  const resolved = resolvePowerRankingsDriver('999', ctx);
  assert.equal(resolved.driverName, 'Guest Driver');
  assert.equal(resolved.profile, null);
}

{
  // Repeated resolution is stable
  const profiles = [profileFixture({ driver_id: '15836', display_name: 'Rick Thompson' })];
  const rows = [
    standingsRowFixture({ srhId: '212', name: 'Rick Thompson', profileDriverId: '15836' }),
  ];
  const ctx = buildPowerRankingsIdentityContext(profiles, rows);
  const a = resolvePowerRankingsDriver('212', ctx);
  const b = resolvePowerRankingsDriver('212', ctx);
  assert.deepEqual(a, b);
}

{
  // Movement aliases SRH + profile ids for previous rank
  const lookup = buildDriverLookup(
    [standingsRowFixture({ srhId: '212', name: 'Rick Thompson', profileDriverId: '15836' })],
    [profileFixture({ driver_id: '15836', display_name: 'Rick Thompson' })],
  );
  const map = buildPreviousRankByDriver([{ driverId: '212', rank: 9 }], lookup);
  assert.equal(map['212'], 9);
  assert.equal(map['15836'], 9);
}

{
  // Admin / Discord option resolution
  const options = [
    {
      driver_id: '15836',
      srh_driver_id: '212',
      profileDriverId: '15836',
      display_name: 'Rick Thompson',
    },
  ];
  assert.ok(resolveDriverOptionForStoredId('212', options));
  assert.ok(resolveDriverOptionForStoredId('15836', options));
}

{
  // Direct profile PK still works (Chris Carroll3-shaped id match)
  const profiles = [profileFixture({ driver_id: '39765', display_name: 'Chris Carroll3' })];
  const ctx = buildPowerRankingsIdentityContext(profiles, []);
  const resolved = resolvePowerRankingsDriver('39765', ctx);
  assert.equal(resolved.driverName, 'Chris Carroll3');
}

console.log('test-power-rankings-driver-identity.mjs: all assertions passed');
