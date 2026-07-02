import { fetchHtml } from '../api/_lib.js';
import {
  aggregateLeagueCareerStatsFromRaceEntries,
  parseDriverStatsRaceEntries,
} from '../api/_driver-career-history.js';

const html = await fetchHtml(
  'https://www.simracerhub.com/scoring/driver_stats.php?driver_id=30961'
);
const entries = parseDriverStatsRaceEntries(html);
const stats = aggregateLeagueCareerStatsFromRaceEntries(entries);
const sample = entries.find((entry) => entry.isDisconnected);

console.log(JSON.stringify(stats, null, 2));
console.log(
  'sample disconnected:',
  sample
    ? {
        raceId: sample.raceId,
        finish: sample.finish,
        status: sample.status,
        incidents: sample.incidents,
      }
    : null
);
