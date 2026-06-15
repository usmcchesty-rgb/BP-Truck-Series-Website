import { fetchHtml } from '../api/_lib.js';

const html = await fetchHtml(
  'https://www.simracerhub.com/scoring/driver_stats.php?driver_id=12987&league_id=1783'
);
const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
const raw = m[1];

const entries = [];
for (const match of raw.matchAll(
  /"(\d+)":\{"race_participant_id":"(\d+)"[\s\S]*?"finish_pos":"(\d+)"[\s\S]*?"incidents":"(\d+)"[\s\S]*?"laps_led":"(\d+)"[\s\S]*?"qualify_pos":"([^"]*)"[\s\S]*?"season_id":"(\d+)"[\s\S]*?"series_id":"(\d+)"[\s\S]*?"league_id":"(\d+)"/g
)) {
  entries.push({
    finish: Number(match[3]),
    incidents: Number(match[4]),
    lapsLed: Number(match[5]),
    qualifyPos: match[6],
    seasonId: match[7],
    seriesId: match[8],
    leagueId: match[9],
  });
}

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

console.log('total entries', entries.length);
summarize(entries.filter((r) => r.leagueId === '1783'), 'league 1783 all');
summarize(
  entries.filter((r) =>
    r.leagueId === '1783' &&
    ['13609', '12415', '11068', '9286', '8366', '7066'].includes(r.seriesId)
  ),
  'league 1783 BP truck mapped series 6-11 lineage'
);
summarize(
  entries.filter((r) =>
    r.leagueId === '1783' &&
    ['13609', '12415', '11068'].includes(r.seriesId)
  ),
  'league 1783 explicit BP seasons 9-11 only'
);

// per season breakdown for league 1783 truck
const truckSeries = ['13609', '12415', '11068', '9286', '8366', '7066', '9334', '8703', '8704'];
for (const sid of truckSeries) {
  const rows = entries.filter((r) => r.leagueId === '1783' && r.seriesId === sid);
  if (rows.length) summarize(rows, `series ${sid}`);
}
