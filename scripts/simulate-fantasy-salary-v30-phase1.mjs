/**
 * Historical v2.6 vs v3.0 salary comparison for Phase 1.
 * Run: node scripts/simulate-fantasy-salary-v30-phase1.mjs
 */
import { fetchHtml, getDriverProfiles, getSettings } from '../api/_lib.js';
import { parseScheduleRacesFromHtml } from '../api/_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getRecentPointsRaceResults,
} from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import { buildDriverLookup, fetchStandingsRows } from '../api/power-rankings-generate.js';
import {
  alignAllCompletedPointsRaces,
  buildDriverCareerRaceResultsByDriver,
  buildDriverRaceResultsByDriver,
} from '../api/_fantasy-track-history.js';
import { buildFantasyDriverSalaries } from '../api/_fantasy-salary-scoring.js';
import { enrichFantasySlateDrivers } from '../api/_fantasy-admin-analytics.js';
import { detectSalaryBandViolations } from '../api/_fantasy-tier-scoring.js';

const SLATE_MAX_STANDINGS_POSITION = 30;
const PROFILE_A = 'fantasy-salary-v2.6';
const PROFILE_B = 'fantasy-salary-v3.0';

const settings = await getSettings();
const now = new Date();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
const pointsRaces = scheduleRaces
  .filter((race) => !race.nonPoints && race.officialPointsRaceNumber != null)
  .sort((a, b) => Number(a.officialPointsRaceNumber) - Number(b.officialPointsRaceNumber));

const profiles = await getDriverProfiles();
const leagueId = String(settings.leagueId || '1783');

function findDriver(drivers, pattern) {
  return drivers.find((driver) => pattern.test(String(driver.driverName || ''))) || null;
}

function summarizeProfile(drivers, label) {
  const withPrior = drivers.filter((driver) => Number(driver.previousSalary) > 0);
  const changes = withPrior
    .map((driver) => Number(driver.salaryChange))
    .filter(Number.isFinite);
  const absChanges = changes.map((value) => Math.abs(value));
  const avgAbs =
    absChanges.length ? absChanges.reduce((sum, value) => sum + value, 0) / absChanges.length : 0;
  const risers = [...withPrior].sort(
    (a, b) => Number(b.salaryChange) - Number(a.salaryChange)
  );
  const fallers = [...withPrior].sort(
    (a, b) => Number(a.salaryChange) - Number(b.salaryChange)
  );
  return {
    label,
    driverCount: drivers.length,
    avgAbsChange: Math.round(avgAbs),
    maxRise: risers[0]
      ? {
          driverName: risers[0].driverName,
          salaryChange: risers[0].salaryChange,
          modelSuggestedChange: risers[0].modelSuggestedChange ?? null,
        }
      : null,
    maxFall: fallers[0]
      ? {
          driverName: fallers[0].driverName,
          salaryChange: fallers[0].salaryChange,
        }
      : null,
    capHits: withPrior.filter((driver) => driver.weeklyCapApplied === true).length,
    bandViolations: detectSalaryBandViolations(drivers).length,
  };
}

function buildSlateForRace(raceNumber, priorSalariesByDriver, priorTierScoresByDriver, tierScoreProfile) {
  const targetRace = pointsRaces.find(
    (race) => Number(race.officialPointsRaceNumber) === Number(raceNumber)
  );
  if (!targetRace) return null;

  const raceDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { now, settings });
  return fetchStandingsRows(settings, raceDebug.standingsScheduleId).then(async (standingsResult) => {
    const standings = standingsResult.rows.filter(
      (row) =>
        Number(row.races) > 0 &&
        Number(row.position) >= 1 &&
        Number(row.position) <= SLATE_MAX_STANDINGS_POSITION
    );
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
      priorSalariesByDriver,
      priorTierScoresByDriver,
      slateRaceNumber: raceNumber,
      scheduleRaces,
      allAlignedRaces: allAligned,
      settings,
      now,
      tierScoreProfile,
    });

    const enriched = enrichFantasySlateDrivers(drivers, priorSalariesByDriver);
    return {
      raceNumber,
      track: targetRace.track,
      drivers: enriched,
    };
  });
}

const raceReports = [];
const priorMaps = {
  [PROFILE_A]: { salaries: new Map(), tiers: new Map() },
  [PROFILE_B]: { salaries: new Map(), tiers: new Map() },
};

for (const race of pointsRaces) {
  const raceNumber = Number(race.officialPointsRaceNumber);
  if (raceNumber < 2) continue;

  const slateV26 = await buildSlateForRace(
    raceNumber,
    priorMaps[PROFILE_A].salaries,
    priorMaps[PROFILE_A].tiers,
    PROFILE_A
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const slateV30 = await buildSlateForRace(
    raceNumber,
    priorMaps[PROFILE_B].salaries,
    priorMaps[PROFILE_B].tiers,
    PROFILE_B
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));

  if (!slateV26 || !slateV30) continue;

  const carrollV26 = findDriver(slateV26.drivers, /carroll/i);
  const carrollV30 = findDriver(slateV30.drivers, /carroll/i);
  const arthurV26 = findDriver(slateV26.drivers, /mark arthur/i);
  const arthurV30 = findDriver(slateV30.drivers, /mark arthur/i);

  raceReports.push({
    raceNumber,
    track: slateV26.track,
    v26: summarizeProfile(slateV26.drivers, PROFILE_A),
    v30: summarizeProfile(slateV30.drivers, PROFILE_B),
    carroll: carrollV26 && carrollV30
      ? {
          v26Change: carrollV26.salaryChange,
          v30Change: carrollV30.salaryChange,
          v26Momentum: carrollV26.scoreBreakdown?.momentum?.score,
          v30Momentum: carrollV30.scoreBreakdown?.momentum?.score,
          v26RaceImpact: carrollV26.scoreBreakdown?.raceImpact?.score,
          v30RaceImpact: carrollV30.scoreBreakdown?.raceImpact?.score,
          v30ModelSuggested: carrollV30.modelSuggestedChange ?? null,
        }
      : null,
    arthur: arthurV26 && arthurV30
      ? {
          v26Change: arthurV26.salaryChange,
          v30Change: arthurV30.salaryChange,
          v26Momentum: arthurV26.scoreBreakdown?.momentum?.score,
          v30Momentum: arthurV30.scoreBreakdown?.momentum?.score,
          v26RaceImpact: arthurV26.scoreBreakdown?.raceImpact?.score,
          v30RaceImpact: arthurV30.scoreBreakdown?.raceImpact?.score,
          v30ModelSuggested: arthurV30.modelSuggestedChange ?? null,
        }
      : null,
  });

  for (const driver of slateV26.drivers) {
    priorMaps[PROFILE_A].salaries.set(String(driver.driverId), driver.finalSalary);
    priorMaps[PROFILE_A].tiers.set(String(driver.driverId), driver.fantasyTierScore);
  }
  for (const driver of slateV30.drivers) {
    priorMaps[PROFILE_B].salaries.set(String(driver.driverId), driver.finalSalary);
    priorMaps[PROFILE_B].tiers.set(String(driver.driverId), driver.fantasyTierScore);
  }
}

const avg = (values) =>
  values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

const summary = {
  racesSimulated: raceReports.length,
  avgAbsChangeV26: avg(raceReports.map((row) => row.v26.avgAbsChange)),
  avgAbsChangeV30: avg(raceReports.map((row) => row.v30.avgAbsChange)),
  totalCapHitsV26: raceReports.reduce((sum, row) => sum + row.v26.capHits, 0),
  totalCapHitsV30: raceReports.reduce((sum, row) => sum + row.v30.capHits, 0),
  bandViolationsV26: raceReports.reduce((sum, row) => sum + row.v26.bandViolations, 0),
  bandViolationsV30: raceReports.reduce((sum, row) => sum + row.v30.bandViolations, 0),
  latestRace: raceReports[raceReports.length - 1] ?? null,
  carrollArthurSameChangeRaces: raceReports.filter(
    (row) =>
      row.carroll &&
      row.arthur &&
      Number(row.carroll.v26Change) === Number(row.arthur.v26Change) &&
      Number(row.carroll.v26Change) > 0
  ).length,
  carrollArthurSameChangeRacesV30: raceReports.filter(
    (row) =>
      row.carroll &&
      row.arthur &&
      Number(row.carroll.v30Change) === Number(row.arthur.v30Change) &&
      Number(row.carroll.v30Change) > 0
  ).length,
};

console.log(JSON.stringify({ summary, raceReports }, null, 2));
