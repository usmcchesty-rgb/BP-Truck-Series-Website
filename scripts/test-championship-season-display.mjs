import assert from 'node:assert/strict';
import {
  attachDisplayRaceLabels,
  enrichScheduleRaces,
  buildSiteResultsUrl,
  formatRaceDisplayTitle,
  resolveRaceForResultsQuery,
} from '../api/_schedule-points-races.js';
import {
  SEASON_CHAMPIONSHIP_STRUCTURE,
  derivePlayoffPhase,
  resolveSeasonRaceCounts,
  formatStandingsSidebarPhase,
  buildSeasonScheduleAuditRows,
  playoffRacesTotal,
  normalChampionshipRacesTotal,
} from '../api/_championship-season.js';
import {
  buildStandingsGraphicModel,
  playoffBubbleKind,
  findPlayoffCutPlacement,
} from '../public/standings-graphic-export-logic.js';

function season11OpeningFixture() {
  return [
    {
      raceNumber: 1,
      date: 'Feb 22, 2026',
      points: 'no',
      status: 'non-points',
      track: 'Daytona International Speedway Oval',
      winner: 'Duel One Winner',
      link: 'season_race.php?schedule_id=346474',
      scheduleId: '346474',
    },
    {
      raceNumber: 2,
      date: 'Feb 22, 2026',
      points: 'no',
      status: 'non-points',
      track: 'Daytona International Speedway Oval',
      winner: 'Duel Two Winner',
      link: 'season_race.php?schedule_id=346475',
      scheduleId: '346475',
    },
    {
      raceNumber: 3,
      date: 'Mar 1, 2026',
      points: 'yes',
      status: 'points',
      track: 'Daytona International Speedway Oval Night',
      winner: 'Daytona Winner',
      link: 'season_race.php?schedule_id=346476',
      scheduleId: '346476',
    },
    {
      raceNumber: 4,
      date: 'Mar 8, 2026',
      points: 'yes',
      status: 'points',
      track: 'Kentucky Speedway Oval',
      winner: 'Kentucky Winner',
      link: 'season_race.php?schedule_id=346477',
      scheduleId: '346477',
    },
  ];
}

function buildFullSeasonFixture({ completedNormal = 20 } = {}) {
  const races = season11OpeningFixture().slice(0, 2);
  for (let i = 1; i <= 30; i += 1) {
    races.push({
      raceNumber: i + 2,
      date: `2026-0${Math.min(9, Math.ceil(i / 4))}-01`,
      points: 'yes',
      status: 'points',
      track: `Track ${i}`,
      winner: i <= completedNormal ? `Winner ${i}` : '',
      link: i <= completedNormal ? `season_race.php?schedule_id=${300000 + i}` : '',
      scheduleId: i <= completedNormal ? String(300000 + i) : null,
    });
  }
  return enrichScheduleRaces(races);
}

{
  // Duel 1A / 1B / Daytona = 1 / next = 2
  const enriched = enrichScheduleRaces(season11OpeningFixture());
  assert.equal(enriched[0].displayRaceLabel, '1A');
  assert.equal(enriched[0].isOpeningDuel, true);
  assert.equal(enriched[0].countsAsNormalChampionshipRace, false);
  assert.equal(enriched[1].displayRaceLabel, '1B');
  assert.equal(enriched[2].displayRaceLabel, '1');
  assert.equal(enriched[2].officialPointsRaceNumber, 1);
  assert.equal(enriched[3].displayRaceLabel, '2');
  assert.equal(formatRaceDisplayTitle(enriched[0]), 'Race 1A');
  assert.equal(formatRaceDisplayTitle(enriched[2]), 'Race 1');
}

{
  // Later-season labels stay on official points index (no duel inflation)
  const races = [];
  races.push({
    raceNumber: 1,
    points: 'no',
    status: 'non-points',
    track: 'Duel',
    winner: 'A',
    scheduleId: '1',
  });
  races.push({
    raceNumber: 2,
    points: 'no',
    status: 'non-points',
    track: 'Duel',
    winner: 'B',
    scheduleId: '2',
  });
  for (let i = 1; i <= 22; i += 1) {
    races.push({
      raceNumber: i + 2,
      points: 'yes',
      status: 'points',
      track: `T${i}`,
      winner: 'W',
      scheduleId: String(100 + i),
    });
  }
  const enriched = enrichScheduleRaces(races);
  assert.equal(enriched[21].displayRaceLabel, '20'); // schedule row 22
  assert.equal(enriched[21].officialPointsRaceNumber, 20);
  assert.equal(enriched[22].displayRaceLabel, '21');
}

{
  // Completed counts exclude duel inflation for championship totals
  const enriched = enrichScheduleRaces(season11OpeningFixture());
  const counts = resolveSeasonRaceCounts(enriched, { now: new Date('2026-03-10T12:00:00Z') });
  assert.equal(counts.scheduleEventsTotal, 4);
  assert.equal(counts.completedScheduleEvents, 4);
  assert.equal(counts.completedOpeningDuels, 2);
  assert.equal(counts.completedNormalChampionshipRaces, 2);
  assert.equal(counts.completedRegularSeasonRaces, 2);
}

{
  // Schedule links: completed → site results by scheduleId; future → null
  const enriched = enrichScheduleRaces([
    ...season11OpeningFixture(),
    {
      raceNumber: 5,
      points: 'yes',
      status: 'points',
      track: 'Future Track',
      winner: '',
      scheduleId: null,
      link: '',
    },
  ]);
  assert.equal(buildSiteResultsUrl(enriched[0]), '/results.html?scheduleId=346474');
  assert.equal(buildSiteResultsUrl(enriched[2]), '/results.html?scheduleId=346476');
  assert.equal(buildSiteResultsUrl(enriched[4]), null);

  assert.equal(
    resolveRaceForResultsQuery(enriched, { scheduleId: '346474' })?.displayRaceLabel,
    '1A'
  );
  assert.equal(
    resolveRaceForResultsQuery(enriched, { race: '1B' })?.displayRaceLabel,
    '1B'
  );
  assert.equal(
    resolveRaceForResultsQuery(enriched, { raceNumber: 1 })?.displayRaceLabel,
    '1'
  );
}

{
  // Structure counts
  assert.equal(playoffRacesTotal(), 10);
  assert.equal(normalChampionshipRacesTotal(), 30);
  assert.equal(SEASON_CHAMPIONSHIP_STRUCTURE.regularSeasonRaces, 20);
}

{
  // Playoff phase boundaries
  const endRegular = derivePlayoffPhase(20);
  assert.equal(endRegular.phase, 'round_1');
  assert.equal(endRegular.roundRaceNumber, 1);
  assert.equal(endRegular.fieldSize, 16);
  assert.equal(endRegular.cutPosition, 12);
  assert.equal(endRegular.isPlayoffs, true);

  const playoff1 = derivePlayoffPhase(21);
  assert.equal(playoff1.phase, 'round_1');
  assert.equal(playoff1.roundRaceNumber, 2);

  const afterRound1 = derivePlayoffPhase(23);
  assert.equal(afterRound1.phase, 'round_2');
  assert.equal(afterRound1.fieldSize, 12);
  assert.equal(afterRound1.cutPosition, 8);
  assert.equal(afterRound1.roundRaceNumber, 1);

  const afterRound2 = derivePlayoffPhase(26);
  assert.equal(afterRound2.phase, 'final');
  assert.equal(afterRound2.fieldSize, 8);
  assert.equal(afterRound2.cutPosition, null);
  assert.equal(afterRound2.showCutColumn, false);
  assert.equal(afterRound2.roundRaceNumber, 1);

  const final4 = derivePlayoffPhase(29);
  assert.equal(final4.phase, 'final');
  assert.equal(final4.roundRaceNumber, 4);

  const complete = derivePlayoffPhase(30);
  assert.equal(complete.phase, 'season_complete');
  assert.equal(complete.isSeasonComplete, true);

  const midRegular = derivePlayoffPhase(10);
  assert.equal(midRegular.isRegularSeason, true);
  assert.equal(midRegular.cutPosition, 16);
}

{
  // Sidebar phase copy after Martinsville (20 completed)
  const phase = derivePlayoffPhase(20);
  const counts = {
    completedRegularSeasonRaces: 20,
    regularSeasonRacesTotal: 20,
  };
  const sidebar = formatStandingsSidebarPhase(phase, counts);
  assert.equal(sidebar.primary, 'ROUND 1');
  assert.match(sidebar.secondary, /Race 1 of 3/);
  assert.match(sidebar.detail, /16 Drivers → 12 Advance/);
}

{
  // Graphic mode switching: regular cut 16 vs round1 cut 12 vs final no cut
  const rows = Array.from({ length: 30 }, (_, i) => ({
    position: i + 1,
    driver: `Driver ${i + 1}`,
    points: 1000 - i * 5,
    wins: 0,
  }));

  const regular = buildStandingsGraphicModel(
    { rows, settings: { seasonName: 'Season 11', playoffCut: 16 } },
    {},
    { playoffPhase: derivePlayoffPhase(10) }
  );
  assert.equal(regular.playoffCut, 16);
  assert.ok(regular.cutPlacement);

  const round1 = buildStandingsGraphicModel(
    { rows, settings: { seasonName: 'Season 11' } },
    {},
    { playoffPhase: derivePlayoffPhase(20) }
  );
  assert.equal(round1.playoffCut, 12);
  assert.equal(playoffBubbleKind(11, 12), 'inside');
  assert.equal(playoffBubbleKind(12, 12), 'inside');
  assert.equal(playoffBubbleKind(13, 12), 'outside');
  assert.equal(findPlayoffCutPlacement(rows, 12)?.playoffCut, 12);

  const finalModel = buildStandingsGraphicModel(
    { rows, settings: { seasonName: 'Season 11' } },
    {},
    { playoffPhase: derivePlayoffPhase(26) }
  );
  assert.equal(finalModel.playoffCut, null);
  assert.equal(finalModel.showCutColumn, false);
  assert.equal(finalModel.cutPlacement, null);
}

{
  // Full schedule audit does not drift
  const enriched = buildFullSeasonFixture({ completedNormal: 20 });
  const audit = buildSeasonScheduleAuditRows(enriched);
  assert.equal(audit[0].displayRaceLabel, '1A');
  assert.equal(audit[1].displayRaceLabel, '1B');
  assert.equal(audit[2].displayRaceLabel, '1');
  assert.equal(audit[21].displayRaceLabel, '20'); // Martinsville-shaped
  assert.equal(audit[22].displayRaceLabel, '21');
  assert.equal(audit[0].resultLink, '/results.html?scheduleId=346474');
  assert.equal(audit[22].resultLink, null); // incomplete future
  assert.equal(audit.length, 32);
}

{
  // attachDisplayRaceLabels is idempotent-safe on already enriched rows
  const once = enrichScheduleRaces(season11OpeningFixture());
  const twice = attachDisplayRaceLabels(once);
  assert.equal(twice[0].displayRaceLabel, '1A');
  assert.equal(twice[2].displayRaceLabel, '1');
}

{
  // Full 32-event Season 11 invariants + results query contract
  const enriched = buildFullSeasonFixture({ completedNormal: 20 });
  assert.equal(enriched.length, 32);
  assert.equal(enriched.filter((race) => race.isOpeningDuel).length, 2);
  assert.equal(
    enriched.filter((race) => race.countsAsNormalChampionshipRace).length,
    30
  );

  assert.deepEqual(
    enriched.slice(0, 10).map((race) => race.displayRaceLabel),
    ['1A', '1B', '1', '2', '3', '4', '5', '6', '7', '8']
  );
  assert.deepEqual(
    enriched
      .filter((race) => race.countsAsNormalChampionshipRace)
      .slice(-5)
      .map((race) => race.displayRaceLabel),
    ['26', '27', '28', '29', '30']
  );

  const championshipNumbers = enriched
    .filter((race) => race.countsAsNormalChampionshipRace)
    .map((race) => race.officialPointsRaceNumber);
  assert.deepEqual(
    championshipNumbers,
    Array.from({ length: 30 }, (_, i) => i + 1)
  );

  const scheduleIds = enriched.map((race) => race.scheduleId).filter(Boolean);
  assert.equal(new Set(scheduleIds).size, scheduleIds.length);

  const displayLabels = enriched
    .map((race) => race.displayRaceLabel)
    .filter(Boolean);
  assert.equal(new Set(displayLabels).size, displayLabels.length);

  // race=1 / raceNumber=1 => championship Daytona, NOT Duel 1A
  const byRaceOne = resolveRaceForResultsQuery(enriched, { race: '1' });
  const byRaceNumberOne = resolveRaceForResultsQuery(enriched, {
    raceNumber: 1,
  });
  assert.equal(byRaceOne?.displayRaceLabel, '1');
  assert.equal(byRaceOne?.isOpeningDuel, false);
  assert.equal(byRaceNumberOne?.officialPointsRaceNumber, 1);
  assert.equal(byRaceNumberOne?.scheduleId, '300001');

  const duelA = resolveRaceForResultsQuery(enriched, { race: '1A' });
  const duelB = resolveRaceForResultsQuery(enriched, { race: '1B' });
  assert.equal(duelA?.displayRaceLabel, '1A');
  assert.equal(duelB?.displayRaceLabel, '1B');
  assert.notEqual(duelA?.scheduleId, duelB?.scheduleId);
  assert.equal(
    resolveRaceForResultsQuery(enriched, { scheduleId: '346474' })
      ?.displayRaceLabel,
    '1A'
  );

  for (const race of enriched) {
    if (race.winner) {
      assert.match(
        String(buildSiteResultsUrl(race) || ''),
        /^\/results\.html\?scheduleId=/
      );
    } else {
      assert.equal(buildSiteResultsUrl(race), null);
    }
  }
}

console.log('test-championship-season-display: ok');
