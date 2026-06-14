import { fetchHtml, getSettings } from "./_lib.js";
import { enrichScheduleRaces } from "./_schedule-points-races.js";
import { buildRaceResultsPayload } from "./_race-results-page.js";
import {
  computeSeasonCautionStatsFromRaces,
  parseScheduleRacesFromHtml,
} from "./_caution-stats.js";
import {
  buildRaceProgressionDiagnostics,
  countEffectiveCompletedScheduleRaces,
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
    date: race.date,
    points: race.points,
    status: race.status,
    track: race.track,
    length: race.length,
    winner: race.winner,
    link: race.link,
    officialPointsRaceNumber: race.officialPointsRaceNumber,
    nonPoints: race.nonPoints === true,
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
    const next = mapEnrichedRaceToApiShape(nextPointsRace) || nextRaw;
    const completed = countEffectiveCompletedScheduleRaces(races, progressionOptions);
    const totalPointsRaces = races.filter((race) => race.points?.toLowerCase() === "yes").length;
    const cautionStats = await computeSeasonCautionStatsFromRaces(races, progressionOptions);

    const requestedRaceNumber = req.query?.raceNumber ?? req.query?.pointsRaceNumber ?? null;
    let raceResults = null;
    try {
      raceResults = await buildRaceResultsPayload({
        enrichedRaces,
        scheduleHtml: html,
        settings,
        requestedRaceNumber: requestedRaceNumber ? Number(requestedRaceNumber) : null,
        progressionOptions,
      });
    } catch (raceResultsError) {
      raceResults = {
        resultsAvailable: false,
        selectedRaceNumber: null,
        selectedScheduleId: null,
        selectedRaceName: null,
        selectedRaceDate: null,
        selectedRaceWinner: null,
        resultRowsCount: 0,
        dataSource: 'error',
        alignmentMethod: 'none',
        latestCompletedRaceNumber: null,
        completedRaces: [],
        rows: [],
        error: raceResultsError.message || 'Race results unavailable',
      };
    }

    console.log("[schedule] htmlLength:", html.length);
    console.log("[schedule] parsedRaceCount:", races.length);

    const payload = {
      settings,
      races,
      completed,
      totalPointsRaces,
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
