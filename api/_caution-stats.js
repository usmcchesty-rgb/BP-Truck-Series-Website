import * as cheerio from 'cheerio';
import { fetchHtml } from './_lib.js';
import { enrichScheduleRaces } from './_schedule-points-races.js';
import {
  getEffectiveRaceDateStatus,
  hasRaceResults,
  resolveRaceProgressionSettings,
} from './_race-date-status.js';
import {
  buildCautionSeasonCacheKey,
  getCachedCautionSeason,
  getCachedRaceCautionCount,
  setCachedCautionSeason,
  setCachedRaceCautionCount,
} from './_fantasy-srh-cache.js';

const CAUTION_SUMMARY_PATTERN =
  /Lead Changes\s*·\s*(\d+)\s+cautions?\b/i;
const CAUTION_FALLBACK_PATTERN = /\b(\d+)\s+cautions?\b/i;

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function isRaceNumber(value) {
  return /^\d+$/.test(cleanText(value));
}

export function extractScheduleIdFromResultLink(link) {
  const match = String(link || '').match(/[?&]schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

function parseRaceRow($, row) {
  const cells = $(row).find('td');
  if (cells.length < 5) return null;

  const raceNumber = cleanText(cells.eq(0).text());
  if (!isRaceNumber(raceNumber)) return null;

  const date = cleanText(cells.eq(1).text());
  const points = cleanText(cells.eq(2).text());

  const trackCell = cells.eq(4);
  const trackLink = trackCell.find('a').first();
  const track = cleanText(trackLink.text() || trackCell.text());

  const length = cleanText(cells.eq(5).text());

  const winnerCell = cells.eq(6);
  const winnerLink = winnerCell.find('a').first();
  const winner = cleanText(winnerLink.text() || winnerCell.text());

  const resultLink = $(row).find("a[href*='race']").last().attr('href') || '';
  const scheduleId = extractScheduleIdFromResultLink(resultLink);

  return {
    raceNumber: Number(raceNumber),
    date,
    points,
    status: points?.toLowerCase() === 'yes' ? 'points' : 'non-points',
    track,
    length,
    winner,
    link: resultLink,
    scheduleId,
  };
}

export function parseScheduleRacesFromHtml(html) {
  const $ = cheerio.load(html);
  const races = [];

  $('table').each((_tableIndex, table) => {
    $(table)
      .find('tr')
      .each((_rowIndex, row) => {
        const race = parseRaceRow($, row);
        if (race) races.push(race);
      });
  });

  return races;
}

export function parseCautionCountFromRaceHtml(html) {
  const text = String(html || '');
  if (!text) return null;

  const summaryMatch = text.match(CAUTION_SUMMARY_PATTERN);
  if (summaryMatch) {
    const value = Number(summaryMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  const fallbackMatch = text.match(CAUTION_FALLBACK_PATTERN);
  if (fallbackMatch) {
    const value = Number(fallbackMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

export function resolveRaceResultUrl(link) {
  const href = String(link || '').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.simracerhub.com/scoring/${href.replace(/^\//, '')}`;
}

/**
 * Authoritative caution count from a SimRacerHub race result page summary.
 * Returns a finite number (including 0) or null when unavailable.
 * Does not infer from incidents/laps.
 */
export async function fetchCautionCountForRace(race) {
  const scheduleId =
    race?.scheduleId != null && String(race.scheduleId).trim()
      ? String(race.scheduleId).trim()
      : null;

  if (scheduleId) {
    const cached = getCachedRaceCautionCount(scheduleId);
    if (cached != null && Number.isFinite(Number(cached))) {
      return Number(cached);
    }
  }

  const url = resolveRaceResultUrl(race?.link);
  if (!url) return null;

  try {
    const html = await fetchHtml(url);
    const cautions = parseCautionCountFromRaceHtml(html);
    if (!Number.isFinite(cautions)) return null;
    if (scheduleId) setCachedRaceCautionCount(scheduleId, cautions);
    return cautions;
  } catch {
    return null;
  }
}

function buildStatusOptions(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const progressionSettings = resolveRaceProgressionSettings(options.settings || null);
  return { now, progressionSettings };
}

export function getCompletedPointsRacesForCautions(enrichedRaces, options = {}) {
  const { now, progressionSettings } = buildStatusOptions(options);

  return (enrichedRaces || []).filter((race) => {
    if (race.nonPoints) return false;

    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults: hasRaceResults(race),
      now,
      progressionSettings,
    });

    return status.isCompleted;
  });
}

function buildUnavailableResult(reason, extra = {}) {
  return {
    cautionDataAvailable: false,
    cautionDataSource: reason,
    cautionRacesCounted: 0,
    totalCautions: null,
    averageCautionsPerRace: null,
    ...extra,
  };
}

export async function computeAverageCautionsPerRace(enrichedRaces, options = {}) {
  const completedPointsRaces = getCompletedPointsRacesForCautions(
    enrichedRaces,
    options
  );
  const racesWithLinks = completedPointsRaces.filter((race) => race.link);

  if (!completedPointsRaces.length) {
    return buildUnavailableResult('no-completed-points-races');
  }

  if (!racesWithLinks.length) {
    return buildUnavailableResult('completed-points-races-missing-result-links', {
      completedPointsRaceCount: completedPointsRaces.length,
    });
  }

  const seasonCacheKey = buildCautionSeasonCacheKey(
    racesWithLinks.map(
      (race) =>
        `${race.scheduleId || race.officialPointsRaceNumber || race.raceNumber}:${race.link}`
    )
  );
  const cachedSeason = getCachedCautionSeason(seasonCacheKey);
  if (cachedSeason) return cachedSeason;

  const parsedResults = await Promise.all(
    racesWithLinks.map(async (race) => {
      const cautions = await fetchCautionCountForRace(race);
      return {
        race,
        cautions,
        ok: Number.isFinite(cautions),
      };
    })
  );

  const valid = parsedResults.filter((entry) => entry.ok);
  if (!valid.length) {
    return buildUnavailableResult('simracerhub-race-page-parse-failed', {
      completedPointsRaceCount: completedPointsRaces.length,
      racesAttempted: racesWithLinks.length,
    });
  }

  const totalCautions = valid.reduce((sum, entry) => sum + entry.cautions, 0);
  const averageCautionsPerRace = Number((totalCautions / valid.length).toFixed(2));

  const result = {
    cautionDataAvailable: true,
    cautionDataSource: 'simracerhub-race-page-summary',
    cautionRacesCounted: valid.length,
    totalCautions,
    averageCautionsPerRace,
    completedPointsRaceCount: completedPointsRaces.length,
    racesParsed: valid.map((entry) => ({
      raceNumber: entry.race.officialPointsRaceNumber ?? entry.race.raceNumber,
      scheduleId: entry.race.scheduleId || null,
      track: entry.race.track,
      cautions: entry.cautions,
    })),
  };
  setCachedCautionSeason(seasonCacheKey, result);
  return result;
}

export async function computeSeasonCautionStatsFromScheduleHtml(html, options = {}) {
  const parsedRaces = parseScheduleRacesFromHtml(html);
  const enrichedRaces = enrichScheduleRaces(parsedRaces);
  return computeAverageCautionsPerRace(enrichedRaces, options);
}

export async function computeSeasonCautionStatsFromRaces(races, options = {}) {
  const enrichedRaces = enrichScheduleRaces(races || []);
  return computeAverageCautionsPerRace(enrichedRaces, options);
}
