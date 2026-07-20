/**
 * Fantasy Salary v3.0 Phase 1 regression tests.
 * Run: node scripts/test-fantasy-salary-v30-phase1.mjs
 */
import assert from 'node:assert/strict';
import { buildRaceImpactComponent } from '../api/_power-rankings-scoring.js';
import {
  FANTASY_ABSOLUTE_COMPONENT_KEYS,
  FANTASY_MODEL_VERSION,
  FANTASY_TIERS,
  buildFantasyMomentumRaw,
  buildFantasyMomentumRawV26,
  normalizeFantasySlateComponents,
  normalizeFieldComponentScores,
} from '../api/_fantasy-tier-scoring.js';
import {
  applyNewDriverProtection,
  applyV26SalaryGuardrails,
  mapScoreToSalaryInBandWithTierCap,
} from '../api/_fantasy-salary-guardrails.js';
import { detectSalaryBandViolations } from '../api/_fantasy-tier-scoring.js';

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

console.log('Fantasy Salary v3.0 Phase 1 regression\n');

console.log('Model version');
ok(FANTASY_MODEL_VERSION === 'fantasy-salary-v3.0', 'FANTASY_MODEL_VERSION is fantasy-salary-v3.0');

console.log('\nMomentum v3.0');
{
  const aligned = [
    { pointsRaceNumber: 14, finishes: { d1: 6 } },
    { pointsRaceNumber: 15, finishes: { d1: 8 } },
    { pointsRaceNumber: 16, finishes: { d1: 23 } },
  ];
  const hotPrior = buildFantasyMomentumRaw({
    priorTierScore: 92,
    alignedRaces: aligned,
    schedules: [],
    driverId: 'd1',
  });
  ok(hotPrior.score < 80, 'P23 after hot prior reduces momentum below 80');
  ok(hotPrior.details.scoringMode === 'absolute', 'Momentum marked absolute');
  ok(hotPrior.details.mappedMomentumRank == null, 'v3 momentum does not use mapped rank');

  const coldPrior = buildFantasyMomentumRaw({
    priorTierScore: 48,
    alignedRaces: aligned,
    schedules: [],
    driverId: 'd1',
  });
  ok(coldPrior.score < hotPrior.score, 'Lower prior trajectory yields lower momentum after same races');

  const v26 = buildFantasyMomentumRawV26(92);
  ok(v26.score >= 95, 'v2.6 momentum still peaks on high prior tier score');
}

console.log('\nAbsolute Race Impact ordering');
{
  const finishes = [1, 5, 10, 16, 23, 30];
  const scores = finishes.map((finish) =>
    buildRaceImpactComponent({ pointsRaceNumber: 1, finishes: { d1: finish } }, [], 'd1').score
  );
  for (let i = 1; i < scores.length; i += 1) {
    ok(scores[i - 1] > scores[i], `P${finishes[i - 1]} raw race impact beats P${finishes[i]}`);
  }
}

console.log('\nNormalization pipeline');
{
  const drivers = [
    {
      scoreBreakdown: {
        seasonPerformance: { rawScore: 80 },
        recentForm: { rawScore: 70 },
        careerTrackHistory: { rawScore: 60 },
        raceImpact: { rawScore: 14.7 },
        momentum: { rawScore: 59.7 },
        reliability: { rawScore: 85 },
      },
    },
    {
      scoreBreakdown: {
        seasonPerformance: { rawScore: 60 },
        recentForm: { rawScore: 55 },
        careerTrackHistory: { rawScore: 50 },
        raceImpact: { rawScore: 27.5 },
        momentum: { rawScore: 26.3 },
        reliability: { rawScore: 90 },
      },
    },
  ];

  normalizeFantasySlateComponents(drivers, { tierScoreProfile: 'v3.0' });
  ok(drivers[0].scoreBreakdown.raceImpact.normalizedScore === 14.7, 'Race impact stays absolute raw value');
  ok(drivers[0].scoreBreakdown.momentum.normalizedScore === 59.7, 'Momentum stays absolute raw value');
  ok(
    drivers[0].scoreBreakdown.seasonPerformance.normalizedScore !== 80,
    'Season performance still field-normalized'
  );

  const normalizedSeason = normalizeFieldComponentScores([80, 60]);
  ok(normalizedSeason[0] === 100, 'Field normalization still works for relative components');
  ok(FANTASY_ABSOLUTE_COMPONENT_KEYS.includes('raceImpact'), 'Race impact listed as absolute component');
}

console.log('\nWeekly cap transparency');
{
  const tier = FANTASY_TIERS.find((row) => row.key === 'top_tier');
  const driver = {
    driverId: 'cap-test',
    priorSalary: 13500,
    previousSalary: 13500,
    generatedSalary: 14600,
    computedTierKey: 'top_tier',
    salaryBand: { min: tier.salaryMin, max: tier.salaryMax },
    recentStarts: 5,
    attendanceContext: { seasonStarts: 10, validLast5Starts: 5, validLast5WindowSize: 5 },
  };
  const finalSalary = applyV26SalaryGuardrails(driver, [
    { finishes: { 'cap-test': 10 } },
  ]);
  ok(finalSalary === 14300, 'Top tier increase capped at +$800');
  ok(driver.weeklyCapApplied === true, 'weeklyCapApplied flagged');
  ok(driver.modelSuggestedChange > 800, 'Model suggested change exceeds cap');
  ok(driver.appliedSalaryChange === 800, 'Applied change reflects cap');
}

console.log('\nGuardrail preservation');
{
  ok(applyNewDriverProtection(6700, 5800, 1).salary === 6100, 'New driver protection unchanged');
  const dnpDriver = {
    driverId: 'dnp',
    priorSalary: 5800,
    previousSalary: 5800,
    generatedSalary: 6000,
    computedTierKey: 'value',
    salaryBand: { min: 4500, max: 7000 },
    recentStarts: 5,
    attendanceContext: { seasonStarts: 10 },
    salaryGuardrailContext: {
      recentStarts: 5,
      seasonStarts: 10,
      inactive: false,
      lastRaceDnp: true,
      last2AllDnp: false,
      last3AllDnp: false,
      activityMultiplier: 1,
      consecutiveDnpCount: 1,
      consecutiveDnpPenalty: 5,
    },
  };
  ok(applyV26SalaryGuardrails(dnpDriver, []) === 5800, 'Last race DNP still blocks increases');
}

console.log('\nSalary band violations');
{
  const tier = FANTASY_TIERS.find((row) => row.key === 'elite');
  const drivers = [
    {
      driverId: '1',
      computedTierKey: 'elite',
      salaryBand: { min: tier.salaryMin, max: tier.salaryMax },
      finalSalary: tier.salaryMax,
    },
    {
      driverId: '2',
      computedTierKey: 'elite',
      salaryBand: { min: tier.salaryMin, max: tier.salaryMax },
      finalSalary: tier.salaryMin,
    },
  ];
  ok(detectSalaryBandViolations(drivers).length === 0, 'No salary band violations in band bounds');
  ok(
    mapScoreToSalaryInBandWithTierCap(tier, [90, 80], 90, 5).salary >= tier.salaryMin,
    'Band mapping still respects tier minimum'
  );
}

console.log(`\nPassed ${passed} checks.`);

console.log('\nOffline Carroll vs Arthur comparison (v2.6 profile vs v3.0 profile, same weights)');
{
  const { buildFantasyDriverSalaries } = await import('../api/_fantasy-salary-scoring.js');

  function buildMiniSlate(profile, priorMaps, latestCarroll, latestArthur) {
    const alignedRaces = [14, 15, 16].map((raceNumber, index) => ({
      pointsRaceNumber: raceNumber,
      finishes: {
        carroll: index === 2 ? latestCarroll : [8, 10][index],
        arthur: index === 2 ? latestArthur : [18, 20][index],
      },
    }));
    const standings = [
      { driverId: 'carroll', driverName: 'Chris Carroll3', carNumber: '99', position: 3, wins: 2, top5: 8, top10: 12, races: 16 },
      { driverId: 'arthur', driverName: 'Mark Arthur', carNumber: '12', position: 12, wins: 0, top5: 3, top10: 7, races: 16 },
    ];
    const groundingByDriver = {
      carroll: { recentRaceFinishes: [{ finish: 8 }, { finish: 10 }, { finish: latestCarroll }] },
      arthur: { recentRaceFinishes: [{ finish: 18 }, { finish: 20 }, { finish: latestArthur }] },
    };
    const drivers = buildFantasyDriverSalaries({
      standings,
      groundingByDriver,
      alignedRaces,
      schedules: [],
      upcomingTrack: 'Homestead',
      driverRaceResultsByDriver: new Map(),
      driverCareerRaceRowsByDriver: new Map(),
      priorSalariesByDriver: priorMaps.salaries,
      priorTierScoresByDriver: priorMaps.tiers,
      slateRaceNumber: 17,
      scheduleRaces: [],
      allAlignedRaces: alignedRaces,
      tierScoreProfile: profile,
    });
    return drivers;
  }

  const priors = {
    salaries: new Map([
      ['carroll', 13500],
      ['arthur', 12700],
    ]),
    tiers: new Map([
      ['carroll', 92],
      ['arthur', 64],
    ]),
  };

  const v26Drivers = buildMiniSlate('fantasy-salary-v2.6', priors, 23, 16);
  const v30Drivers = buildMiniSlate('fantasy-salary-v3.0', priors, 23, 16);
  const carrollV26 = v26Drivers.find((row) => row.driverId === 'carroll');
  const carrollV30 = v30Drivers.find((row) => row.driverId === 'carroll');
  const arthurV26 = v26Drivers.find((row) => row.driverId === 'arthur');
  const arthurV30 = v30Drivers.find((row) => row.driverId === 'arthur');

  console.log(
    JSON.stringify(
      {
        carroll: {
          v26: {
            momentum: carrollV26.scoreBreakdown?.momentum?.score,
            raceImpact: carrollV26.scoreBreakdown?.raceImpact?.score,
            tierScore: carrollV26.fantasyTierScore,
            salaryChange: (carrollV26.finalSalary ?? carrollV26.generatedSalary) - 13500,
          },
          v30: {
            momentum: carrollV30.scoreBreakdown?.momentum?.score,
            raceImpact: carrollV30.scoreBreakdown?.raceImpact?.score,
            tierScore: carrollV30.fantasyTierScore,
            salaryChange: (carrollV30.finalSalary ?? carrollV30.generatedSalary) - 13500,
            modelSuggestedChange: carrollV30.modelSuggestedChange,
          },
        },
        arthur: {
          v26: {
            momentum: arthurV26.scoreBreakdown?.momentum?.score,
            raceImpact: arthurV26.scoreBreakdown?.raceImpact?.score,
            tierScore: arthurV26.fantasyTierScore,
            salaryChange: (arthurV26.finalSalary ?? arthurV26.generatedSalary) - 12700,
          },
          v30: {
            momentum: arthurV30.scoreBreakdown?.momentum?.score,
            raceImpact: arthurV30.scoreBreakdown?.raceImpact?.score,
            tierScore: arthurV30.fantasyTierScore,
            salaryChange: (arthurV30.finalSalary ?? arthurV30.generatedSalary) - 12700,
            modelSuggestedChange: arthurV30.modelSuggestedChange,
          },
        },
        sameAppliedIncrease:
          (carrollV30.finalSalary ?? carrollV30.generatedSalary) - 13500 ===
          (arthurV30.finalSalary ?? arthurV30.generatedSalary) - 12700,
      },
      null,
      2
    )
  );
}
