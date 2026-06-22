import { fetchHtml, getDriverProfiles, getSettings } from '../api/_lib.js';
import { parseScheduleRacesFromHtml } from '../api/_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
} from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import {
  buildDriverLookup,
  fetchStandingsRows,
} from '../api/power-rankings-generate.js';
import {
  alignAllCompletedPointsRaces,
  buildCurrentSeasonTrackHistoryForDriver,
  buildCareerTrackHistoryForDriver,
  buildDriverCareerRaceResultsByDriver,
  buildDriverRaceResultsByDriver,
} from '../api/_fantasy-track-history.js';
import {
  buildFantasyDriverSalaries,
  FANTASY_MODEL_VERSION,
  summarizeFantasySlateMeta,
} from '../api/_fantasy-salary-scoring.js';
import { buildTrackHistoryRankingAuditRows, buildProvenTrackHistoryRankingAuditRows } from '../api/_fantasy-tier-scoring.js';

const SLATE_MAX_STANDINGS_POSITION = 30;
const raceNumber = 14;
const upcomingTrack = 'Talladega Superspeedway';

const settings = await getSettings();
const now = new Date();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
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
const allAligned = alignAllCompletedPointsRaces(
  scheduleRaces,
  standingsResult.schedules,
  driverLookup,
  { now, settings }
);
const driverIds = standings.map((row) => String(row.driverId));
const seasonRowsByDriver = buildDriverRaceResultsByDriver(
  allAligned,
  standingsResult.schedules,
  driverIds
);
const leagueId = String(standingsResult.lss?.league_id || settings.leagueId || '1783');
const careerRowsByDriver = await buildDriverCareerRaceResultsByDriver(driverIds, leagueId);

  const phase1Drivers = buildFantasyDriverSalaries({
    standings,
    groundingByDriver: buildFactualGroundingContext({
      standings,
      scheduleRaces,
      raceNumber,
      schedules: standingsResult.schedules,
      driverLookup,
      recentResults: [],
      manualRaceNotes: '',
      transcriptSummary: '',
      seasonCatalog: null,
    }).drivers,
    alignedRaces,
    schedules: standingsResult.schedules,
    upcomingTrack,
    driverRaceResultsByDriver: seasonRowsByDriver,
    trackHistoryMode: 'current_season',
    slateRaceNumber: raceNumber,
    scheduleRaces,
    allAlignedRaces: allAligned,
    settings,
    now,
  }).sort((a, b) => b.fantasyTierScore - a.fantasyTierScore);

  const phase2Drivers = buildFantasyDriverSalaries({
    standings,
    groundingByDriver: buildFactualGroundingContext({
      standings,
      scheduleRaces,
      raceNumber,
      schedules: standingsResult.schedules,
      driverLookup,
      recentResults: [],
      manualRaceNotes: '',
      transcriptSummary: '',
      seasonCatalog: null,
    }).drivers,
    alignedRaces,
    schedules: standingsResult.schedules,
    upcomingTrack,
    driverRaceResultsByDriver: seasonRowsByDriver,
    driverCareerRaceRowsByDriver: careerRowsByDriver,
    trackHistoryMode: 'career',
    slateRaceNumber: raceNumber,
    scheduleRaces,
    allAlignedRaces: allAligned,
    settings,
    now,
  }).sort((a, b) => b.fantasyTierScore - a.fantasyTierScore);

function summarizeTrackHistory(driver, phase) {
  const th =
    phase === 'phase1'
      ? buildCurrentSeasonTrackHistoryForDriver(
          seasonRowsByDriver.get(String(driver.driverId)) || [],
          upcomingTrack,
          { alignedRaces: allAligned, driverId: driver.driverId }
        )
      : buildCareerTrackHistoryForDriver(
          careerRowsByDriver.get(String(driver.driverId)) || [],
          upcomingTrack
        );
  const breakdown = driver.scoreBreakdown?.careerTrackHistory;

  return {
    name: driver.driverName,
    tier: driver.computedTier,
    fantasyScore: driver.fantasyTierScore,
    salary: driver.finalSalary ?? driver.generatedSalary,
    historyScope: th?.historyScope ?? th?.scoringScope ?? null,
    exactTrackStarts: th?.careerExactTrackStarts ?? th?.exactTrackStarts ?? th?.exactStarts ?? 0,
    trackTypeStarts:
      th?.careerTrackTypeStarts ?? th?.similarTrackStarts ?? th?.similarStarts ?? 0,
    careerTrackHistoryRaw:
      th?.careerTrackHistoryRaw ?? th?.actualTrackScore ?? breakdown?.rawScore ?? null,
    careerTrackHistoryNormalized:
      th?.careerTrackHistoryNormalized ?? th?.score ?? breakdown?.normalizedScore ?? null,
    dataSource: th?.dataSource ?? (phase === 'phase1' ? 'current season' : 'career history'),
  };
}

const top15Phase2 = phase2Drivers.slice(0, 15).map((driver) => {
  const phase2 = summarizeTrackHistory(driver, 'phase2');
  const phase1Driver = phase1Drivers.find((row) => row.driverId === driver.driverId);
  const phase1 = phase1Driver ? summarizeTrackHistory(phase1Driver, 'phase1') : null;
  const trackHistoryDelta =
    phase1 && phase2.careerTrackHistoryNormalized != null && phase1.careerTrackHistoryNormalized != null
      ? Number((phase2.careerTrackHistoryNormalized - phase1.careerTrackHistoryNormalized).toFixed(2))
      : null;
  const fantasyScoreDelta =
    phase1 && Number.isFinite(phase1.fantasyScore) && Number.isFinite(phase2.fantasyScore)
      ? Number((phase2.fantasyScore - phase1.fantasyScore).toFixed(2))
      : null;

  return {
    ...phase2,
    phase1,
    trackHistoryDelta,
    fantasyScoreDelta,
  };
});

const biggestTrackHistoryMovers = [...top15Phase2]
  .sort(
    (a, b) =>
      Math.abs(b.trackHistoryDelta ?? 0) - Math.abs(a.trackHistoryDelta ?? 0)
  )
  .slice(0, 8)
  .map((row) => ({
    name: row.name,
    trackHistoryDelta: row.trackHistoryDelta,
    fantasyScoreDelta: row.fantasyScoreDelta,
    phase1Scope: row.phase1?.historyScope,
    phase2Scope: row.historyScope,
    phase1ExactStarts: row.phase1?.exactTrackStarts,
    phase2ExactStarts: row.exactTrackStarts,
    phase1TrackTypeStarts: row.phase1?.trackTypeStarts,
    phase2TrackTypeStarts: row.trackTypeStarts,
    phase1TrackNorm: row.phase1?.careerTrackHistoryNormalized,
    phase2TrackNorm: row.careerTrackHistoryNormalized,
  }));

const watched = ['Dalton Kilroe', 'Ty Marasco', 'Taylor Butcher-Benjamin', 'Chris Carroll3'].map(
  (name) => {
    const phase2 = phase2Drivers.find((row) => row.driverName === name);
    const phase1 = phase1Drivers.find((row) => row.driverName === name);
    return {
      name,
      phase1: phase1 ? summarizeTrackHistory(phase1, 'phase1') : null,
      phase2: phase2 ? summarizeTrackHistory(phase2, 'phase2') : null,
    };
  }
);

console.log(
  JSON.stringify(
    {
      phase: 'fantasy-career-track-history-race14',
      modelVersion: FANTASY_MODEL_VERSION,
      upcomingTrack,
      leagueId,
      trackHistoryRanking: buildTrackHistoryRankingAuditRows(phase2Drivers),
      provenTrackHistoryRanking: buildProvenTrackHistoryRankingAuditRows(phase2Drivers),
      topProvenTrackHistoryDrivers: summarizeFantasySlateMeta(phase2Drivers).topProvenTrackHistoryDrivers,
      topTrackHistoryDrivers: summarizeFantasySlateMeta(phase2Drivers).topTrackHistoryDrivers,
      top15Phase2,
      biggestTrackHistoryMovers,
      watched,
    },
    null,
    2
  )
);
