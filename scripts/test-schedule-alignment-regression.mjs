/**
 * Regression checks for schedule_id-first alignment.
 * Run: node scripts/test-schedule-alignment-regression.mjs
 */
import * as cheerio from 'cheerio';
import { getSettings, fetchHtml, getDriverProfiles } from '../api/_lib.js';
import {
  enrichScheduleRaces,
  buildRaceNumberDebug,
  getLatestCompletedPointsRace,
} from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { alignFinishRacesWithTrace } from '../api/_power-rankings-schedule-alignment.js';
import { matchDriverIdByName } from '../api/_power-rankings-recent-form.js';
import { getRecentPointsRaceResults } from '../api/_schedule-points-races.js';
import { extractFinishRacesFromSchedules } from '../api/_simracerhub-schedule-results.js';

const JUSTIN_LEVINE_ID = '30961';
const CHRIS_CARROLL_ID = '39765';
const BRISTOL_SCHEDULE_ID = '346481';
const ROCKINGHAM_SCHEDULE_ID = '346491';
const CHARLOTTE_SCHEDULE_ID = '346493';
const IOWA_SCHEDULE_ID = '346494';

function parseScheduleRaces(html) {
  const $ = cheerio.load(html);
  const races = [];
  $('table').each((_tableIndex, table) => {
    $(table)
      .find('tr')
      .each((_rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length < 7) return;
        const raceNumber = String(cells.eq(0).text() || '').trim();
        if (!/^\d+$/.test(raceNumber)) return;
        const points = String(cells.eq(2).text() || '').trim();
        const winner = String(
          cells.eq(6).find('a').first().text() || cells.eq(6).text() || ''
        ).trim();
        let scheduleId = null;
        $(row)
          .find("a[href*='race']")
          .each((_idx, anchor) => {
            const href = String($(anchor).attr('href') || '');
            const match = href.match(/schedule_id=(\d+)/);
            if (match?.[1]) scheduleId = match[1];
          });
        races.push({
          scheduleRow: Number(raceNumber),
          scheduleId,
          date: String(cells.eq(1).text() || '').trim(),
          points,
          status: points?.toLowerCase() === 'yes' ? 'points' : 'non-points',
          track: String(cells.eq(4).find('a').first().text() || cells.eq(4).text() || '').trim(),
          winner: winner || null,
        });
      });
  });
  return races;
}

async function fetchStandingsRows(settings, scheduleId) {
  const seasonId = settings.seasonId || '27987';
  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${scheduleId}`,
    { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
  );
  const data = await response.json();
  const profiles = await getDriverProfiles();
  const byDriverId = Object.fromEntries(profiles.map((p) => [String(p.driver_id), p]));

  const rows = Object.values(data.rps || {})
    .map((r) => {
      const driver = data.drivers?.[r.drid] || {};
      const rawName = driver.name || r.name || `Driver ${r.drid}`;
      const name = rawName.includes(',')
        ? rawName.split(',').reverse().map((s) => s.trim()).join(' ')
        : rawName;
      const profile = byDriverId[String(r.drid)] || null;
      return {
        driverId: String(r.drid),
        driverName: profile?.display_name || name,
        position: Number(r.pos2),
        points: Number(r.tpts || 0),
        wins: Number(r.wins || 0),
        top5: Number(r.top5 || 0),
        top10: Number(r.top10 || 0),
      };
    })
    .filter((r) => r.position >= 1)
    .sort((a, b) => a.position - b.position);

  return { rows, schedules: data.schedules || {} };
}

function buildDriverLookup(standings) {
  return new Map(
    standings.map((row) => [
      row.driverId,
      {
        driverId: row.driverId,
        driverName: row.driverName,
        position: row.position,
      },
    ])
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function findAlignedByTrack(alignedRaces, needle) {
  return alignedRaces.find((race) => new RegExp(needle, 'i').test(race.track || ''));
}

function finishForDriver(grounding, raceNumber) {
  return (grounding?.recentRaceFinishes || []).find((row) => row.raceNumber === raceNumber);
}

async function runRegression() {
  const settings = await getSettings();
  const scheduleHtml = await fetchHtml(settings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRaces(scheduleHtml));
  const latestRace = getLatestCompletedPointsRace(scheduleRaces);
  const raceNumber = latestRace?.officialPointsRaceNumber ?? 12;

  const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber);
  const { rows: standings, schedules } = await fetchStandingsRows(
    settings,
    raceNumberDebug.standingsScheduleId
  );
  const driverLookup = buildDriverLookup(standings);
  const finishRaces = extractFinishRacesFromSchedules(schedules);

  const justinId = matchDriverIdByName('Justin Levine', driverLookup);
  assert(String(justinId) === JUSTIN_LEVINE_ID, `Expected Justin Levine id ${JUSTIN_LEVINE_ID}, got ${justinId}`);

  const factualGrounding = buildFactualGroundingContext({
    standings,
    scheduleRaces,
    raceNumber,
    schedules,
    driverLookup,
    recentResults: [],
    manualRaceNotes: '',
    transcriptSummary: '',
  });

  const justinGrounding = factualGrounding.drivers[JUSTIN_LEVINE_ID];
  const rockinghamPointsRace = scheduleRaces.find(
    (race) => !race.nonPoints && /rockingham/i.test(race.track || '')
  )?.officialPointsRaceNumber;
  const charlottePointsRace = scheduleRaces.find(
    (race) => !race.nonPoints && /charlotte/i.test(race.track || '')
  )?.officialPointsRaceNumber;
  const iowaPointsRace = scheduleRaces.find(
    (race) => !race.nonPoints && /iowa/i.test(race.track || '')
  )?.officialPointsRaceNumber;

  assert(rockinghamPointsRace, 'Rockingham points race not found on schedule page');
  assert(charlottePointsRace, 'Charlotte points race not found on schedule page');
  assert(iowaPointsRace, 'Iowa points race not found on schedule page');

  const rockinghamFinish = finishForDriver(justinGrounding, rockinghamPointsRace);
  assert(!rockinghamFinish, `Justin Levine should have no Rockingham recentRaceFinish (DNP), got ${JSON.stringify(rockinghamFinish)}`);

  const charlotteFinish = finishForDriver(justinGrounding, charlottePointsRace);
  assert(charlotteFinish?.finish === 1, `Justin Levine Charlotte should be P1, got ${JSON.stringify(charlotteFinish)}`);

  const iowaFinish = finishForDriver(justinGrounding, iowaPointsRace);
  assert(iowaFinish?.finish === 1, `Justin Levine Iowa should be P1, got ${JSON.stringify(iowaFinish)}`);

  assert(
    justinGrounding.last3RaceStarts === 2,
    `Justin Levine should have 2 starts in last-3 window, got ${justinGrounding.last3RaceStarts}`
  );
  assert(
    justinGrounding.last3RaceWindowSize === 3,
    `Justin Levine last-3 window size should be 3, got ${justinGrounding.last3RaceWindowSize}`
  );
  assert(
    justinGrounding.last3RaceDnpCount === 1,
    `Justin Levine should have 1 DNP in last-3 window, got ${justinGrounding.last3RaceDnpCount}`
  );
  assert(
    (justinGrounding.missedRecentRaceNames || []).some((name) => /rockingham/i.test(name)),
    `Justin Levine missed races should include Rockingham, got ${JSON.stringify(justinGrounding.missedRecentRaceNames)}`
  );
  assert(
    justinGrounding.last3RaceAverageFinish === 1.0,
    `Justin Levine average should be 1.0 from 2 starts, got ${justinGrounding.last3RaceAverageFinish}`
  );

  const alignedLatest = alignFinishRacesWithTrace(
    getRecentPointsRaceResults(scheduleRaces, raceNumber, 3),
    finishRaces,
    driverLookup
  );

  const rockinghamAligned = findAlignedByTrack(alignedLatest, 'rockingham');
  assert(
    rockinghamAligned?.schedulesApiScheduleId === ROCKINGHAM_SCHEDULE_ID,
    `Rockingham should align to ${ROCKINGHAM_SCHEDULE_ID}, got ${rockinghamAligned?.schedulesApiScheduleId}`
  );
  assert(
    rockinghamAligned?.alignmentMethod === 'schedules-api-schedule-id-match',
    `Rockingham alignmentMethod should be schedules-api-schedule-id-match, got ${rockinghamAligned?.alignmentMethod}`
  );

  const iowaAligned = findAlignedByTrack(alignedLatest, 'iowa');
  assert(
    iowaAligned?.schedulesApiScheduleId === IOWA_SCHEDULE_ID,
    `Iowa should align to ${IOWA_SCHEDULE_ID}, got ${iowaAligned?.schedulesApiScheduleId}`
  );

  const charlotteAligned = findAlignedByTrack(alignedLatest, 'charlotte');
  assert(
    charlotteAligned?.schedulesApiScheduleId === CHARLOTTE_SCHEDULE_ID,
    `Charlotte should align to ${CHARLOTTE_SCHEDULE_ID}, got ${charlotteAligned?.schedulesApiScheduleId}`
  );

  const bristolPointsRace = scheduleRaces.find(
    (race) => !race.nonPoints && /bristol/i.test(race.track || '')
  )?.officialPointsRaceNumber;
  assert(bristolPointsRace, 'Bristol points race not found on schedule page');

  const bristolAlignedWindow = alignFinishRacesWithTrace(
    getRecentPointsRaceResults(scheduleRaces, bristolPointsRace, 3),
    finishRaces,
    driverLookup
  );
  const bristolAligned = findAlignedByTrack(bristolAlignedWindow, 'bristol');
  assert(
    bristolAligned?.schedulesApiScheduleId === BRISTOL_SCHEDULE_ID,
    `Bristol should align to ${BRISTOL_SCHEDULE_ID}, got ${bristolAligned?.schedulesApiScheduleId}`
  );
  assert(
    bristolAligned?.finishes?.[CHRIS_CARROLL_ID] === 1,
    `Chris Carroll3 should be P1 at Bristol, got ${bristolAligned?.finishes?.[CHRIS_CARROLL_ID]}`
  );

  const rockinghamCarrollWindow = alignFinishRacesWithTrace(
    getRecentPointsRaceResults(scheduleRaces, rockinghamPointsRace, 3),
    finishRaces,
    driverLookup
  );
  const rockinghamCarrollAligned = findAlignedByTrack(rockinghamCarrollWindow, 'rockingham');
  assert(
    rockinghamCarrollAligned?.schedulesApiScheduleId === ROCKINGHAM_SCHEDULE_ID,
    `Rockingham (Carroll win) should align to ${ROCKINGHAM_SCHEDULE_ID}, got ${rockinghamCarrollAligned?.schedulesApiScheduleId}`
  );
  assert(
    rockinghamCarrollAligned?.finishes?.[CHRIS_CARROLL_ID] === 1,
    `Chris Carroll3 should be P1 at Rockingham, got ${rockinghamCarrollAligned?.finishes?.[CHRIS_CARROLL_ID]}`
  );
  assert(
    rockinghamCarrollAligned?.schedulesApiScheduleId !== BRISTOL_SCHEDULE_ID,
    'Rockingham must not reuse Bristol schedule_id'
  );

  console.log('All schedule alignment regression checks passed.');
  console.log(
    JSON.stringify(
      {
        raceNumber,
        justinRecentRaceFinishes: justinGrounding.recentRaceFinishes,
        alignedLatest: alignedLatest.map((race) => ({
          track: race.track,
          alignmentMethod: race.alignmentMethod,
          schedulePageScheduleId: race.schedulePageScheduleId,
          schedulesApiScheduleId: race.schedulesApiScheduleId,
        })),
      },
      null,
      2
    )
  );
}

runRegression().catch((error) => {
  console.error('Regression failed:', error.message);
  process.exit(1);
});
