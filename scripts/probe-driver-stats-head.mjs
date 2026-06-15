import { fetchHtml } from '../api/_lib.js';
import { writeFileSync } from 'fs';

const html = await fetchHtml(
  'https://www.simracerhub.com/scoring/driver_stats.php?driver_id=12987&series_id=13609'
);
const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
writeFileSync('scripts/driver-stats-props-snippet.txt', m?.[1]?.slice(0, 5000) || 'none');
writeFileSync('scripts/driver-stats-props-tail.txt', m?.[1]?.slice(-3000) || 'none');
console.log('len', m?.[1]?.length);
// find keys at top level (before rps huge blob)
const head = m?.[1]?.slice(0, 800) || '';
console.log(head);
