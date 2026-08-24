import { fetchHtml, getSettings } from "./_lib.js";
import {
  enrichScheduleRaces,
  buildSiteResultsUrl,
  formatRaceDisplayTitle,
} from "./_schedule-points-races.js";
import {
  resolveSeasonPhaseFromSchedule,
  formatStandingsSidebarPhase,
} from "./_championship-season.js";
import { buildRaceResultsPayload } from "./_race-results-page.js";
import {
  computeSeasonCautionStatsFromRaces,
  parseScheduleRacesFromHtml,
} from "./_caution-stats.js";
import {
  buildRaceProgressionDiagnostics,
  findEffectiveNextScheduleRace,
  getEffectivePointsRaceProgression,
} from "./_race-date-status.js";

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function mapEnrichedRaceToApiShape(race) {
  if (!race) return null;

  return {
    raceNumber: race.scheduleRow ?? race.raceNumber,
    displayRaceLabel: race.displayRaceLabel || null,
    date: race.date,
    points: race.points,
    status: race.status,
    track: race.track,
    length: race.length,
    winner: race.winner,
    link: race.link,
    scheduleId: race.scheduleId || null,
    officialPointsRaceNumber: race.officialPointsRaceNumber,
    nonPoints: race.nonPoints === true,
    isOpeningDuel: race.isOpeningDuel === true,
    countsAsNormalChampionshipRace: race.countsAsNormalChampionshipRace === true,
    resultsUrl: buildSiteResultsUrl(race),
    displayTitle: formatRaceDisplayTitle(race),
  };
}

export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    const html = await fetchHtml(settings.scheduleUrl);
    const races = parseScheduleRacesFromHtml(html);

    const now = new Date();
    const progressionOptions = { now, settings };
    const enrichedRaces = enrichScheduleRaces(races);
    const progression = getEffectivePointsRaceProgression(enrichedRaces, progressionOptions);
    const raceProgression = buildRaceProgressionDiagnostics(enrichedRaces, progressionOptions);
    const { race: nextRaw } = findEffectiveNextScheduleRace(races, progressionOptions);
    const nextPointsRace = progression.currentUpcomingPointsRace;
    const next = mapEnrichedRaceToApiShape(nextPointsRace) || mapEnrichedRaceToApiShape(nextRaw);
    const seasonState = resolveSeasonPhaseFromSchedule(enrichedRaces, progressionOptions);
    const sidebarPhase = formatStandingsSidebarPhase(seasonState.phase, seasonState.counts);

    const requestedRaceNumber = req.query?.raceNumber ?? req.query?.pointsRaceNumber ?? null;
    const requestedScheduleId = req.query?.scheduleId ?? req.query?.schedule_id ?? null;
    const requestedRaceLabel = req.query?.race ?? req.query?.raceLabel ?? null;
    const omitCautionStats =
      req.query?.omitCautionStats === "1" ||
      req.query?.omitCautionStats === "true" ||
      req.query?.skipCautionStats === "1";

    const cautionPromise = omitCautionStats
      ? Promise.resolve({
          cautionDataAvailable: false,
          cautionDataSource: "omitted-by-request",
          cautionRacesCounted: 0,
          totalCautions: null,
          averageCautionsPerRace: null,
        })
      : computeSeasonCautionStatsFromRaces(races, progressionOptions);

    const [cautionStats, raceResults] = await Promise.all([
      cautionPromise,
      buildRaceResultsPayload({
        enrichedRaces,
        scheduleHtml: html,
        settings,
        requestedRaceNumber: requestedRaceNumber ? Number(requestedRaceNumber) : null,
        requestedScheduleId,
        requestedRaceLabel,
        progressionOptions,
      }).catch((raceResultsError) => ({
        resultsAvailable: false,
        selectedRaceNumber: null,
        selectedDisplayRaceLabel: null,
        selectedScheduleId: null,
        selectedRaceName: null,
        selectedRaceDate: null,
        selectedRaceWinner: null,
        cautionCount: null,
        resultRowsCount: 0,
        dataSource: "error",
        alignmentMethod: "none",
        latestCompletedRaceNumber: null,
        completedRaces: [],
        rows: [],
        error: raceResultsError.message || "Race results unavailable",
      })),
    ]);

    console.log("[schedule] htmlLength:", html.length);
    console.log("[schedule] parsedRaceCount:", races.length);

    const payload = {
      settings,
      races: enrichedRaces.map(mapEnrichedRaceToApiShape),
      completed: seasonState.counts.completedNormalChampionshipRaces,
      completedScheduleEvents: seasonState.counts.completedScheduleEvents,
      totalPointsRaces: seasonState.counts.normalChampionshipRacesTotal,
      seasonCounts: seasonState.counts,
      playoffPhase: seasonState.phase,
      sidebarPhase,
      next,
      raceProgression,
      cautionStats,
      raceResults,
      updatedAt: new Date().toISOString(),
    };

    if (!races.length) {
      payload.error = "No schedule rows found";
      payload.debug = {
        htmlLength: html.length,
        parsedRaceCount: races.length,
        firstTableText: cleanText(html).slice(0, 500),
      };
    }

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message || "Schedule fetch failed" });
  }
}
