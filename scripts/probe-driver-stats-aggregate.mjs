import { fetchHtml } from '../api/_lib.js';

const html = await fetchHtml(
  'https://www.simracerhub.com/scoring/driver_stats.php?driver_id=12987&series_id=13609'
);
const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
const raw = m[1];

// entries without count_stats - each rps item is a race result
const entries = [];
for (const match of raw.matchAll(
  /"(\d+)":\{"race_participant_id":"(\d+)"[\s\S]*?"finish_pos":"(\d+)"[\s\S]*?"incidents":"(\d+)"[\s\S]*?"laps_led":"(\d+)"[\s\S]*?"qualify_pos":"([^"]*)"[\s\S]*?"season_id":"(\d+)"[\s\S]*?"series_id":"(\d+)"/g
)) {
  entries.push({
    finish: Number(match[3]),
    incidents: Number(match[4]),
    lapsLed: Number(match[5]),
    qualifyPos: match[6],
    seasonId: match[7],
    seriesId: match[8],
  });
}
console.log('entries', entries.length);

function summarize(rows, label) {
  const starts = rows.length;
  const wins = rows.filter((r) => r.finish === 1).length;
  const top5 = rows.filter((r) => r.finish >= 1 && r.finish <= 5).length;
  const top10 = rows.filter((r) => r.finish >= 1 && r.finish <= 10).length;
  const poles = rows.filter((r) => Number(r.qualifyPos) === 1).length;
  const lapsLed = rows.reduce((s, r) => s + r.lapsLed, 0);
  const incidents = rows.reduce((s, r) => s + r.incidents, 0);
  const avgFinish = starts ? Number((rows.reduce((s, r) => s + r.finish, 0) / starts).toFixed(2)) : null;
  console.log(label, { starts, wins, top5, top10, poles, lapsLed, incidents, avgFinish });
}

summarize(entries, 'all races in driver_stats series filter');
summarize(entries.filter((r) => r.seriesId === '13609'), 'series 13609');
summarize(
  entries.filter((r) =>
    ['13609', '12415', '11068', '9286', '8366', '7066', '4431', '9334', '8703', '8704'].includes(
      r.seriesId
    )
  ),
  'truck lineage series ids'
);

// look for summary keys in props outside rps
const beforeRps = raw.slice(0, raw.indexOf('rps:'));
console.log('before rps', beforeRps);

const afterRpsIdx = raw.lastIndexOf('},"drivers"');
console.log('around drivers', raw.slice(afterRpsIdx, afterRpsIdx + 500));

for (const key of ['drivers:', 'seasons:', 'stats:', 'totals:', 'summary:', 'ds:', 'career:']) {
  const idx = raw.indexOf(key);
  if (idx >= 0) console.log('found', key, raw.slice(idx, idx + 300));
}
