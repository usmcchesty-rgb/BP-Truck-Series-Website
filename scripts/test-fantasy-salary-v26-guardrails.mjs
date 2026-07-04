/**
 * Regression checks for Fantasy Salary v2.6 guardrails.
 * Run: node scripts/test-fantasy-salary-v26-guardrails.mjs
 */
import { fetchHtml, getDriverProfiles, getSettings } from '../api/_lib.js';
import { parseScheduleRacesFromHtml } from '../api/_caution-stats.js';
import { buildRaceNumberDebug, enrichScheduleRaces } from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import { buildDriverLookup, fetchStandingsRows } from '../api/power-rankings-generate.js';
import {
  alignAllCompletedPointsRaces,
  buildDriverCareerRaceResultsByDriver,
  buildDriverRaceResultsByDriver,
} from '../api/_fantasy-track-history.js';
import { buildFantasyDriverSalaries } from '../api/_fantasy-salary-scoring.js';
import { enrichFantasySlateDrivers } from '../api/_fantasy-admin-analytics.js';
import {
  applyNewDriverProtection,
  applyV26SalaryGuardrails,
  getNewDriverMovementCap,
} from '../api/_fantasy-salary-guardrails.js';

const BRAD_LAWSON_ID = '18522';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${message}`);
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

console.log('Fantasy Salary v2.6 guardrail regression\n');

console.log('Unit: New Driver Protection caps');
{
  const oneStartUp = applyNewDriverProtection(6700, 5800, 1);
  assertEqual(oneStartUp.salary, 6100, '1-start driver +$900 capped to +$300');
  assertEqual(oneStartUp.applied, true, '1-start upward cap applied');

  const oneStartDown = applyNewDriverProtection(4900, 5800, 1);
  assertEqual(oneStartDown.salary, 5500, '1-start driver -$900 capped to -$300');
  assertEqual(oneStartDown.applied, true, '1-start downward cap applied');

  const twoStartUp = applyNewDriverProtection(6600, 5800, 2);
  assertEqual(twoStartUp.salary, 6300, '2-start driver +$800 capped to +$500');
  assertEqual(twoStartUp.applied, true, '2-start upward cap applied');

  const twoStartDown = applyNewDriverProtection(5200, 5800, 2);
  assertEqual(twoStartDown.salary, 5300, '2-start driver -$600 capped to -$500');
  assertEqual(twoStartDown.applied, true, '2-start downward cap applied');

  const threeStart = applyNewDriverProtection(7000, 5800, 3);
  assertEqual(threeStart.salary, 7000, '3-start driver unaffected by New Driver Protection');
  assertEqual(threeStart.applied, false, '3-start protection not applied');
  assertEqual(getNewDriverMovementCap(3), null, '3+ starts have no movement cap');

  const withinCap = applyNewDriverProtection(5900, 5800, 1);
  assertEqual(withinCap.salary, 5900, '1-start driver within ±$300 unchanged');
  assertEqual(withinCap.applied, false, 'within-cap movement not flagged');
}

console.log('\nUnit: stricter existing guardrail preserved');
{
  const driver = {
    driverId: 'test-1',
    priorSalary: 5800,
    previousSalary: 5800,
    generatedSalary: 6000,
    computedTierKey: 'value',
    salaryBand: { min: 4500, max: 7000 },
    attendanceContext: { seasonStarts: 1, validLast5Starts: 0 },
    salaryGuardrailContext: {
      recentStarts: 0,
      consecutiveDnpCount: 3,
      consecutiveDnpPenalty: 20,
      inactive: true,
      lastRaceDnp: true,
      last2AllDnp: true,
      last3AllDnp: true,
      seasonStarts: 1,
    },
    scoreBreakdown: {},
  };

  const result = applyV26SalaryGuardrails(driver, []);
  assertEqual(result, 5500, '3-DNP -$300 floor kept when stricter than new-driver cap');
  assert(
    driver.salaryGuardrails?.guardrailNotes?.some((note) => note.includes('Last 3 races DNP')),
    'DNP guardrail note still present',
  );
}

console.log('\nIntegration: Brad Lawson unaffected by New Driver Protection');
try {
  const raceNumber = 15;
  const settings = await getSettings();
  const now = new Date();
  const scheduleHtml = await fetchHtml(settings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
  const raceDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { now, settings });
  const standingsResult = await fetchStandingsRows(settings, raceDebug.standingsScheduleId);
  const standings = standingsResult.rows.filter(
    (row) =>
      Number(row.races) > 0 &&
      Number(row.position) >= 1 &&
      Number(row.position) <= 30,
  );
  const profiles = await getDriverProfiles();
  const driverLookup = buildDriverLookup(standings, profiles);
  const alignedRaces = getAlignedRaceFinishes(
    scheduleRaces,
    raceNumber,
    standingsResult.schedules,
    driverLookup,
  );
  const factualGrounding = buildFactualGroundingContext({
    standings,
    scheduleRaces,
    raceNumber,
    schedules: standingsResult.schedules,
    driverLookup,
    recentResults: [],
    manualRaceNotes: '',
    transcriptSummary: '',
    seasonCatalog: null,
  });
  const allAligned = alignAllCompletedPointsRaces(
    scheduleRaces,
    standingsResult.schedules,
    driverLookup,
    { now, settings },
  );
  const driverIds = standings.map((row) => String(row.driverId));
  const driverRaceResultsByDriver = buildDriverRaceResultsByDriver(
    allAligned,
    standingsResult.schedules,
    driverIds,
  );
  const leagueId = String(standingsResult.lss?.league_id || settings.leagueId || '1783');
  const driverCareerRaceRowsByDriver = await buildDriverCareerRaceResultsByDriver(
    driverIds,
    leagueId,
  );
  const priorMap = new Map([[BRAD_LAWSON_ID, 5800]]);
  const priorTier = new Map([[BRAD_LAWSON_ID, 13.3475]]);

  const drivers = buildFantasyDriverSalaries({
    standings,
    groundingByDriver: factualGrounding.drivers,
    alignedRaces,
    schedules: standingsResult.schedules,
    upcomingTrack: 'Pocono Raceway',
    driverRaceResultsByDriver,
    driverCareerRaceRowsByDriver,
    priorSalariesByDriver: priorMap,
    priorTierScoresByDriver: priorTier,
    slateRaceNumber: raceNumber,
    scheduleRaces,
    allAlignedRaces: allAligned,
    settings,
    now,
  });
  const enriched = enrichFantasySlateDrivers(drivers, priorMap);
  const brad = enriched.find((driver) => String(driver.driverId) === BRAD_LAWSON_ID);

  assert(brad != null, 'Brad Lawson found in Race 15 slate generation');
  if (brad) {
    assert((brad.seasonStarts ?? brad.attendanceContext?.seasonStarts ?? 0) >= 3, 'Brad Lawson has 3+ season starts');
    assertEqual(
      brad.newDriverProtectionApplied ?? brad.salaryGuardrails?.newDriverProtectionApplied,
      false,
      'Brad Lawson New Driver Protection not applied',
    );
    assertEqual(brad.newDriverMovementCap ?? brad.salaryGuardrails?.newDriverMovementCap, null, 'Brad Lawson has no movement cap');
    console.log(
      `    Brad Lawson: seasonStarts=${brad.seasonStarts ?? brad.attendanceContext?.seasonStarts}, salary=${brad.generatedSalary}, change=${brad.salaryChange}`,
    );
  }

  const oneStartDrivers = enriched.filter(
    (driver) => (driver.seasonStarts ?? driver.attendanceContext?.seasonStarts) === 1,
  );
  if (oneStartDrivers.length) {
    const sample = oneStartDrivers[0];
    const cap = sample.newDriverMovementCap ?? sample.salaryGuardrails?.newDriverMovementCap;
    const prior = sample.previousSalary;
    const change = sample.salaryChange;
    if (prior != null && change != null) {
      assert(Math.abs(change) <= 300, `1-start sample ${sample.driverName} movement within ±$300`);
    }
    console.log(`    1-start sample: ${sample.driverName}, cap=${cap}, change=${change}`);
  } else {
    console.log('    (No 1-start drivers in current standings window)');
  }
} catch (error) {
  failed += 1;
  console.error(`  ✗ Integration test failed: ${error.message}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
