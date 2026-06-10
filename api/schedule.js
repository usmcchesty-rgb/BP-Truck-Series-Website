import * as cheerio from "cheerio";
import { fetchHtml, getSettings } from "./_lib.js";

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

function findNextRace(races) {
  const now = new Date();
  return (
    races.find((race) => {
      const date = new Date(race.date);
      return !Number.isNaN(date.getTime()) && date >= now && !race.winner;
    }) || null
  );
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

    const completed = races.filter((race) => race.winner).length;
    const totalPointsRaces = races.filter((race) => race.points?.toLowerCase() === "yes").length;
    const next = findNextRace(races);

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
