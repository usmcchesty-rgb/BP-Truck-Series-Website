/**
 * Audit Season Performance scoring saturation.
 * Usage: node scripts/audit-season-performance.mjs [raceNumber]
 */
import * as cheerio from 'cheerio';
import { getSettings, fetchHtml, getDriverProfiles } from '../api/_lib.js';
import {
  enrichScheduleRaces,
  buildRaceNumberDebug,
  getLatestCompletedPointsRace,
} from '../api/_schedule-points-races.js';
import {
  explainSeasonPerformanceScore,
  POWER_SCORE_WEIGHTS,
  SEASON_RAW_TARGET_MAX,
} from '../api/_power-rankings-scoring.js';

function parseScheduleRaces(html) {
  const $ = cheerio.load(html);
  const races = [];
  $('table').each((_tableIndex, table) => {
    $(table)
      .find('tr')
      .each((_rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length < 7) return;
        const raceNumber = String(cells.eq(0).text() || '').trim();
        if (!/^\d+$/.test(raceNumber)) return;
        const points = String(cells.eq(2).text() || '').trim();
        const winner = String(
          cells.eq(6).find('a').first().text() || cells.eq(6).text() || ''
        ).trim();
        let scheduleId = null;
        $(row)
          .find("a[href*='race']")
          .each((_idx, anchor) => {
            const href = String($(anchor).attr('href') || '');
            const match = href.match(/schedule_id=(\d+)/);
            if (match?.[1]) scheduleId = match[1];
          });
        races.push({
          scheduleRow: Number(raceNumber),
          scheduleId,
          date: String(cells.eq(1).text() || '').trim(),
          points,
          status: points?.toLowerCase() === 'yes' ? 'points' : 'non-points',
          track: String(cells.eq(4).find('a').first().text() || cells.eq(4).text() || '').trim(),
          winner: winner || null,
        });
      });
  });
  return enrichScheduleRaces(races);
}

async function fetchStandingsPayload(settings, scheduleId) {
  const seasonId = settings.seasonId || '27987';
  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${scheduleId}`,
    { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
  );
  if (!response.ok) throw new Error(`Standings fetch failed (${response.status})`);
  return response.json();
}

function buildStandingsRows(data, profiles) {
  const byDriverId = Object.fromEntries(profiles.map((p) => [String(p.driver_id), p]));
  return Object.values(data.rps || {})
    .map((r) => {
      const driver = data.drivers?.[r.drid] || {};
      const rawName = driver.name || r.name || `Driver ${r.drid}`;
      const name = rawName.includes(',')
        ? rawName.split(',').reverse().map((s) => s.trim()).join(' ')
        : rawName;
      const profile = byDriverId[String(r.drid)] || null;
      return {
        driverId: String(r.drid),
        driverName: profile?.display_name || name,
        position: Number(r.pos2),
        wins: Number(r.wins || 0),
        top5: Number(r.t5 || 0),
        top10: Number(r.t10 || 0),
        races: Number(r.counted || r.starts || 0),
      };
    })
    .filter((r) => r.position >= 1)
    .sort((a, b) => a.position - b.position);
}

const raceArg = Number(process.argv[2]);
const settings = await getSettings();
const profiles = await getDriverProfiles();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = parseScheduleRaces(scheduleHtml);
const latestRace = getLatestCompletedPointsRace(scheduleRaces);
const raceNumber =
  Number.isInteger(raceArg) && raceArg >= 1 ? raceArg : latestRace?.officialPointsRaceNumber;
const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { settings });
const standingsPayload = await fetchStandingsPayload(
  settings,
  raceNumberDebug.standingsScheduleId
);
const standings = buildStandingsRows(standingsPayload, profiles);

const rows = standings
  .map((row) => {
    const explained = explainSeasonPerformanceScore(
      row,
      standingsPayload.schedules,
      row.driverId
    );
    return {
      driverName: row.driverName,
      pointsPosition: row.position,
      wins: row.wins,
      top5: row.top5,
      top10: row.top10,
      races: row.races,
      avgFinish: explained.details.avgFinish,
      bestFinish: explained.details.bestFinish,
      components: explained.components,
      rawTotal: explained.seasonRawTotal,
      seasonRawTargetMax: explained.seasonRawTargetMax,
      seasonNormalizedScore: explained.seasonNormalizedScore,
      seasonWasCapped: explained.seasonWasCapped,
      oldClampScoreForComparison: explained.oldClampScoreForComparison,
      cappedScore: explained.seasonNormalizedScore,
      wasCapped: explained.seasonWasCapped,
      weightedContribution: Number(
        (explained.seasonNormalizedScore * POWER_SCORE_WEIGHTS.seasonPerformance).toFixed(4)
      ),
      oldWeightedContribution: Number(
        (explained.oldClampScoreForComparison * POWER_SCORE_WEIGHTS.seasonPerformance).toFixed(4)
      ),
    };
  })
  .sort((a, b) => b.rawTotal - a.rawTotal);

const at100Normalized = rows.filter((row) => row.seasonNormalizedScore === 100);
const at100OldClamp = rows.filter((row) => row.oldClampScoreForComparison === 100);
const capped = rows.filter((row) => row.seasonWasCapped);

const report = {
  raceNumber,
  formulaNote:
    `seasonNormalizedScore = clamp((rawTotal / ${SEASON_RAW_TARGET_MAX}) * 100, 0, 100)`,
  seasonRawTargetMax: SEASON_RAW_TARGET_MAX,
  weights: POWER_SCORE_WEIGHTS,
  driverCount: rows.length,
  driversWithNormalizedScore100: at100Normalized.length,
  driversWithOldClampScore100: at100OldClamp.length,
  driversWithRawAboveTargetMax: capped.length,
  pctDriversAtNormalized100: Number(((at100Normalized.length / rows.length) * 100).toFixed(1)),
  pctDriversAtOldClamp100: Number(((at100OldClamp.length / rows.length) * 100).toFixed(1)),
  rawTotalRange: {
    max: rows[0]?.rawTotal ?? null,
    min: rows[rows.length - 1]?.rawTotal ?? null,
  },
  oldAt100RawRange: at100OldClamp.length
    ? {
        min: Math.min(...at100OldClamp.map((r) => r.rawTotal)),
        max: Math.max(...at100OldClamp.map((r) => r.rawTotal)),
      }
    : null,
  componentFormula: {
    positionPoints: '(21 - min(pointsPosition, 20)) * 4.5',
    winPoints: 'min(wins, 5) * 6',
    top5Points: 'min(top5, 12) * 2.2',
    top10Points: 'min(top10, 20) * 0.9',
    avgFinishPoints: 'invertFinishScore(seasonAvgFinish) * 0.22',
    bestFinishPoints: 'invertFinishScore(seasonBestFinish) * 0.12',
    invertFinishScore: '((fieldSize - finish + 1) / fieldSize) * 100, fieldSize=max(30, finish, 20)',
    final: `seasonNormalizedScore = clamp((sum(components) / ${SEASON_RAW_TARGET_MAX}) * 100, 0, 100)`,
    oldClampForComparison: 'oldClampScoreForComparison = clamp(sum(components), 0, 100)',
  },
  driversAtOldClamp100: at100OldClamp,
  allDrivers: rows,
};

console.log(JSON.stringify(report, null, 2));
