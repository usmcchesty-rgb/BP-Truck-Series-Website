import assert from 'node:assert/strict';
import { assignValueGrades } from '../api/_fantasy-admin-analytics.js';
import {
  buildDashboardCards,
  parseFiniteNumeric,
  selectBestFantasyValue,
  selectTopFantasyPick,
} from '../api/_fantasy-public-analysis.js';

function makeDriver({
  driverId,
  driverName,
  fantasyTierScore,
  salary,
  status = 'Active',
  lastStartRaceNumber = 15,
}) {
  return {
    driverId: String(driverId),
    driverName,
    carNumber: '00',
    computedTier: fantasyTierScore >= 85 ? 'Top Tier' : 'Mid-Tier',
    fantasyTierScore,
    finalSalary: salary,
    generatedSalary: salary,
    scoreBreakdown: {
      reliability: {
        details: {
          last5Starts: 5,
          last5WindowSize: 5,
          lastStartRaceNumber,
        },
      },
    },
    attendanceContext: {
      last5Starts: 5,
      last5WindowSize: 5,
      lastStartRaceNumber,
    },
  };
}

function withValueGrades(drivers) {
  const copy = drivers.map((driver) => ({ ...driver }));
  assignValueGrades(copy);
  return copy;
}

// Race 16-style fixture: Chris Carroll strongest overall and top raw value;
// Brian Zimmerman is the next-best distinct value play after duplicate suppression.
const race16Fixture = withValueGrades([
  makeDriver({
    driverId: 'carroll',
    driverName: 'Chris Carroll3',
    fantasyTierScore: 92.4,
    salary: 13500,
  }),
  makeDriver({
    driverId: 'zimmerman',
    driverName: 'Brian Zimmerman3',
    fantasyTierScore: 72.0,
    salary: 11000,
  }),
  makeDriver({
    driverId: 'marasco',
    driverName: 'Ty Marasco3',
    fantasyTierScore: 81.5,
    salary: 12800,
  }),
  makeDriver({
    driverId: 'wilson',
    driverName: 'Logan M Wilson3',
    fantasyTierScore: 42.0,
    salary: 9500,
  }),
  makeDriver({
    driverId: 'klein',
    driverName: 'Kleinschmidt3',
    fantasyTierScore: 38.0,
    salary: 8200,
  }),
]);

{
  const top = selectTopFantasyPick(race16Fixture);
  assert.equal(top.pick.driverName, 'Chris Carroll3');
  assert.equal(top.pick.fantasyRank, 1);
  assert.equal(top.selectionMetric, 'fantasyRank');
  assert.equal(top.pick.displayMetric.label, 'Fantasy Rank');
  assert.equal(top.pick.displayMetric.value, '#1');
}

{
  const value = selectBestFantasyValue(race16Fixture);
  assert.equal(value.pick.driverName, 'Chris Carroll3');
  assert.ok(value.pick.valueScore > 0);
  assert.equal(value.pick.displayMetric.label, 'Value Score');
  assert.ok(value.pick.displayMetric.value);
  assert.ok(value.pick.valueGrade);
}

{
  const cards = buildDashboardCards(race16Fixture).cards;
  assert.equal(cards.topPick.driverName, 'Chris Carroll3');
  assert.equal(cards.bestValue.driverName, 'Brian Zimmerman3');
  assert.equal(cards.duplicateSuppressed, true);
  assert.equal(cards.bestValueUnavailable, false);
}

{
  const top = selectTopFantasyPick(race16Fixture);
  const suppressed = selectBestFantasyValue(race16Fixture, {
    excludeDriverId: top.pick.driverId,
  });
  assert.equal(suppressed.pick.driverName, 'Brian Zimmerman3');
  assert.equal(suppressed.duplicateSuppressed, true);
}

{
  const onlyDriver = withValueGrades([
    makeDriver({
      driverId: 'solo',
      driverName: 'Solo Driver3',
      fantasyTierScore: 88,
      salary: 12000,
    }),
  ]);
  const cards = buildDashboardCards(onlyDriver).cards;
  assert.equal(cards.topPick.driverName, 'Solo Driver3');
  assert.equal(cards.bestValue.driverName, 'Solo Driver3');
  assert.equal(cards.sameDriverOnlyOption, true);
  assert.equal(cards.duplicateSuppressed, false);
}

{
  const noValue = [
    makeDriver({
      driverId: 'novalue',
      driverName: 'No Value3',
      fantasyTierScore: 80,
      salary: 10000,
    }),
  ];
  const cards = buildDashboardCards(noValue).cards;
  assert.equal(cards.topPick.driverName, 'No Value3');
  assert.equal(cards.bestValue, null);
  assert.equal(cards.bestValueUnavailable, true);
  assert.equal(cards.bestValueUnavailableMessage, 'Value analysis unavailable');
}

{
  const tiedValue = withValueGrades([
    makeDriver({
      driverId: 'a',
      driverName: 'Alpha3',
      fantasyTierScore: 70,
      salary: 10000,
    }),
    makeDriver({
      driverId: 'b',
      driverName: 'Bravo3',
      fantasyTierScore: 72,
      salary: 10000,
    }),
  ]);
  tiedValue[0].valueScore = 6.5;
  tiedValue[0].valueGrade = 'A';
  tiedValue[1].valueScore = 6.5;
  tiedValue[1].valueGrade = 'A';

  const value = selectBestFantasyValue(tiedValue);
  assert.equal(value.pick.driverName, 'Bravo3');
}

{
  const inactive = withValueGrades([
    makeDriver({
      driverId: 'inactive',
      driverName: 'Inactive3',
      fantasyTierScore: 99,
      salary: 14000,
      status: 'Inactive',
      lastStartRaceNumber: 1,
    }),
    makeDriver({
      driverId: 'active',
      driverName: 'Active3',
      fantasyTierScore: 75,
      salary: 11000,
    }),
  ]);
  inactive[0].scoreBreakdown.reliability.details.last5Starts = 0;
  inactive[0].attendanceContext.last5Starts = 0;

  const top = selectTopFantasyPick(inactive);
  assert.equal(top.pick.driverName, 'Active3');
}

{
  assert.equal(parseFiniteNumeric('5.26'), 5.26);
  assert.equal(parseFiniteNumeric('bad'), null);
  assert.equal(parseFiniteNumeric(null), null);
}

{
  const duplicateRows = withValueGrades([
    makeDriver({
      driverId: 'dup',
      driverName: 'Dup Driver3',
      fantasyTierScore: 85,
      salary: 12000,
    }),
    {
      ...makeDriver({
        driverId: 'dup',
        driverName: 'Dup Driver3',
        fantasyTierScore: 85,
        salary: 12000,
      }),
    },
  ]);
  const top = selectTopFantasyPick(duplicateRows);
  assert.equal(top.candidates.length, 1);
}

{
  const diagnostics = buildDashboardCards(race16Fixture).diagnostics;
  assert.equal(diagnostics.topPick.topCandidates.length, 5);
  assert.equal(diagnostics.bestValue.topCandidates.length, 5);
  assert.equal(diagnostics.topPick.topCandidates[0].driverName, 'Chris Carroll3');
  assert.equal(diagnostics.bestValue.topCandidates[0].driverName, 'Chris Carroll3');
  console.log('Race 16 fixture top-five Top Pick candidates:');
  for (const row of diagnostics.topPick.topCandidates) {
    console.log(
      `  #${row.candidateRank} ${row.driverName} — rank ${row.fantasyRank}, tier ${row.fantasyTierScore}, value ${row.valueScore}`
    );
  }
  console.log('Race 16 fixture top-five Best Value candidates:');
  for (const row of diagnostics.bestValue.topCandidates) {
    console.log(
      `  #${row.candidateRank} ${row.driverName} — value ${row.valueScore} (${row.valueGrade}), rank ${row.fantasyRank}`
    );
  }
}

console.log('test-fantasy-dashboard-cards: ok');
