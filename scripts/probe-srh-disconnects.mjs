import { fetchHtml } from '../api/_lib.js';

async function probeStatuses(driverId, label) {
  const url = `https://www.simracerhub.com/scoring/driver_stats.php?driver_id=${driverId}`;
  const html = await fetchHtml(url);
  const statuses = new Map();
  let invalidFinish = 0;
  for (const m of html.matchAll(/"(\d+)":\{"race_participant_id":"(\d+)"([\s\S]*?)\}(?=,"|\})/g)) {
    const body = m[3];
    const status = body.match(/"status":"([^"]*)"/)?.[1] || '(missing)';
    const finish = body.match(/"finish_pos":"([^"]*)"/)?.[1];
    if (!finish || Number(finish) < 1) invalidFinish += 1;
    statuses.set(status, (statuses.get(status) || 0) + 1);
  }
  console.log(`=== ${label} (${driverId}) ===`);
  console.log([...statuses.entries()].sort((a, b) => b[1] - a[1]));
  console.log('invalid finish_pos count:', invalidFinish);
}

await probeStatuses('30961', 'Justin Levine');
await probeStatuses('39765', 'Chris Carroll');
