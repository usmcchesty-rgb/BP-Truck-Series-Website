import { getSettings, fetchHtml } from '../api/_lib.js';

function flattenScheduleFinishes(schedule) {
  const finishes = {};
  for (const bucket of Object.values(schedule?.drivers || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [driverId, result] of Object.entries(bucket)) {
      if (!result || typeof result !== 'object') continue;
      if (result.finish_pos == null && result.finish == null) continue;
      if (result.driver_id && String(result.driver_id) !== String(driverId)) continue;
      const finish = Number(result.finish_pos ?? result.finish);
      if (!Number.isFinite(finish) || finish < 1) continue;
      finishes[String(driverId)] = finish;
    }
  }
  return finishes;
}

function extractSessionFinishes(schedule) {
  const sessions = [];
  for (const [bucketKey, bucket] of Object.entries(schedule?.drivers || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    const first = Object.values(bucket).find((r) => r && typeof r === 'object' && r.finish_pos != null);
    sessions.push({
      bucketKey,
      session: first?.session ?? null,
      session_num: first?.session_num ?? null,
      count_stats: first?.count_stats ?? null,
      race_id: first?.race_id ?? null,
      driverCount: Object.keys(bucket).length,
      sampleFinish: first ? Number(first.finish_pos) : null,
    });
  }
  return sessions;
}

function pickOfficialSession(schedule) {
  const sessions = [];
  for (const [bucketKey, bucket] of Object.entries(schedule?.drivers || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    const meta = Object.values(bucket).find((r) => r?.finish_pos != null) || null;
    if (!meta) continue;
    sessions.push({ bucketKey, bucket, meta });
  }

  const preferred =
    sessions.find((s) => String(s.meta.session || '').toUpperCase() === 'RACE') ||
    sessions.find((s) => String(s.meta.count_stats || '').toUpperCase() === 'Y') ||
    sessions.sort(
      (a, b) => Number(b.meta.session_num ?? -999) - Number(a.meta.session_num ?? -999)
    )[0];

  return preferred || null;
}

function finishesFromOfficialSession(schedule) {
  const official = pickOfficialSession(schedule);
  if (!official) return {};
  const finishes = {};
  for (const [driverId, result] of Object.entries(official.bucket)) {
    const finish = Number(result?.finish_pos ?? result?.finish);
    if (Number.isFinite(finish) && finish >= 1) finishes[String(driverId)] = finish;
  }
  return finishes;
}

const settings = await getSettings();
const seasonId = settings.seasonId || '27987';
const scheduleHtml = await fetchHtml(settings.scheduleUrl);

const schedHtml = scheduleHtml;
const ids = [...schedHtml.matchAll(/schedule_id=(\d+)/g)].map((m) => m[1]);
const latestScheduleId = [...new Set(ids)].at(-1);

const data = await fetch(
  `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${latestScheduleId}`,
  { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
).then((r) => r.json());

console.log('Snapshot schedule_id:', latestScheduleId);

const sessionTypes = new Set();
const resultFieldNames = new Set();
for (const schedule of Object.values(data.schedules || {})) {
  for (const bucket of Object.values(schedule.drivers || {})) {
    for (const result of Object.values(bucket || {})) {
      if (result?.session) sessionTypes.add(String(result.session));
      Object.keys(result || {}).forEach((k) => resultFieldNames.add(k));
    }
  }
}

console.log('\nSession types found:', [...sessionTypes].sort());
console.log('\nPer-driver result field names:', [...resultFieldNames].sort());

const withDrivers = Object.entries(data.schedules || {}).filter(
  ([, s]) => Object.keys(s?.drivers || {}).length > 0
);
console.log('\nSchedules with driver buckets:', withDrivers.length);

for (const [idx, schedule] of withDrivers.slice(-3)) {
  console.log(`\n=== Schedule index ${idx}, schedule_id ${schedule.schedule_id} ===`);
  console.log('Sessions:', extractSessionFinishes(schedule));
  const naive = flattenScheduleFinishes(schedule);
  const official = finishesFromOfficialSession(schedule);
  console.log('Naive flatten finish count:', Object.keys(naive).length);
  console.log('Official session finish count:', Object.keys(official).length);
  const winnerNaive = Object.entries(naive).find(([, f]) => f === 1)?.[0] ?? null;
  const winnerOfficial = Object.entries(official).find(([, f]) => f === 1)?.[0] ?? null;
  console.log('Winner driverId naive:', winnerNaive, 'official:', winnerOfficial);
}

console.log('\n=== Compare current extractFinishRacesFromSchedules logic ===');
function currentExtract(schedules) {
  const races = [];
  for (const schedule of Object.values(schedules || {})) {
    const finishes = {};
    for (const [driverId, result] of Object.entries(schedule?.drivers || {})) {
      const finishPosition = Number(result?.finish_pos ?? result?.finish);
      if (Number.isFinite(finishPosition) && finishPosition >= 1) {
        finishes[String(driverId)] = finishPosition;
      }
    }
    if (Object.keys(finishes).length) races.push({ finishes, schedule_id: schedule.schedule_id });
  }
  return races;
}

const current = currentExtract(data.schedules);
console.log('Current logic races with finishes:', current.length);
console.log('Sample current finishes counts:', current.slice(-3).map((r) => Object.keys(r.finishes).length));

console.log('\n=== rps season-level fields (NOT per-race) ===');
const sampleRps = Object.values(data.rps || {})[0];
console.log(Object.keys(sampleRps || {}));
console.log('Season totals sample:', {
  wins: sampleRps?.wins,
  t5: sampleRps?.t5,
  t10: sampleRps?.t10,
  led: sampleRps?.led,
  inc: sampleRps?.inc,
  laps: sampleRps?.laps,
});

console.log('\n=== tracks map sample ===');
const trackKeys = Object.keys(data.tracks || {}).slice(0, 3);
for (const key of trackKeys) {
  console.log(key, data.tracks[key]);
}
