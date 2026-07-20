import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildDriverStatsIdentityDiagnostics,
  buildStandingsIdentityLookupMaps,
  resolveDriverStatsIdentity,
} from './helpers/driver-stats-identity.js';
import { buildDriverSeasonStats } from './helpers/driver-profile-stats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadClientStatsIdentity() {
  const source = readFileSync(join(__dirname, '../public/driver-stats-identity.js'), 'utf8');
  const runner = new Function('window', `${source}; return window.BPDriverStatsIdentity;`);
  return runner({});
}

const EXAMPLE_DRIVERS = [
  {
    profileId: '17343',
    srhId: '674',
    name: 'Brad Collins',
    slug: 'brad-collins',
    finish: 12,
    position: 18,
  },
  {
    profileId: '15836',
    srhId: '212',
    name: 'Rick Thompson',
    slug: 'rick-thompson',
    finish: 8,
    position: 14,
  },
  {
    profileId: '36516',
    srhId: '753',
    name: 'Fred Thompson',
    slug: 'fred-thompson',
    finish: 20,
    position: 22,
  },
  {
    profileId: '394772',
    srhId: '141123',
    name: 'Gordon Miller',
    slug: 'gordon-miller',
    finish: 15,
    position: 19,
  },
  {
    profileId: '175138',
    srhId: '30243',
    name: 'John Perkins',
    slug: 'john-perkins',
    finish: 10,
    position: 16,
  },
];

function profileFor(example) {
  return {
    driver_id: example.profileId,
    slug: example.slug,
    iracing_customer_id: example.profileId,
    iracing_name: example.name,
    display_name: example.name,
    active: true,
  };
}

function standingsRowFor(example) {
  return {
    driverId: example.srhId,
    driverName: example.name,
    position: example.position,
    points: 100 - example.position,
    races: 1,
    wins: 0,
    top5: 0,
    top10: example.finish <= 10 ? 1 : 0,
    avgFinish: example.finish,
    lapsLed: 0,
    incidents: 2,
  };
}

function mockSchedules(example) {
  return {
    1: {
      schedule_id: '9001',
      race_date: 1,
      drivers: {
        race: {
          [example.srhId]: {
            finish_pos: example.finish,
            qualify_pos: 18,
            laps_led: 0,
            incidents: 2,
            session: 'RACE',
            count_stats: 'Y',
          },
        },
      },
    },
  };
}

function mockScheduleRaces() {
  return [
    {
      scheduleRow: 1,
      track: 'Daytona',
      date: '2026-01-01',
      points: 'Yes',
      status: 'Complete',
      winner: 'Winner Driver',
      scheduleId: '9001',
      link: 'https://www.simracerhub.com/scoring/schedule.php?schedule_id=9001',
    },
  ];
}

{
  const example = EXAMPLE_DRIVERS[0];
  const profile = profileFor(example);
  const rows = [standingsRowFor(example)];
  const identity = resolveDriverStatsIdentity(profile, { standingsRows: rows });

  assert.equal(identity.resolved, true);
  assert.equal(identity.srhDriverId, '674');
  assert.equal(identity.profileDriverId, '17343');
  assert.equal(identity.matchedBy, 'slug');
  assert.equal(identity.identitySplit, true);
}

for (const example of EXAMPLE_DRIVERS) {
  const profile = profileFor(example);
  const rows = [standingsRowFor(example)];
  const identity = resolveDriverStatsIdentity(profile, { standingsRows: rows });
  assert.equal(identity.resolved, true, `${example.name} should resolve`);
  assert.equal(identity.srhDriverId, example.srhId, `${example.name} SRH id`);
}

{
  const example = EXAMPLE_DRIVERS[0];
  const profile = profileFor(example);
  const rows = [standingsRowFor(example)];
  const schedules = mockSchedules(example);
  const scheduleRaces = mockScheduleRaces();
  const { stats, identity } = buildDriverSeasonStats(profile, {
    standingsRows: rows,
    schedules,
    scheduleRaces,
  });

  assert.equal(identity.srhDriverId, '674');
  assert.equal(stats.races, 1);
  assert.equal(stats.avgFinish, example.finish);
  assert.equal(stats.bestFinish, example.finish);
  assert.equal(stats.recentRaces.length, 1);
  assert.equal(stats.recentRaces[0].finish, example.finish);
  assert.equal(stats.recentRaces[0].raceNumber, 1);
}

{
  const profile = {
    driver_id: '99999',
    slug: 'other-slug',
    iracing_customer_id: '99999',
    display_name: 'Unique Driver',
    iracing_name: 'Unique Driver',
  };
  const rows = [
    { driverId: '1', driverName: 'Unique Driver', races: 1, position: 5 },
    { driverId: '2', driverName: 'Unique Driver', races: 1, position: 6 },
  ];
  const identity = resolveDriverStatsIdentity(profile, { standingsRows: rows });
  assert.equal(identity.resolved, false);
  assert.equal(identity.matchedBy, 'normalized_name_conflict');
}

{
  const profile = profileFor(EXAMPLE_DRIVERS[0]);
  profile.srh_driver_id = '674';
  const rows = [standingsRowFor(EXAMPLE_DRIVERS[0])];
  const identity = resolveDriverStatsIdentity(profile, { standingsRows: rows });
  assert.equal(identity.matchedBy, 'explicit_srh_driver_id');
}

{
  const example = EXAMPLE_DRIVERS[0];
  const profile = profileFor(example);
  const rows = [standingsRowFor(example)];
  const schedules = mockSchedules(example);
  const diagnostics = buildDriverStatsIdentityDiagnostics(profile, {
    standingsRows: rows,
    schedules,
    recentRaces: [{ finish: example.finish }],
  });

  assert.equal(diagnostics.resolvedSrhDriverId, '674');
  assert.equal(diagnostics.standingsRowFound, true);
  assert.equal(diagnostics.officialResultsFound, true);
  assert.equal(diagnostics.seasonResultCount, 1);
  assert.equal(diagnostics.recentResultCount, 1);
  assert.equal(diagnostics.statsSource, 'simracerhub_standings');
  assert.equal(diagnostics.exclusionReason, null);
}

{
  const profile = profileFor(EXAMPLE_DRIVERS[0]);
  const diagnostics = buildDriverStatsIdentityDiagnostics(profile, {
    standingsRows: [],
    schedules: {},
    recentRaces: [],
  });
  assert.equal(diagnostics.standingsRowFound, false);
  assert.equal(
    diagnostics.exclusionReason,
    'Driver profile could not be linked to SimRacerHub identity.'
  );
}

{
  const rows = EXAMPLE_DRIVERS.map(standingsRowFor);
  const maps = buildStandingsIdentityLookupMaps(rows);
  assert.equal(maps.bySrhDriverId.size, EXAMPLE_DRIVERS.length);

  for (const example of EXAMPLE_DRIVERS) {
    const identity = resolveDriverStatsIdentity(profileFor(example), {
      standingsRows: rows,
      standingsMaps: maps,
    });
    assert.equal(identity.srhDriverId, example.srhId);
  }
}

{
  const ClientIdentity = loadClientStatsIdentity();
  const example = EXAMPLE_DRIVERS[0];
  const profile = profileFor(example);
  const rows = [standingsRowFor(example)];
  const serverIdentity = resolveDriverStatsIdentity(profile, { standingsRows: rows });
  const clientIdentity = ClientIdentity.resolveDriverStatsIdentity(profile, {
    standingsRows: rows,
  });
  assert.deepEqual(clientIdentity, serverIdentity);
}

{
  const example = EXAMPLE_DRIVERS[1];
  const profile = {
    ...profileFor(example),
    active: false,
  };
  const rows = [standingsRowFor(example)];
  const schedules = mockSchedules(example);
  const { stats } = buildDriverSeasonStats(profile, {
    standingsRows: rows,
    schedules,
    scheduleRaces: mockScheduleRaces(),
  });
  assert.equal(stats.races, 1);
  assert.equal(stats.recentRaces.length, 1);
}

console.log('test-driver-stats-identity: all tests passed');
