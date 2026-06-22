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
  FANTASY_MODEL_VERSION,
  summarizeFantasySlateMeta,
} from '../api/_fantasy-salary-scoring.js';

const SLATE_MAX_STANDINGS_POSITION = 30;
const raceNumber = 14;

const settings = await getSettings();
const now = new Date();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
const targetRace = scheduleRaces.find(
  (race) => !race.nonPoints && race.officialPointsRaceNumber === raceNumber
);

if (!targetRace) {
  throw new Error(`Race ${raceNumber} not found on schedule.`);
}

const raceDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { now, settings });
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
  { now, settings }
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
  slateRaceNumber: raceNumber,
  scheduleRaces,
  settings,
  now,
}).sort((a, b) => b.fantasyTierScore - a.fantasyTierScore);

const meta = summarizeFantasySlateMeta(drivers);

function driverSnapshot(d) {
  if (!d) return null;
  return {
    rank: drivers.findIndex((x) => x.driverId === d.driverId) + 1,
    driverName: d.driverName,
    standingsPosition: standings.find((r) => String(r.driverId) === d.driverId)?.position,
    fantasyTierScore: d.fantasyTierScore,
    computedTier: d.computedTier,
    uncappedTier: d.uncappedTier || null,
    generatedSalary: d.generatedSalary,
    tierCap: d.tierCap,
    tierRecovery: d.tierRecovery || null,
    attendance: d.attendanceContext,
  };
}

const watchNames = [/marasco/i, /kilroe/i, /lawson/i, /carroll/i];

console.log(
  JSON.stringify(
    {
      modelVersion: FANTASY_MODEL_VERSION,
      track: targetRace.track,
      scoreStats: meta.scoreStats,
      tierCounts: meta.tierCounts,
      cappedDrivers: meta.cappedDrivers,
      topTierRecoveryApplied: meta.topTierRecoveryApplied,
      eliteRecoveryApplied: meta.eliteRecoveryApplied,
      tierRecovery: meta.tierRecovery,
      salaryBandViolations: meta.salaryBandViolations,
      top15: drivers.slice(0, 15).map((d) => ({
        driver: d.driverName,
        tier: d.computedTier,
        score: d.fantasyTierScore,
        salary: d.generatedSalary,
        capped: d.tierCap?.applied ?? false,
        recovered: d.tierRecovery?.applied ?? false,
      })),
      watched: drivers
        .filter((d) => watchNames.some((re) => re.test(d.driverName)))
        .map(driverSnapshot),
    },
    null,
    2
  )
);
