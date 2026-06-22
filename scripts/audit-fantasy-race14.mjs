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
  buildDriverCareerRaceResultsByDriver,
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
const leagueId = String(standingsResult.lss?.league_id || settings.leagueId || '1783');
const driverCareerRaceRowsByDriver = await buildDriverCareerRaceResultsByDriver(
  driverIds,
  leagueId
);

const drivers = buildFantasyDriverSalaries({
  standings,
  groundingByDriver: factualGrounding.drivers,
  alignedRaces,
  schedules: standingsResult.schedules,
  upcomingTrack: targetRace.track || 'TBD',
  driverRaceResultsByDriver,
  driverCareerRaceRowsByDriver,
  priorSalariesByDriver: new Map(),
  priorTierScoresByDriver: new Map(),
  slateRaceNumber: raceNumber,
  scheduleRaces,
  allAlignedRaces: allAligned,
  settings,
  now,
}).sort((a, b) => b.fantasyTierScore - a.fantasyTierScore);

const meta = summarizeFantasySlateMeta(drivers);

function driverBreakdown(d) {
  if (!d) return null;
  const bd = d.scoreBreakdown || {};
  const components = {};
  for (const key of [
    'seasonPerformance',
    'recentForm',
    'careerTrackHistory',
    'raceImpact',
    'momentum',
    'reliability',
  ]) {
    const c = bd[key];
    components[key] = c
      ? {
          raw: c.rawScore,
          norm: c.normalizedScore,
          weight: c.weight,
        }
      : null;
  }
  return {
    rank: drivers.findIndex((x) => x.driverId === d.driverId) + 1,
    driverName: d.driverName,
    pointsPosition: d.pointsPosition,
    fantasyTierScore: d.fantasyTierScore,
    fantasyTierScoreRaw: d.fantasyTierScoreRaw,
    computedTier: d.computedTier,
    uncappedTier: d.uncappedTier || null,
    generatedSalary: d.generatedSalary,
    topTierEligible: d.topTierEligible,
    topTierEligibleReasons: d.topTierEligibleReasons || [],
    eliteEligible: d.eliteEligible,
    eliteEligibleReasons: d.eliteEligibleReasons || [],
    fantasyScoreRank: d.fantasyScoreRank,
    recentDataSparse: d.recentDataSparse,
    tierCap: d.tierCap,
    tierRecovery: d.tierRecovery || null,
    components,
    attendance: d.attendanceContext,
  };
}

const watchIds = new Set(['39628', '39623', '36764']);
const watchNames = [/marasco/i, /kilroe/i, /kleinschmidt/i, /carroll/i, /lawson/i];

console.log(
  JSON.stringify(
    {
      phase: 'fantasy-v2.4.0-career-track-history',
      modelVersion: FANTASY_MODEL_VERSION,
      track: targetRace.track,
      recentRaceContext: meta.tierRecovery,
      meta,
      topTierDrivers: drivers
        .filter((d) => d.computedTier === 'Top Tier')
        .map((d) => driverBreakdown(d)),
      eliteDrivers: drivers
        .filter((d) => d.computedTier === 'Elite')
        .map((d) => ({
          driverName: d.driverName,
          pointsPosition: d.pointsPosition,
          score: d.fantasyTierScore,
          salary: d.generatedSalary,
          topTierEligible: d.topTierEligible,
        })),
      watchedBreakdowns: drivers
        .filter(
          (d) => watchIds.has(d.driverId) || watchNames.some((re) => re.test(d.driverName))
        )
        .map((d) => driverBreakdown(d)),
      topTierEligibility: drivers.map((d) => ({
        driverName: d.driverName,
        pointsPosition: d.pointsPosition,
        score: d.fantasyTierScore,
        tier: d.computedTier,
        topTierEligible: d.topTierEligible,
        topTierEligibleReasons: d.topTierEligibleReasons || [],
        eliteEligible: d.eliteEligible,
      })),
      lowSeasonStartDrivers: drivers
        .filter((d) => {
          const starts = d.attendanceContext?.seasonStarts ?? 0;
          const completed = d.attendanceContext?.completedRacesBeforeSlate ?? 13;
          return starts <= 8 && completed >= 10;
        })
        .map((d) => ({
          driverName: d.driverName,
          seasonStarts: d.attendanceContext?.seasonStarts,
          recentAttendanceRate: d.attendanceContext?.recentAttendanceRate,
          last5: `${d.attendanceContext?.last5Starts}/${d.attendanceContext?.last5WindowSize}`,
          tier: d.computedTier,
          topTierEligible: d.topTierEligible,
          eliteEligible: d.eliteEligible,
          score: d.fantasyTierScore,
          salary: d.generatedSalary,
        })),
      top15Salaries: drivers.slice(0, 15).map((d) => ({
        driver: d.driverName,
        pos: d.pointsPosition,
        tier: d.computedTier,
        score: d.fantasyTierScore,
        salary: d.generatedSalary,
        recentAttendanceRate: d.attendanceContext?.recentAttendanceRate,
        topTierEligible: d.topTierEligible,
        eliteEligible: d.eliteEligible,
        capped: d.tierCap?.applied ?? false,
        recovered: d.tierRecovery?.applied ?? false,
      })),
    },
    null,
    2
  )
);
