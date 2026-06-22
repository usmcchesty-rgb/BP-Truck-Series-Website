import { fetchHtml, getDriverProfiles, getSettings } from '../api/_lib.js';
import { parseScheduleRacesFromHtml } from '../api/_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getRecentPointsRaceResults,
} from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import {
  buildDriverLookup,
  fetchStandingsRows,
} from '../api/power-rankings-generate.js';
import {
  alignAllCompletedPointsRaces,
  buildDriverRaceResultsByDriver,
} from '../api/_fantasy-track-history.js';
import {
  buildFantasyDriverSalaries,
  summarizeFantasySlateMeta,
} from '../api/_fantasy-salary-scoring.js';

const SLATE_MAX_STANDINGS_POSITION = 30;
const raceNumber = 14;

const settings = await getSettings();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
const targetRace = scheduleRaces.find(
  (race) => !race.nonPoints && race.officialPointsRaceNumber === raceNumber
);

if (!targetRace) {
  throw new Error(`Race ${raceNumber} not found on schedule.`);
}

const raceDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { now: new Date(), settings });
const standingsResult = await fetchStandingsRows(settings, raceDebug.standingsScheduleId);
const standings = standingsResult.rows.filter(
  (row) =>
    Number(row.races) > 0 &&
    Number(row.position) >= 1 &&
    Number(row.position) <= SLATE_MAX_STANDINGS_POSITION
);

const profiles = await getDriverProfiles();
const driverLookup = buildDriverLookup(standings, profiles);
const alignedRaces = getAlignedRaceFinishes(
  scheduleRaces,
  raceNumber,
  standingsResult.schedules,
  driverLookup
);

const recentResults = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3).map((race) => ({
  raceNumber: race.officialPointsRaceNumber,
  scheduleRow: race.scheduleRow,
  date: race.date,
  track: race.track,
  winner: race.winner,
}));

const factualGrounding = buildFactualGroundingContext({
  standings,
  scheduleRaces,
  raceNumber,
  schedules: standingsResult.schedules,
  driverLookup,
  recentResults,
  manualRaceNotes: '',
  transcriptSummary: '',
  seasonCatalog: null,
});

const allAligned = alignAllCompletedPointsRaces(
  scheduleRaces,
  standingsResult.schedules,
  driverLookup,
  { now: new Date(), settings }
);
const driverIds = standings.map((row) => String(row.driverId));
const driverRaceResultsByDriver = buildDriverRaceResultsByDriver(
  allAligned,
  standingsResult.schedules,
  driverIds
);

const drivers = buildFantasyDriverSalaries({
  standings,
  groundingByDriver: factualGrounding.drivers,
  alignedRaces,
  schedules: standingsResult.schedules,
  upcomingTrack: targetRace.track || 'TBD',
  driverRaceResultsByDriver,
  priorSalariesByDriver: new Map(),
  priorTierScoresByDriver: new Map(),
}).sort((a, b) => b.fantasyTierScore - a.fantasyTierScore);

const meta = summarizeFantasySlateMeta(drivers);

const top10 = drivers.slice(0, 10).map((d) => ({
  driver: d.driverName,
  tier: d.computedTier,
  score: d.fantasyTierScore,
  base: d.baseSalaryInBand,
  generated: d.generatedSalary,
  final: d.finalSalary,
  band: d.salaryBand,
  bandEnforced: d.bandEnforcement?.applied ?? false,
}));

console.log(JSON.stringify({
  track: targetRace.track,
  tierCounts: meta.tierCounts,
  scoreStats: meta.scoreStats,
  salaryBandViolations: meta.salaryBandViolations,
  top10,
  dalton: drivers.find((d) => /kilroe/i.test(d.driverName)),
}, null, 2));
