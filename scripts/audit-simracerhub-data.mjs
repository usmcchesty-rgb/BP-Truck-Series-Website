import { getSettings } from '../api/_lib.js';

const settings = await getSettings();
const seasonId = settings.seasonId || '27987';

const schedHtml = await fetch(settings.scheduleUrl, {
  headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
}).then((r) => r.text());

const ids = [...schedHtml.matchAll(/schedule_id=(\d+)/g)].map((m) => m[1]);
const unique = [...new Set(ids)];
const latestScheduleId = unique[unique.length - 1];
console.log('Latest schedule_id from page:', latestScheduleId, 'total ids:', unique.length);

const url = `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${latestScheduleId}`;
const data = await fetch(url, { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }).then((r) =>
  r.json()
);

console.log('Top-level keys:', Object.keys(data));
console.log('lss keys:', data.lss ? Object.keys(data.lss) : null);
console.log('schedules count:', Object.keys(data.schedules || {}).length);

const scheduleKeys = Object.keys(data.schedules || {});

for (const key of scheduleKeys) {
  const s = data.schedules[key];
  const driverCount = Object.keys(s?.drivers || {}).length;
  if (driverCount > 0) {
    console.log('\n--- Schedule with drivers', key, '---');
    console.log('schedule meta keys:', Object.keys(s).filter((k) => k !== 'drivers'));
    console.log('event_name:', s.event_name, 'schedule_id:', s.schedule_id, 'race_date:', s.race_date);
    console.log('driver count:', driverCount);
    const driverIds = Object.keys(s.drivers);
    const sample = s.drivers[driverIds[0]];
    console.log('sample driver result keys:', Object.keys(sample));
    console.log('sample driver result:', sample);
    break;
  }
}

const withDrivers = scheduleKeys.filter((k) => Object.keys(data.schedules[k]?.drivers || {}).length > 0);
console.log('\nSchedules with drivers:', withDrivers.length, 'of', scheduleKeys.length);
console.log('Last 3 with drivers:', withDrivers.slice(-3));

for (const key of withDrivers.slice(-3)) {
  const s = data.schedules[key];
  console.log('\n--- Schedule', key, '(schedule_id', s.schedule_id, ') ---');
  console.log('schedule meta keys:', Object.keys(s).filter((k) => k !== 'drivers'));
  const driverIds = Object.keys(s.drivers || {});
  console.log('driver count:', driverIds.length);
  const sample = s.drivers[driverIds[0]];
  console.log('sample driver result keys:', sample ? Object.keys(sample) : null);
  console.log('sample driver result:', sample);
}

console.log('\nrace_map sample keys:', Object.keys(data.race_map || {}).slice(0, 5));
if (data.race_map) {
  const rmKey = Object.keys(data.race_map)[0];
  console.log('race_map entry sample:', rmKey, data.race_map[rmKey]);
}

const rpsSample = Object.values(data.rps || {})[0];
console.log('\nrps sample keys:', rpsSample ? Object.keys(rpsSample) : null);
console.log('rps sample:', rpsSample);

const fieldSet = new Set();
const fieldSamples = {};
for (const s of Object.values(data.schedules || {})) {
  for (const d of Object.values(s.drivers || {})) {
    for (const [k, v] of Object.entries(d)) {
      fieldSet.add(k);
      if (fieldSamples[k] == null && v != null && v !== '') fieldSamples[k] = v;
    }
  }
}
console.log('\nAll driver result fields across schedules:', [...fieldSet].sort());
console.log('Field samples:', fieldSamples);

const rpsFields = new Set();
for (const r of Object.values(data.rps || {})) Object.keys(r).forEach((k) => rpsFields.add(k));
console.log('\nAll rps fields:', [...rpsFields].sort());
