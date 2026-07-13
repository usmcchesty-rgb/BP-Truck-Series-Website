/**
 * 6-stage Race 15 provisional pipeline diagnostic against live SimRacerHub data.
 */
import { fetchHtml, getSettings, getDriverProfiles } from '../api/_lib.js';
import { parseScheduleRacesFromHtml } from '../api/_caution-stats.js';
import { enrichScheduleRaces, buildRaceNumberDebug, getPointsRaceByNumber } from '../api/_schedule-points-races.js';
import {
  pickOfficialRaceBucket,
  isProvisionalRawResult,
  buildCanonicalOfficialRaceResult,
  extractOfficialRaceField,
  extractOfficialRaceFinishes,
  extractFinishRacesFromSchedules,
  findScheduleEntryByScheduleId,
} from '../api/_simracerhub-schedule-results.js';
import { fetchStandingsRows, buildDriverLookup } from '../api/_standings-rows.js';
import { alignFinishRacesWithTrace } from '../api/_power-rankings-schedule-alignment.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import { loadOfficialRaceResultsContext } from '../api/_fantasy-race-scoring.js';
import { buildDriverProvisionalLedgerBoard } from '../api/_driver-provisionals.js';
import { buildRaceResultsPayload } from '../api/_race-results-page.js';

const RACE_NUMBER = 15;

function resolveScheduleId(race) {
  if (race?.scheduleId != null) return String(race.scheduleId);
  const match = String(race?.link || '').match(/schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

function raceWithScheduleId(race) {
  if (!race) return null;
  return { ...race, scheduleId: resolveScheduleId(race) };
}

function driverNameFromSchedules(schedulesPayload, driverId) {
  const drivers = schedulesPayload?.drivers || {};
  const driver = drivers[driverId] || drivers[String(driverId)];
  if (!driver?.name) return `Driver ${driverId}`;
  const raw = String(driver.name);
  if (!raw.includes(',')) return raw;
  return raw.split(',').reverse().map((s) => s.trim()).join(' ');
}

function printStage(title, payload) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
  console.log(JSON.stringify(payload, null, 2));
}

const settings = await getSettings();
const html = await fetchHtml(settings.scheduleUrl);
const races = enrichScheduleRaces(parseScheduleRacesFromHtml(html));
const race15 = getPointsRaceByNumber(races, RACE_NUMBER);
const raceDebug = buildRaceNumberDebug(races, RACE_NUMBER, { now: new Date(), settings });

printStage('Race 15 schedule alignment', {
  track: race15?.track,
  date: race15?.date,
  winner: race15?.winner,
  scheduleId: resolveScheduleId(race15),
  standingsScheduleId: raceDebug.standingsScheduleId,
  standingsRaceNumber: raceDebug.standingsRaceNumber,
});

const standingsResult = await fetchStandingsRows(settings, raceDebug.standingsScheduleId);
const profiles = await getDriverProfiles();
const profileById = Object.fromEntries(profiles.map((p) => [String(p.driver_id), p]));

const rawStandingsResponse = await fetch(
  `https://www.simracerhub.com/scoring/get_standings.php?season_id=${settings.seasonId || '27987'}&schedule_id=${raceDebug.standingsScheduleId}`,
  { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } },
);
const rawStandingsData = await rawStandingsResponse.json();

function driverName(driverId) {
  const profile = profileById[String(driverId)];
  if (profile?.display_name) return profile.display_name;
  if (profile?.iracing_name) return profile.iracing_name;
  return driverNameFromSchedules(rawStandingsData, driverId);
}
const scheduleEntry = findScheduleEntryByScheduleId(
  standingsResult.schedules,
  resolveScheduleId(race15),
);

if (!scheduleEntry) {
  console.error('FATAL: No schedule entry for Race 15 schedule_id', resolveScheduleId(race15));
  process.exit(1);
}

const official = pickOfficialRaceBucket(scheduleEntry);
const bucket = official?.bucket || {};

// Stage 1 — raw SRH race bucket
const rawRows = Object.entries(bucket).map(([driverId, raw]) => ({
  driverId,
  name: driverName(driverId),
  status: raw?.status ?? null,
  provisional: raw?.provisional ?? null,
  finish_pos: raw?.finish_pos ?? null,
  session: raw?.session ?? null,
  count_stats: raw?.count_stats ?? null,
  isProvisionalDetected: isProvisionalRawResult(raw),
}));

const stage1 = {
  bucketKey: official?.bucketKey,
  totalRows: rawRows.length,
  provisionalStatus: rawRows.filter((r) => String(r.status || '').trim() === 'Provisional'),
  provisionalFlag: rawRows.filter((r) => String(r.provisional || '').toUpperCase() === 'Y'),
  finishPosNull: rawRows.filter((r) => r.finish_pos == null || r.finish_pos === ''),
  droppedNoFinishNotProvisional: rawRows.filter(
    (r) => !r.isProvisionalDetected && (r.finish_pos == null || r.finish_pos === '' || Number(r.finish_pos) < 1),
  ),
};

printStage('Stage 1 — Raw SRH race bucket', stage1);

// Stage 2 — after buildCanonicalOfficialRaceResult (per provisional row)
const physicalEntries = [];
const provisionalEntries = [];
for (const [driverId, rawResult] of Object.entries(bucket)) {
  if (isProvisionalRawResult(rawResult)) {
    provisionalEntries.push({ driverId, rawResult });
    continue;
  }
  const finish = Number(rawResult.finish_pos ?? rawResult.finish);
  if (Number.isFinite(finish) && finish >= 1) {
    physicalEntries.push({ driverId, rawResult, finish });
  }
}
physicalEntries.sort((a, b) => a.finish - b.finish);

const stage2Canonical = provisionalEntries.map((entry, index) => {
  const assigned = physicalEntries.length + index + 1;
  const canonical = buildCanonicalOfficialRaceResult(entry.driverId, entry.rawResult, {
    isProvisional: true,
    assignedFinishPosition: assigned,
  });
  return {
    driverId: entry.driverId,
    name: driverName(entry.driverId),
    assignedFinish: assigned,
    isProvisional: canonical.isProvisional,
    participationStatus: canonical.participationStatus,
    assignedFinishPosition: canonical.assignedFinishPosition,
    finishPosition: canonical.finishPosition,
  };
});

printStage('Stage 2 — buildCanonicalOfficialRaceResult (provisionals)', {
  driverResultsCount: physicalEntries.length + provisionalEntries.length,
  provisionalRows: stage2Canonical.length,
  provisionals: stage2Canonical,
});

// Stage 3 — extractOfficialRaceField
const field = extractOfficialRaceField(scheduleEntry);
printStage('Stage 3 — extractOfficialRaceField', {
  officialStarterCount: field.meta?.officialStarterCount,
  provisionalCount: field.meta?.provisionalCount,
  totalScoredFieldCount: field.meta?.totalScoredFieldCount,
  driverResultsLength: Object.keys(field.driverResults).length,
  provisionalDriverIds: field.meta?.provisionalDriverIds,
  provisionalNames: (field.meta?.provisionalDriverIds || []).map((id) => ({
    driverId: id,
    name: driverName(id),
  })),
});

// Stage 4 — extractOfficialRaceFinishes
const extracted = extractOfficialRaceFinishes(scheduleEntry);
printStage('Stage 4 — extractOfficialRaceFinishes', {
  finishesLength: Object.keys(extracted.finishes).length,
  driverResultsLength: Object.keys(extracted.driverResults).length,
  meta: extracted.meta,
  provisionalsRemoved:
    Object.keys(field.driverResults).length - Object.keys(extracted.driverResults).length,
});

// Stage 5 — Results page API path
const driverLookup = buildDriverLookup(standingsResult.rows, profiles);
const finishRaces = extractFinishRacesFromSchedules(standingsResult.schedules);
const alignedRaces = getAlignedRaceFinishes(races, RACE_NUMBER, standingsResult.schedules, driverLookup);
const alignment = alignedRaces.find((r) => Number(r.pointsRaceNumber) === RACE_NUMBER);

const finishRaceFromList = finishRaces.find(
  (r) => String(r.scheduleId) === String(alignment?.schedulesApiScheduleId),
);

const resultsPayload = await buildRaceResultsPayload({
  enrichedRaces: races,
  scheduleHtml: html,
  settings,
  requestedRaceNumber: RACE_NUMBER,
  progressionOptions: { now: new Date(), settings },
});

printStage('Stage 5 — Results page API', {
  alignmentMethod: alignment?.alignmentMethod,
  schedulesApiScheduleId: alignment?.schedulesApiScheduleId,
  alignedProvisionalCount: alignment?.provisionalCount,
  alignedDriverResultsLength: Object.keys(alignment?.driverResults || {}).length,
  finishRaceDriverResultsLength: Object.keys(finishRaceFromList?.driverResults || {}).length,
  finishRaceProvisionalCount: finishRaceFromList?.provisionalCount,
  resultRowsCount: resultsPayload.resultRowsCount,
  provisionalCount: resultsPayload.provisionalCount,
  officialStarterCount: resultsPayload.officialStarterCount,
  totalScoredFieldCount: resultsPayload.totalScoredFieldCount,
  lastThreeRows: (resultsPayload.rows || []).slice(-3).map((r) => ({
    position: r.position,
    driverName: r.driverName,
    isProvisional: r.isProvisional,
    status: r.status,
  })),
});

// Stage 6 — Provisionals admin API
const context = await loadOfficialRaceResultsContext({
  raceNumber: RACE_NUMBER,
  settings,
  scheduleRaces: races,
});

const board = await buildDriverProvisionalLedgerBoard(settings.seasonId || '27987', {
  settings,
  scheduleRaces: races,
  raceNumber: RACE_NUMBER,
});

printStage('Stage 6 — Provisionals admin + loadOfficialRaceResultsContext', {
  contextReady: context.ready,
  contextReason: context.reason,
  contextProvisionalCount: context.provisionalCount,
  contextDriverResultsLength: Object.keys(context.driverResults).length,
  contextProvisionals: Object.entries(context.driverResults)
    .filter(([, r]) => r.isProvisional)
    .map(([id, r]) => ({
      driverId: id,
      finish: r.finish ?? r.finishPosition,
      participationStatus: r.participationStatus,
    })),
  officialProvisionalDriverIds: board.officialProvisionalDriverIds,
  officialResultsReady: board.officialResultsReady,
});

console.log('\nDiagnostic complete.');
