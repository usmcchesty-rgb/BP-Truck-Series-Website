import { fetchHtml } from '../api/_lib.js';

async function parseDriverStats(query) {
  const url = `https://www.simracerhub.com/scoring/driver_stats.php?driver_id=12987&${query}`;
  const html = await fetchHtml(url);
  const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
  if (!m) {
    console.log(query, 'no props');
    return;
  }
  const raw = m[1];
  console.log('\n===', query, '===');
  for (const field of [
    'starts',
    'counted',
    'wins',
    'swins',
    'poles',
    't3',
    't5',
    't10',
    'led',
    'inc',
    'avg',
    'career',
    'totals',
    'summary',
  ]) {
    const re = new RegExp(`"${field}"\\s*:\\s*"?(\\d+(?:\\.\\d+)?)"?`, 'gi');
    const hits = [...raw.matchAll(re)].slice(0, 8);
    if (hits.length) console.log(field, hits.map((h) => h[0]));
  }

  const raceCount = (raw.match(/race_participant_id/g) || []).length;
  console.log('race_participant entries in props', raceCount);
}

await parseDriverStats('series_id=13609');
await parseDriverStats('league_id=1783');
await parseDriverStats('season_id=27987');
