/**
 * Audit: trace factualGrounding.recentRaceFinishes for Justin Levine
 * Read-only — does not change ranking logic.
 */
import * as cheerio from 'cheerio';
import { getSettings, fetchHtml, getDriverProfiles } from '../api/_lib.js';
import {
  enrichScheduleRaces,
  buildRaceNumberDebug,
  getLatestCompletedPointsRace,
} from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import { matchDriverIdByName } from '../api/_power-rankings-recent-form.js';
import {
  extractFinishRacesFromSchedules,
  pickOfficialRaceBucket,
} from '../api/_simracerhub-schedule-results.js';

const TARGET_DRIVER = 'Justin Levine';

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
  return races;
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
        iracingName: name,
        carNumber: profile?.car_number || '',
        position: Number(r.pos2),
        points: Number(r.tpts || 0),
        wins: Number(r.wins || 0),
        top5: Number(r.t5 || 0),
        top10: Number(r.t10 || 0),
        races: Number(r.counted || r.starts || 0),
        rpsRow: r,
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

function findDuplicateNames(standings, driversApi) {
  const byNormName = new Map();
  for (const row of standings) {
    const norm = String(row.driverName || row.iracingName || '').toLowerCase().trim();
    if (!byNormName.has(norm)) byNormName.set(norm, []);
    byNormName.get(norm).push({ source: 'standings/rps', driverId: row.driverId, name: row.driverName });
  }
  for (const [id, driver] of Object.entries(driversApi || {})) {
    const rawName = driver.name || '';
    const name = rawName.includes(',')
      ? rawName.split(',').reverse().map((s) => s.trim()).join(' ')
      : rawName;
    const norm = name.toLowerCase().trim();
    if (!byNormName.has(norm)) byNormName.set(norm, []);
    byNormName.get(norm).push({ source: 'drivers API', driverId: String(id), name });
  }
  return [...byNormName.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([name, entries]) => ({ normalizedName: name, entries }));
}

function findCarNumberCollisions(standings) {
  const byCar = new Map();
  for (const row of standings) {
    const car = String(row.carNumber || '').trim();
    if (!car) continue;
    if (!byCar.has(car)) byCar.set(car, []);
    byCar.get(car).push({ driverId: row.driverId, driverName: row.driverName });
  }
  return [...byCar.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([carNumber, entries]) => ({ carNumber, entries }));
}

function traceRawJsonPath(schedules, scheduleKey, driverId) {
  const schedule = schedules?.[scheduleKey];
  if (!schedule) return null;

  const official = pickOfficialRaceBucket(schedule);
  if (!official) {
    return {
      scheduleKey,
      scheduleId: schedule.schedule_id ?? null,
      error: 'No official RACE bucket found',
      availableBuckets: Object.keys(schedule.drivers || {}),
    };
  }

  const result = official.bucket?.[String(driverId)] ?? null;
  const jsonPath = `schedules["${scheduleKey}"].drivers["${official.bucketKey}"]["${driverId}"]`;

  return {
    scheduleKey,
    scheduleId: schedule.schedule_id ?? null,
    eventName: schedule.event_name ?? null,
    raceDate: schedule.race_date ?? null,
    bucketKey: official.bucketKey,
    bucketSession: official.sample?.session ?? null,
    bucketCountStats: official.sample?.count_stats ?? null,
    bucketRaceId: official.sample?.race_id ?? null,
    jsonPath,
    rawResult: result,
    finishPosFromRaw: result?.finish_pos ?? null,
    driverNameInRawResult: result?.name ?? null,
    driverIdInRawResult: result?.drid ?? result?.driver_id ?? null,
    allBucketDriverIds: Object.keys(official.bucket || {}),
    driverPresentInBucket: Boolean(result),
  };
}

function findScheduleKeyForAlignedRace(alignedRace, finishRaces) {
  if (alignedRace.schedulesApiScheduleKey) {
    return alignedRace.schedulesApiScheduleKey;
  }
  const match = finishRaces.find(
    (entry) =>
      String(entry.scheduleId) === String(alignedRace.scheduleId) ||
      entry.scheduleKey === alignedRace.schedulesApiScheduleKey
  );
  return match?.scheduleKey ?? null;
}

const settings = await getSettings();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = enrichScheduleRaces(parseScheduleRaces(scheduleHtml));
const latestRace = getLatestCompletedPointsRace(scheduleRaces);
const raceNumber = latestRace?.officialPointsRaceNumber ?? 12;
const raceNumberDebug = buildRaceNumberDebug(scheduleRaces, raceNumber);

const standingsPayload = await fetchStandingsPayload(
  settings,
  raceNumberDebug.standingsScheduleId
);
const profiles = await getDriverProfiles();
const standings = buildStandingsRows(standingsPayload, profiles);
const driverLookup = buildDriverLookup(standings, profiles);

const justinIdFromLookup = matchDriverIdByName(TARGET_DRIVER, driverLookup);
const justinStandingsRow = standings.find(
  (row) =>
    String(row.driverId) === String(justinIdFromLookup) ||
    /justin/i.test(row.driverName) && /levine/i.test(row.driverName)
);

const alignedRaces = getAlignedRaceFinishes(
  scheduleRaces,
  raceNumber,
  standingsPayload.schedules || {},
  driverLookup
);
const finishRaces = extractFinishRacesFromSchedules(standingsPayload.schedules || {});

const factualGrounding = buildFactualGroundingContext({
  standings,
  scheduleRaces,
  raceNumber,
  schedules: standingsPayload.schedules || {},
  driverLookup,
  recentResults: [],
  manualRaceNotes: '',
  transcriptSummary: '',
});

const driverId = justinStandingsRow?.driverId || justinIdFromLookup;
const grounding = driverId ? factualGrounding.drivers[String(driverId)] : null;

const finishTrace = (grounding?.recentRaceFinishes || []).map((entry) => {
  const alignedRace = alignedRaces.find(
    (race) =>
      race.pointsRaceNumber === entry.raceNumber &&
      String(race.track || '').toLowerCase().includes(String(entry.track || '').toLowerCase().split(' ')[0])
  ) || alignedRaces.find((race) => race.pointsRaceNumber === entry.raceNumber);

  const finishInAligned = alignedRace?.finishes?.[String(driverId)] ?? null;
  const scheduleKey = alignedRace?.schedulesApiScheduleKey ?? null;
  const rawTrace = scheduleKey
    ? traceRawJsonPath(standingsPayload.schedules, scheduleKey, driverId)
    : null;

  const schedulePageRace = scheduleRaces.find(
    (race) => race.officialPointsRaceNumber === entry.raceNumber
  );

  const issues = [];
  if (finishInAligned !== entry.finish) {
    issues.push({
      type: 'aligned-vs-grounding-mismatch',
      alignedFinish: finishInAligned,
      groundingFinish: entry.finish,
    });
  }
  if (rawTrace && Number(rawTrace.finishPosFromRaw) !== Number(entry.finish)) {
    issues.push({
      type: 'raw-vs-grounding-mismatch',
      rawFinish: rawTrace.finishPosFromRaw,
      groundingFinish: entry.finish,
    });
  }
  if (rawTrace && !rawTrace.driverPresentInBucket) {
    issues.push({ type: 'non-participant-included', note: 'Driver ID absent from RACE bucket but finish present in grounding' });
  }
  if (rawTrace?.driverPresentInBucket === false && finishInAligned != null) {
    issues.push({ type: 'non-participant', note: 'Finish assigned but driver not in schedules bucket' });
  }
  if (
    rawTrace?.rawResult &&
    rawTrace.driverIdInRawResult &&
    String(rawTrace.driverIdInRawResult) !== String(driverId)
  ) {
    issues.push({
      type: 'driver-id-mismatch-in-raw',
      expectedDriverId: driverId,
      rawDriverId: rawTrace.driverIdInRawResult,
    });
  }

  return {
    raceNumber: entry.raceNumber,
    track: entry.track,
    finishPos: entry.finish,
    driverId,
    driverName: grounding?.driverName || justinStandingsRow?.driverName,
    alignment: alignedRace
      ? {
          alignmentMethod: alignedRace.alignmentMethod,
          schedulesApiScheduleKey: alignedRace.schedulesApiScheduleKey,
          schedulePageScheduleId: schedulePageRace?.scheduleId ?? null,
          scheduleRow: alignedRace.scheduleRow,
          winnerFromSchedulePage: alignedRace.winner,
          winnerDriverId: alignedRace.winnerDriverId,
          finishInAlignedMap: finishInAligned,
          schedulesApiFinishesCount: Object.keys(alignedRace.finishes || {}).length,
        }
      : null,
    rawSchedulesApi: rawTrace,
    issues,
  };
});

const rockinghamTrace = finishTrace.find(
  (row) =>
    /rockingham/i.test(row.track || '') ||
    /rockingham/i.test(row.alignment?.winnerFromSchedulePage || '') ||
    /rockingham/i.test(row.rawSchedulesApi?.eventName || '')
);

const duplicateNames = findDuplicateNames(standings, standingsPayload.drivers);
const justinNameCollisions = duplicateNames.filter((group) =>
  /justin|levine/.test(group.normalizedName)
);

const idConsistency = {
  driverIdUsedInGrounding: driverId,
  matchedViaNameLookup: justinIdFromLookup,
  standingsRowDriverId: justinStandingsRow?.driverId ?? null,
  driversApiEntry: driverId ? standingsPayload.drivers?.[driverId] ?? null : null,
  rpsDrid: justinStandingsRow?.rpsRow?.drid ?? null,
  idsConsistent:
    !driverId ||
    (String(justinStandingsRow?.driverId) === String(driverId) &&
      String(justinStandingsRow?.rpsRow?.drid) === String(driverId)),
};

const report = {
  auditTarget: TARGET_DRIVER,
  generatedAt: new Date().toISOString(),
  context: {
    raceNumberUsedForGrounding: raceNumber,
    latestCompletedPointsRace: latestRace?.officialPointsRaceNumber,
    standingsScheduleId: raceNumberDebug.standingsScheduleId,
    standingsSnapshotRace: raceNumberDebug.standingsRaceNumber,
    recentPointsRacesIncluded: alignedRaces.map((race) => ({
      pointsRaceNumber: race.pointsRaceNumber,
      track: race.track,
      alignmentMethod: race.alignmentMethod,
      schedulesApiScheduleKey: race.schedulesApiScheduleKey,
    })),
  },
  driverResolution: {
    ...idConsistency,
    standingsName: justinStandingsRow?.driverName,
    iracingName: justinStandingsRow?.iracingName,
    carNumber: justinStandingsRow?.carNumber,
    pointsPosition: justinStandingsRow?.position,
    racesCountedInStandings: justinStandingsRow?.races,
  },
  factualGroundingRecentRaceFinishes: grounding?.recentRaceFinishes ?? [],
  last3Summary: {
    last3RaceAverageFinish: grounding?.last3RaceAverageFinish ?? null,
    bestFinishLast3: grounding?.bestFinishLast3 ?? null,
    worstFinishLast3: grounding?.worstFinishLast3 ?? null,
  },
  perFinishTrace: finishTrace,
  rockinghamDeepTrace: rockinghamTrace ?? null,
  duplicateNameAnalysis: {
    justinLevineCollisions: justinNameCollisions,
    allDuplicateNormalizedNames: duplicateNames,
  },
  carNumberCollisions: findCarNumberCollisions(standings),
  conclusions: {
    wrongDriverAssignment: finishTrace.some((row) =>
      row.issues.some((issue) =>
        ['raw-vs-grounding-mismatch', 'driver-id-mismatch-in-raw', 'aligned-vs-grounding-mismatch'].includes(
          issue.type
        )
      )
    ),
    nonParticipantsIncluded: finishTrace.some((row) =>
      row.issues.some((issue) => issue.type === 'non-participant' || issue.type === 'non-participant-included')
    ),
    standingsVsSchedulesIdMismatch: !idConsistency.idsConsistent,
    duplicateNameOrCarJoinRisk:
      justinNameCollisions.length > 0 ||
      findCarNumberCollisions(standings).some((group) =>
        group.entries.some((entry) => String(entry.driverId) === String(driverId))
      ),
  },
  dataFlowSummary: [
    '1. get_standings.php returns schedules{} keyed by index; each schedule has drivers[race_id][driver_id] buckets.',
    '2. pickOfficialRaceBucket() selects the RACE session bucket (count_stats=Y).',
    '3. extractFinishRacesFromSchedules() builds finish maps per schedule_id.',
    '4. alignFinishRacesWithTrace() maps last 3 points races (from schedule page) to schedules API entries via winner driver ID match.',
    '5. buildDriverGrounding() reads race.finishes[driverId] for each aligned race → recentRaceFinishes.',
  ],
};

console.log(JSON.stringify(report, null, 2));
