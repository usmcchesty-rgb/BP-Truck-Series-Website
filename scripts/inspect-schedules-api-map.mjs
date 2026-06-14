import { getSettings, fetchHtml } from '../api/_lib.js';
import { extractFinishRacesFromSchedules } from '../api/_simracerhub-schedule-results.js';

const settings = await getSettings();
const schedHtml = await fetchHtml(settings.scheduleUrl);
const ids = [...schedHtml.matchAll(/schedule_id=(\d+)/g)].map((m) => m[1]);
const latestScheduleId = [...new Set(ids)].at(-1);

const data = await fetch(
  `https://www.simracerhub.com/scoring/get_standings.php?season_id=${settings.seasonId || '27987'}&schedule_id=${latestScheduleId}`,
  { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
).then((r) => r.json());

const finishRaces = extractFinishRacesFromSchedules(data.schedules || {});
console.log('Finish races from schedules API:\n');
for (const race of finishRaces) {
  const justin = race.finishes['30961'];
  const carroll = race.finishes['39765'];
  console.log(
    `key=${race.scheduleKey} schedule_id=${race.scheduleId} race_id=${race.raceId} winnerId=${race.winnerDriverId} drivers=${race.driverCount} justin=${justin ?? 'DNP'} carroll=${carroll ?? 'DNP'}`
  );
}

console.log('\n--- Rockingham schedule_id 346491 in schedules object ---');
for (const [key, sched] of Object.entries(data.schedules || {})) {
  if (String(sched.schedule_id) === '346491') {
    const official = Object.entries(sched.drivers || {}).find(([bucketKey, bucket]) => {
      const sample = Object.values(bucket)[0];
      return sample?.session === 'RACE';
    });
    const justin = official ? official[1]['30961'] : null;
    console.log({ scheduleKey: key, schedule_id: sched.schedule_id, race_date: sched.race_date, justinFinish: justin?.finish_pos ?? null, bucketKey: official?.[0] });
  }
}
