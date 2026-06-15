import { fetchHtml } from '../api/_lib.js';
import { writeFileSync } from 'fs';

const html = await fetchHtml(
  'https://www.simracerhub.com/scoring/driver_stats.php?driver_id=12987&league_id=1783'
);
const m = html.match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
const raw = m[1];

// find structure after rps - look for },something:
const idx = raw.indexOf('},"drivers"');
console.log('drivers idx', idx);
if (idx < 0) {
  // try other keys after rps
  const rpsStart = raw.indexOf('rps:');
  let depth = 0;
  let rpsEnd = -1;
  for (let i = rpsStart + 4; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    if (raw[i] === '}') {
      depth--;
      if (depth === 0) {
        rpsEnd = i;
        break;
      }
    }
  }
  console.log('rps end', rpsEnd, raw.slice(rpsEnd, rpsEnd + 500));
}

// Parse full entry objects with more fields
const entries = [];
for (const match of raw.matchAll(
  /"(\d+)":\((\{"race_participant_id":"\d+"[\s\S]*?\})\)(?=,"|\})/g
)) {
  // skip - too hard
}

// simpler: extract each race block
const blocks = [...raw.matchAll(/"(\d+)":\{"race_participant_id":"(\d+)"([\s\S]*?)\}(?=,"|\})/g)];
console.log('blocks', blocks.length);

function parseBlock(body) {
  const get = (key) => body.match(new RegExp(`"${key}":"([^"]*)"`))?.[1];
  const getNum = (key) => Number(get(key));
  return {
    finish: getNum('finish_pos'),
    incidents: getNum('incidents'),
    lapsLed: getNum('laps_led'),
    qualifyPos: get('qualify_pos'),
    seasonId: get('season_id'),
    seriesId: get('series_id'),
    leagueId: get('league_id'),
    provisional: get('provisional'),
    status: get('status'),
    raceId: get('race_id'),
  };
}

const parsed = blocks.map((b) => parseBlock(b[3])).filter((e) => e.finish > 0);
console.log('parsed', parsed.length);

function agg(rows, label) {
  const starts = rows.length;
  if (!starts) return console.log(label, 'empty');
  console.log(label, {
    starts,
    wins: rows.filter((r) => r.finish === 1).length,
    top5: rows.filter((r) => r.finish <= 5).length,
    top10: rows.filter((r) => r.finish <= 10).length,
    poles: rows.filter((r) => Number(r.qualifyPos) === 1).length,
    lapsLed: rows.reduce((s, r) => s + r.lapsLed, 0),
    incidents: rows.reduce((s, r) => s + r.incidents, 0),
    avg: Number((rows.reduce((s, r) => s + r.finish, 0) / starts).toFixed(1)),
  });
}

agg(parsed, 'all');
agg(parsed.filter((r) => r.provisional !== 'Y'), 'non-provisional');
agg(parsed.filter((r) => r.leagueId === '1783'), 'league 1783');
agg(parsed.filter((r) => r.leagueId !== '1783'), 'not 1783');

// unique race ids
const byRace = new Map();
for (const e of parsed) {
  if (!byRace.has(e.raceId)) byRace.set(e.raceId, e);
}
agg([...byRace.values()], 'unique race_id');

// league 1783 unique races
const byRace1783 = new Map();
for (const e of parsed.filter((r) => r.leagueId === '1783')) {
  if (!byRace1783.has(e.raceId)) byRace1783.set(e.raceId, e);
}
agg([...byRace1783.values()], 'unique race league 1783');

// seasons in not-1783
const seasons = [...new Set(parsed.filter((r) => r.leagueId !== '1783').map((r) => r.seasonId))];
console.log('non-1783 season count', seasons.length, seasons.slice(0, 20));

writeFileSync('scripts/arthur-blocks-count.txt', String(blocks.length));
