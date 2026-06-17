/**
 * Audit: full power score breakdown for selected drivers.
 * Usage: node scripts/audit-power-score-breakdown.mjs [raceNumber]
 */
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { getSettings, fetchHtml, getDriverProfiles } from '../api/_lib.js';
import {
  enrichScheduleRaces,
  buildRaceNumberDebug,
  getLatestCompletedPointsRace,
} from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import { buildRecentFormAnalysis } from '../api/_power-rankings-recent-form.js';
import {
  buildPowerRankingSelection,
  scorePowerRankingCandidate,
  POWER_SCORE_WEIGHTS,
} from '../api/_power-rankings-scoring.js';

const TARGET_NAMES = [
  'Dustin Ping',
  'Mark Arthur',
  'Justin Levine',
  'Dalton Kilroe',
];

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
        carNumber: profile?.car_number || '',
        position: Number(r.pos2),
        previousPosition: Number(r.pos1),
        points: Number(r.tpts || 0),
        wins: Number(r.wins || 0),
        top5: Number(r.t5 || 0),
        top10: Number(r.t10 || 0),
        races: Number(r.counted || r.starts || 0),
      };
    })
    .filter((r) => r.position >= 1)
    .sort((a, b) => a.position - b.position);
}

function buildDriverLookup(standings, profiles) {
  const lookup = new Map();
  for (const row of standings) lookup.set(String(row.driverId), row);
  for (const profile of profiles) {
    const id = String(profile.driver_id);
    if (!lookup.has(id)) {
      lookup.set(id, {
        driverId: id,
        driverName: profile.display_name || profile.iracing_name,
        carNumber: profile.car_number || '',
      });
    }
  }
  return lookup;
}

async function loadPreviousPowerRankings(beforeRaceNumber) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { entries: [], raceNumber: null };

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: weeks } = await sb
    .from('power_rankings_weeks')
    .select('*')
    .eq('published', true)
    .lt('race_number', beforeRaceNumber)
    .order('race_number', { ascending: false })
    .limit(1);

  if (!weeks?.length) return { entries: [], raceNumber: null };

  const week = weeks[0];
  const { data: entries } = await sb
    .from('power_rankings_entries')
    .select('*')
    .eq('week_id', week.id)
    .order('rank');

  const profiles = await getDriverProfiles();
  const byId = Object.fromEntries(profiles.map((p) => [String(p.driver_id), p]));

  return {
    raceNumber: week.race_number,
    entries: (entries || []).map((entry) => ({
      rank: entry.rank,
      driverId: String(entry.driver_id),
      driverName:
        byId[String(entry.driver_id)]?.display_name ||
        byId[String(entry.driver_id)]?.iracing_name ||
        entry.driver_id,
    })),
  };
}

function explainWeightedFinal(breakdown) {
  const w = POWER_SCORE_WEIGHTS;
  return {
    recentFormContribution: Number((breakdown.recentForm * w.recentForm).toFixed(4)),
    seasonContribution: Number((breakdown.seasonPerformance * w.seasonPerformance).toFixed(4)),
    raceImpactContribution: Number((breakdown.raceImpact * w.raceImpact).toFixed(4)),
    championshipContribution: Number((breakdown.championship * w.championship).toFixed(4)),
    momentumContribution: Number((breakdown.momentum * w.momentum).toFixed(4)),
  };
}

function findByName(candidates, name) {
  const needle = name.toLowerCase();
  return (
    candidates.find((row) => String(row.driverName).toLowerCase() === needle) ||
    candidates.find((row) => String(row.driverName).toLowerCase().includes(needle))
  );
}

const raceArg = Number(process.argv[2]);
const settings = await getSettings();
const profiles = await getDriverProfiles();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = parseScheduleRaces(scheduleHtml);
const latestRace = getLatestCompletedPointsRace(scheduleRaces);
const raceNumber = Number.isInteger(raceArg) && raceArg >= 1
  ? raceArg
  : latestRace?.officialPointsRaceNumber;

if (!raceNumber) throw new Error('Could not resolve race number.');

const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { settings });
const standingsPayload = await fetchStandingsPayload(
  settings,
  raceNumberDebug.standingsScheduleId
);
const standings = buildStandingsRows(standingsPayload, profiles);
const driverLookup = buildDriverLookup(standings, profiles);
const alignedRaces = getAlignedRaceFinishes(
  scheduleRaces,
  raceNumber,
  standingsPayload.schedules,
  driverLookup
);
const recentResults = alignedRaces.map((race) => ({
  raceNumber: race.pointsRaceNumber,
  track: race.track,
  winner: race.winner,
}));
const factualGrounding = buildFactualGroundingContext({
  standings,
  scheduleRaces,
  raceNumber,
  schedules: standingsPayload.schedules,
  driverLookup,
  recentResults,
});
const recentFormAnalysis = buildRecentFormAnalysis({
  scheduleRaces,
  raceNumber,
  standings,
  schedules: standingsPayload.schedules,
  driverLookup,
});
const previousRankings = await loadPreviousPowerRankings(raceNumber);
const previousRankByDriver = Object.fromEntries(
  (previousRankings.entries || []).map((entry) => [String(entry.driverId), Number(entry.rank)])
);

const selection = buildPowerRankingSelection({
  standings,
  factualGrounding,
  alignedRaces,
  schedules: standingsPayload.schedules,
  previousRankByDriver,
  recentFormAnalysis,
});

const top10Ids = new Set(selection.top10.map((row) => row.driverId));
const rankByDriverId = Object.fromEntries(
  selection.top10.map((row) => [row.driverId, row.rank])
);

const report = {
  generatedAt: new Date().toISOString(),
  raceNumber,
  previousPowerRankingsRace: previousRankings.raceNumber,
  weights: POWER_SCORE_WEIGHTS,
  alignedRecentRaces: alignedRaces.map((race) => ({
    raceNumber: race.pointsRaceNumber,
    track: race.track,
    alignmentMethod: race.alignmentMethod,
  })),
  top10Selected: selection.top10.map((row) => ({
    rank: row.rank,
    driverName: row.driverName,
    powerScore: row.powerScore,
    dropProtectionApplied: row.dropProtectionApplied,
  })),
  droppedFromPreviousTop10: selection.droppedFromPreviousTop10,
  targetDrivers: {},
  top20ByPowerScore: selection.candidates.slice(0, 20).map((row, index) => ({
    scoreRank: index + 1,
    finalRank: rankByDriverId[row.driverId] ?? null,
    inTop10: top10Ids.has(row.driverId),
    driverName: row.driverName,
    driverId: row.driverId,
    powerScore: row.powerScore,
    scoreBreakdown: row.scoreBreakdown,
    previousPowerRank: row.previousRank,
    retentionBonus: row.retentionBonus,
    protectedFromDropout: row.protectedFromDropout,
    recentFinishes: row.componentDetails?.recentForm?.last3Finishes,
    last3Avg: row.componentDetails?.recentForm?.last3RaceAverageFinish,
    pointsPosition: row.componentDetails?.season?.pointsPosition,
  })),
};

for (const name of TARGET_NAMES) {
  const row = findByName(selection.candidates, name);
  if (!row) {
    report.targetDrivers[name] = { error: 'Driver not found in standings/scoring pool.' };
    continue;
  }

  const grounding = factualGrounding.drivers?.[row.driverId];
  const standingsRow = standings.find((s) => String(s.driverId) === row.driverId);
  const contributions = explainWeightedFinal(row.scoreBreakdown);

  report.targetDrivers[name] = {
    driverId: row.driverId,
    scoreRank: selection.candidates.findIndex((c) => c.driverId === row.driverId) + 1,
    finalPowerRank: rankByDriverId[row.driverId] ?? null,
    inTop10: top10Ids.has(row.driverId),
    protectedFromDropout: row.protectedFromDropout,
    dropProtectionApplied: row.dropProtectionApplied,
    canDropOut: row.canDropOut,
    dropReasons: row.dropReasons,
    recentFormScore: row.scoreBreakdown.recentForm,
    seasonPerformanceScore: row.scoreBreakdown.seasonPerformance,
    seasonDiagnostics: {
      seasonRawTotal: row.componentDetails?.season?.seasonRawTotal ?? null,
      seasonRawTargetMax: row.componentDetails?.season?.seasonRawTargetMax ?? null,
      seasonNormalizedScore: row.componentDetails?.season?.seasonNormalizedScore ?? null,
      seasonWasCapped: row.componentDetails?.season?.seasonWasCapped ?? null,
      oldClampScoreForComparison: row.componentDetails?.season?.oldClampScoreForComparison ?? null,
    },
    raceImpactScore: row.scoreBreakdown.raceImpact,
    championshipScore: row.scoreBreakdown.championship,
    momentumScore: row.scoreBreakdown.momentum,
    retentionBonus: row.retentionBonus,
    finalPowerScore: row.powerScore,
    weightedContributions: contributions,
    weightedSumCheck: Number(
      (
        contributions.recentFormContribution +
        contributions.seasonContribution +
        contributions.raceImpactContribution +
        contributions.championshipContribution +
        contributions.momentumContribution
      ).toFixed(2)
    ),
    previousPowerRank: row.previousRank,
    pointsStandingsPosition: standingsRow?.position ?? null,
    points: standingsRow?.points ?? null,
  seasonWins: standingsRow?.wins ?? null,
    seasonTop5: standingsRow?.top5 ?? null,
    seasonTop10: standingsRow?.top10 ?? null,
    verifiedRecentRaceFinishes: grounding?.recentRaceFinishes ?? [],
    numericInputs: row.componentDetails,
  };
}

console.log(JSON.stringify(report, null, 2));
