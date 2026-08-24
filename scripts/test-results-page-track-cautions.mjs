/**
 * Results page: track follows scheduleId; display labels are presentation-only;
 * caution count normalization preserves 0.
 */
import assert from 'node:assert/strict';
import {
  enrichScheduleRaces,
  formatRaceDisplayTitle,
  resolveRaceForResultsQuery,
} from '../api/_schedule-points-races.js';
import { parseCautionCountFromRaceHtml } from '../api/_caution-stats.js';

function seasonFixture() {
  const opening = [
    {
      raceNumber: 1,
      date: 'Feb 22, 2026',
      points: 'no',
      status: 'non-points',
      track: 'Daytona International Speedway Oval',
      winner: 'Duel A Winner',
      link: 'season_race.php?schedule_id=346474',
      scheduleId: '346474',
    },
    {
      raceNumber: 2,
      date: 'Feb 22, 2026',
      points: 'no',
      status: 'non-points',
      track: 'Daytona International Speedway Oval',
      winner: 'Duel B Winner',
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
  ];

  const mid = [];
  for (let i = 2; i <= 9; i += 1) {
    mid.push({
      raceNumber: i + 2,
      date: `Mar ${i}, 2026`,
      points: 'yes',
      status: 'points',
      track: `Track ${i}`,
      winner: `Winner ${i}`,
      link: `season_race.php?schedule_id=${400000 + i}`,
      scheduleId: String(400000 + i),
    });
  }

  return enrichScheduleRaces([
    ...opening,
    ...mid,
    {
      raceNumber: 12,
      date: 'May 17, 2026',
      points: 'yes',
      status: 'points',
      track: 'Rockingham Speedway Oval',
      winner: 'Chris Carroll3',
      link: 'season_race.php?schedule_id=346485',
      scheduleId: '346485',
    },
    {
      raceNumber: 21,
      date: 'Aug 16, 2026',
      points: 'yes',
      status: 'points',
      track: 'Martinsville Speedway Oval',
      winner: 'Martinsville Winner',
      link: 'season_race.php?schedule_id=346494',
      scheduleId: '346494',
    },
    {
      raceNumber: 22,
      date: 'Aug 23, 2026',
      points: 'yes',
      status: 'points',
      track: 'Texas Motor Speedway Oval',
      winner: 'Latest Winner',
      link: 'season_race.php?schedule_id=346495',
      scheduleId: '346495',
    },
  ]);
}

{
  const races = seasonFixture();
  assert.equal(races[0].displayRaceLabel, '1A');
  assert.equal(races[1].displayRaceLabel, '1B');
  assert.equal(races[2].displayRaceLabel, '1');
  assert.equal(formatRaceDisplayTitle(races[2]), 'Race 1');
  assert.equal(formatRaceDisplayTitle(races[0]), 'Race 1A');
  // Presentation title must not embed track.
  assert.ok(!/Daytona/i.test(formatRaceDisplayTitle(races[2])));
  assert.ok(!/Rockingham/i.test(formatRaceDisplayTitle(races.find((r) => r.scheduleId === '346485'))));
}

{
  const races = seasonFixture();
  const rockingham = resolveRaceForResultsQuery(races, { scheduleId: '346485' });
  assert.ok(rockingham);
  assert.equal(rockingham.track, 'Rockingham Speedway Oval');
  assert.equal(rockingham.scheduleId, '346485');
  assert.equal(rockingham.displayRaceLabel, '10');

  const latest = resolveRaceForResultsQuery(races, {});
  // Empty query returns null — callers use latest completed separately.
  assert.equal(latest, null);

  const byLatestId = resolveRaceForResultsQuery(races, { scheduleId: '346495' });
  assert.equal(byLatestId.track, 'Texas Motor Speedway Oval');

  // Historical scheduleId must not resolve to latest track.
  assert.notEqual(rockingham.track, byLatestId.track);
  assert.equal(
    resolveRaceForResultsQuery(races, { scheduleId: '346485' }).track,
    'Rockingham Speedway Oval'
  );
}

{
  const races = seasonFixture();
  const duelA = resolveRaceForResultsQuery(races, { race: '1A' });
  assert.equal(duelA.scheduleId, '346474');
  assert.equal(duelA.displayRaceLabel, '1A');
  assert.match(duelA.track, /Daytona/i);

  const duelB = resolveRaceForResultsQuery(races, { race: '1B' });
  assert.equal(duelB.scheduleId, '346475');

  const daytona = resolveRaceForResultsQuery(races, { race: '1' });
  assert.equal(daytona.scheduleId, '346476');
  assert.equal(daytona.displayRaceLabel, '1');
  assert.match(daytona.track, /Night/i);

  const byNumber = resolveRaceForResultsQuery(races, { raceNumber: 10 });
  assert.equal(byNumber.scheduleId, '346485');
  assert.equal(byNumber.track, 'Rockingham Speedway Oval');
}

{
  const summaryHtml = '<div>Lead Changes · 3 cautions for 12 laps</div>';
  assert.equal(parseCautionCountFromRaceHtml(summaryHtml), 3);

  const zeroHtml = '<div>Lead Changes · 0 cautions</div>';
  assert.equal(parseCautionCountFromRaceHtml(zeroHtml), 0);
  assert.ok(Number.isFinite(parseCautionCountFromRaceHtml(zeroHtml)));

  const fallbackHtml = '<p>There were 14 cautions in the race.</p>';
  assert.equal(parseCautionCountFromRaceHtml(fallbackHtml), 14);

  assert.equal(parseCautionCountFromRaceHtml(''), null);
  assert.equal(parseCautionCountFromRaceHtml('<div>No summary</div>'), null);
}

console.log('test-results-page-track-cautions: ok');
