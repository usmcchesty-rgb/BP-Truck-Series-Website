import { fetchHtml } from '../api/_lib.js';
import { discoverSimRacerHubSeasonCatalog } from '../api/_driver-career-history.js';

function parseEntries(html) {
  const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
  if (!m) return [];
  const entries = [];
  for (const match of m[1].matchAll(
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
  return entries;
}

function agg(rows, label) {
  const starts = rows.length;
  const wins = rows.filter((r) => r.finish === 1).length;
  const top5 = rows.filter((r) => r.finish >= 1 && r.finish <= 5).length;
  const top10 = rows.filter((r) => r.finish >= 1 && r.finish <= 10).length;
  const poles = rows.filter((r) => Number(r.qualifyPos) === 1).length;
  const lapsLed = rows.reduce((s, r) => s + r.lapsLed, 0);
  const incidents = rows.reduce((s, r) => s + r.incidents, 0);
  const avg = starts ? Number((rows.reduce((s, r) => s + r.finish, 0) / starts).toFixed(1)) : null;
  console.log(label, { starts, wins, top5, top10, poles, lapsLed, incidents, avg });
}

const html = await fetchHtml(
  'https://www.simracerhub.com/scoring/driver_stats.php?driver_id=12987&league_id=1783'
);
const entries = parseEntries(html);
console.log('total parsed', entries.length);

agg(entries, 'all parsed');
agg(entries.filter((r) => r.leagueId === '1783'), 'league 1783');
agg(entries.filter((r) => r.leagueId !== '1783'), 'not league 1783');

const catalog = await discoverSimRacerHubSeasonCatalog({ seasonId: '27987' }, {
  season_id: 27987,
  league_id: 1783,
  series_id: 13609,
});

const includedSeasonIds = new Set(
  catalog.seasons.filter((s) => !s.excludeFromCareer).map((s) => String(s.seasonId))
);
const excludedSeasonIds = new Set(
  catalog.seasons.filter((s) => s.excludeFromCareer).map((s) => String(s.seasonId))
);

agg(
  entries.filter((r) => includedSeasonIds.has(r.seasonId)),
  'catalog non-excluded seasons'
);
agg(
  entries.filter((r) => includedSeasonIds.has(r.seasonId) && r.leagueId === '1783'),
  'catalog seasons + league 1783'
);

// search props head for precomputed totals
const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
const head = m[1].slice(0, 2000);
console.log('\nprops head', head);

// look for dss or driver summary object
for (const pat of ['dss:', 'dss=', 'driver_summary', 'career_stats', 'agg_stats', 'total_starts']) {
  const i = m[1].indexOf(pat);
  if (i >= 0) console.log('found', pat, m[1].slice(i, i + 250));
}
