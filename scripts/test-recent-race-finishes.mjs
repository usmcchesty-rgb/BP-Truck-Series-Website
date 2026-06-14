import { getSettings, fetchHtml, getDriverProfiles } from '../api/_lib.js';
import { enrichScheduleRaces, buildRaceNumberDebug } from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext, buildRecentRaceFinishDiagnostics } from '../api/_power-rankings-factual-grounding.js';
import { extractFinishRacesFromSchedules } from '../api/_simracerhub-schedule-results.js';
import * as cheerio from 'cheerio';

function parseScheduleRaces(html) {
  const $ = cheerio.load(html);
  const races = [];
  $('table')
    .find('tr')
    .each((_i, tr) => {
      const tds = $(tr).find('td');
      if (!tds || tds.length < 7) return;
      const scheduleLinks = $(tr)
        .find("a[href*='schedule_id=']")
        .map((_idx, a) => String($(a).attr('href') || '').match(/schedule_id=(\d+)/)?.[1] || null)
        .get()
        .filter(Boolean);
      const winner = String($(tds[6]).find('a').first().text() || $(tds[6]).text() || '').trim();
      races.push({
        scheduleRow: races.length + 1,
        track: String($(tds[1]).text() || '').trim(),
        date: String($(tds[2]).text() || '').trim(),
        points: String($(tds[4]).text() || '').trim(),
        status: String($(tds[5]).text() || '').trim(),
        winner,
        scheduleId: scheduleLinks[0] || null,
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
        top5: Number(r.t5 || 0),
        top10: Number(r.t10 || 0),
      };
    })
    .filter((r) => r.position >= 1)
    .sort((a, b) => a.position - b.position);

  return { rows, schedules: data.schedules || {} };
}

const settings = await getSettings();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = enrichScheduleRaces(parseScheduleRaces(scheduleHtml));
const raceNumber = 12;
const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber);
const { rows: standings, schedules } = await fetchStandingsRows(
  settings,
  raceNumberDebug.standingsScheduleId
);

const driverLookup = new Map(
  standings.map((row) => [
    row.driverId,
    {
      driverId: row.driverId,
      driverName: row.driverName,
      position: row.position,
    },
  ])
);

const finishRaces = extractFinishRacesFromSchedules(schedules);
console.log('Schedules with official RACE results:', finishRaces.length);
console.log('Last 3 finish race schedule_ids:', finishRaces.slice(-3).map((r) => r.scheduleId));

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

console.log('\nSchedules results summary:', factualGrounding.schedulesResultsSummary);
console.log('Coverage:', factualGrounding.diagnostics);

const sampleDriver = standings[0];
const sampleGrounding = factualGrounding.drivers[sampleDriver.driverId];
console.log(`\nSample driver ${sampleDriver.driverName}:`);
console.log('recentRaceFinishes:', sampleGrounding.recentRaceFinishes);
console.log('last3RaceAverageFinish:', sampleGrounding.last3RaceAverageFinish);
console.log('best/worst:', sampleGrounding.bestFinishLast3, sampleGrounding.worstFinishLast3);

const diagnostics = buildRecentRaceFinishDiagnostics(factualGrounding, standings.slice(0, 3).map((row, i) => ({
  rank: i + 1,
  driverId: row.driverId,
})));
console.log('\nDiagnostics:', {
  recentRaceFinishesUsed: diagnostics.recentRaceFinishesUsed,
  rankedTop3: diagnostics.last3RaceAverageFinish,
});
