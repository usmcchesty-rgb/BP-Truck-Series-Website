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
  scoreTrackHistoryStatsLegacy,
  regressTrackHistoryScoreForSampleSize,
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

const TRACK_TYPE_CAREER_MIN = 5;
const TRACK_HISTORY_NEUTRAL_SCORE = 50;

function legacyCareerTrackNormalized(th) {
  const legacyScored = scoreTrackHistoryStatsLegacy(th.summary);
  const raw = legacyScored.score;

  if (th.historyScope === 'blended_neutral') {
    const size = th.careerTrackTypeStarts ?? th.similarStarts ?? 0;
    if (size >= TRACK_TYPE_CAREER_MIN) return raw;
    const neutralWeight = (TRACK_TYPE_CAREER_MIN - size) / TRACK_TYPE_CAREER_MIN;
    return Number(
      (TRACK_HISTORY_NEUTRAL_SCORE * neutralWeight + raw * (1 - neutralWeight)).toFixed(2)
    );
  }

  return regressTrackHistoryScoreForSampleSize(raw, th.summary?.starts ?? 0).regressedScore;
}

function summarizeExperience(driver) {
  const details = driver?.scoreBreakdown?.careerTrackHistory?.details?.scoreDetails || {};
  return {
    experienceScore: details.experienceScore ?? null,
    experienceStarts: details.experienceStarts ?? null,
    experienceContribution: details.experienceContribution ?? null,
  };
}

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
    experience: summarizeExperience(driver),
    dataSource: th?.dataSource ?? (phase === 'phase1' ? 'current season' : 'career history'),
  };
}

function summarizeBeforeAfter(name) {
  const driver = phase2Drivers.find((row) => row.driverName === name);
  if (!driver) return { name, found: false };

  const careerRows = careerRowsByDriver.get(String(driver.driverId)) || [];
  const th = buildCareerTrackHistoryForDriver(careerRows, upcomingTrack);
  const beforeNormalized = legacyCareerTrackNormalized(th);
  const afterNormalized =
    driver.scoreBreakdown?.careerTrackHistory?.details?.careerTrackHistoryNormalized ??
    driver.scoreBreakdown?.careerTrackHistory?.normalizedScore ??
    th.careerTrackHistoryNormalized;

  return {
    name,
    tier: driver.computedTier,
    fantasyScore: driver.fantasyTierScore,
    historyScope: th.historyScope,
    exactStarts: th.careerExactTrackStarts ?? th.exactStarts ?? 0,
    trackTypeStarts: th.careerTrackTypeStarts ?? th.similarStarts ?? 0,
    beforeTrackScoreRaw: scoreTrackHistoryStatsLegacy(th.summary).score,
    beforeTrackScoreNormalized: beforeNormalized,
    afterTrackScoreRaw:
      driver.scoreBreakdown?.careerTrackHistory?.details?.careerTrackHistoryRaw ??
      th.careerTrackHistoryRaw,
    afterTrackScoreNormalized: afterNormalized,
    trackScoreDelta: Number((afterNormalized - beforeNormalized).toFixed(2)),
    experience: summarizeExperience(driver),
    provenTrackHistoryRank:
      driver.scoreBreakdown?.careerTrackHistory?.details?.provenTrackHistoryRank ??
      driver.trackHistorySummary?.provenTrackHistoryRank ??
      null,
  };
}

function tierCounts(drivers) {
  return drivers.reduce((acc, driver) => {
    const tier = driver.computedTier || 'Unknown';
    acc[tier] = (acc[tier] || 0) + 1;
    return acc;
  }, {});
}

const experienceBeforeAfter = [
  'Dalton Kilroe',
  'Chris Carroll3',
  'Taylor Butcher-Benjamin',
  'Ty Marasco',
].map(summarizeBeforeAfter);

const top10ProvenTrackHistory = buildProvenTrackHistoryRankingAuditRows(phase2Drivers).slice(0, 10);

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
      top10ProvenTrackHistory,
      experienceBeforeAfter,
      tierDistribution: tierCounts(phase2Drivers),
      topTierDrivers: phase2Drivers
        .filter((driver) => driver.computedTier === 'Top Tier')
        .map((driver) => ({ name: driver.driverName, fantasyScore: driver.fantasyTierScore })),
      eliteDrivers: phase2Drivers
        .filter((driver) => driver.computedTier === 'Elite')
        .map((driver) => ({ name: driver.driverName, fantasyScore: driver.fantasyTierScore })),
      top15Phase2,
      biggestTrackHistoryMovers,
      watched,
    },
    null,
    2
  )
);
