import { fetchHtml } from '../api/_lib.js';
import { writeFileSync } from 'fs';

const html = await fetchHtml(
  'https://www.simracerhub.com/scoring/driver_stats.php?driver_id=12987&league_id=1783'
);

// Search for aggregate stat patterns matching 167, 17, 67, 100, 9.8
for (const needle of ['167', '17', '67', '100', '9.8', '2721', '1163', '25']) {
  const idx = html.indexOf(needle);
  if (idx >= 0) {
    console.log(`found ${needle} at`, idx, html.slice(Math.max(0, idx - 80), idx + 80).replace(/\s+/g, ' '));
  }
}

// Look for summary/totals objects in props
const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
if (m) {
  const raw = m[1];
  for (const key of [
    'totals',
    'summary',
    'stats',
    'career',
    'aggregate',
    'driver_stats',
    'ds:',
    'total_',
    'starts',
    'avg_finish',
    'avgfinish',
  ]) {
    const re = new RegExp(`${key}[^,]{0,120}`, 'gi');
    const hits = [...raw.matchAll(re)].slice(0, 5);
    if (hits.length) console.log('\nkey', key, hits.map((h) => h[0]));
  }

  // tail of props after rps closes
  const rpsEnd = raw.lastIndexOf('},"seasons"');
  if (rpsEnd > 0) {
    console.log('\naround seasons', raw.slice(rpsEnd, rpsEnd + 400));
  }

  writeFileSync('scripts/driver-stats-props-tail2.txt', raw.slice(-8000));
  console.log('\nwrote tail, len', raw.length);
}

// visible HTML table text
const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '\n');
const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
console.log('\nvisible lines sample:', lines.filter((l) => /\d/.test(l)).slice(0, 40));
