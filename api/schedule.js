import * as cheerio from "cheerio";
import { fetchHtml, getSettings } from "./_lib.js";
import { enrichScheduleRaces } from "./_schedule-points-races.js";
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

function isRaceNumber(value) {
  return /^\d+$/.test(cleanText(value));
}

function parseRaceRow($, row) {
  const cells = $(row).find("td");
  if (cells.length < 5) return null;

  const raceNumber = cleanText(cells.eq(0).text());
  if (!isRaceNumber(raceNumber)) return null;

  const date = cleanText(cells.eq(1).text());
  const points = cleanText(cells.eq(2).text());

  const trackCell = cells.eq(4);
  const trackLink = trackCell.find("a").first();
  const track = cleanText(trackLink.text() || trackCell.text());

  const length = cleanText(cells.eq(5).text());

  const winnerCell = cells.eq(6);
  const winnerLink = winnerCell.find("a").first();
  const winner = cleanText(winnerLink.text() || winnerCell.text());

  const resultLink = $(row).find("a[href*='race']").last().attr("href") || "";

  return {
    raceNumber: Number(raceNumber),
    date,
    points,
    status: points?.toLowerCase() === "yes" ? "points" : "non-points",
    track,
    length,
    winner,
    link: resultLink,
  };
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
    const $ = cheerio.load(html);

    const tables = $("table");
    const rowCounts = [];

    const races = [];

    tables.each((tableIndex, table) => {
      const rows = $(table).find("tr");
      rowCounts.push(rows.length);

      rows.each((_rowIndex, row) => {
        const race = parseRaceRow($, row);
        if (race) races.push(race);
      });
    });

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

    console.log("[schedule] htmlLength:", html.length);
    console.log("[schedule] tableCount:", tables.length);
    console.log("[schedule] rowCounts:", rowCounts.join(", "));
    console.log("[schedule] parsedRaceCount:", races.length);

    const payload = {
      settings,
      races,
      completed,
      totalPointsRaces,
      next,
      raceProgression,
      updatedAt: new Date().toISOString(),
    };

    if (!races.length) {
      payload.error = "No schedule rows found";
      payload.debug = {
        htmlLength: html.length,
        tableCount: tables.length,
        rowCounts,
        firstTableText: cleanText(tables.first().text()).slice(0, 500),
      };
    }

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message || "Schedule fetch failed" });
  }
}
