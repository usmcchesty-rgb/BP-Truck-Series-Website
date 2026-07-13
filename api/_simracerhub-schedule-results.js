/**
 * SimRacerHub standings API (`get_standings.php`) embeds per-race results under:
 *   schedules[index].drivers[race_id][driver_id] -> result object
 *
 * Each points race typically has 3 buckets: 2 SEGMENT sessions + 1 RACE session.
 * Use the RACE session (session === 'RACE', count_stats === 'Y') for official finishes.
 *
 * Reliable per-race fields (race-specific, RACE session):
 *   finish_pos, qualify_pos, laps_led, incidents, avg_pos, arp (average running position)
 *   provisional ('Y'|'N'), status ('Provisional' for league provisionals)
 *
 * Season-only fields (rps row — NOT race-specific):
 *   wins, t5, t10, led, inc, tpts, pos2, etc.
 *
 * Not present as structured incident detail — only incidents count per race.
 */

export const SIMRACERHUB_DATA_AUDIT = {
  source: 'get_standings.php schedules.drivers',
  nestedShape: 'schedules[].drivers[race_id][driver_id]',
  officialSession: 'RACE (count_stats=Y, session_num=0.0)',
  reliablePerRaceFields: [
    'finish_pos',
    'qualify_pos',
    'laps_led',
    'incidents',
    'avg_pos',
    'arp',
    'provisional',
    'status',
  ],
  provisionalFields: {
    flag: 'provisional',
    flagValue: 'Y',
    status: 'status',
    statusValue: 'Provisional',
  },
  seasonOnlyFields: ['wins', 't5', 't10', 'led', 'inc', 'tpts', 'pos2'],
  segmentOnlyUnreliable: true,
};

function parseFinish(value) {
  const finish = Number(value);
  return Number.isFinite(finish) && finish >= 1 ? finish : null;
}

export function isProvisionalRawResult(result) {
  if (!result || typeof result !== 'object') return false;
  if (String(result.provisional || '').toUpperCase() === 'Y') return true;
  return String(result.status || '').trim().toLowerCase() === 'provisional';
}

export function sampleResultFromBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  return (
    Object.values(bucket).find((result) => result?.finish_pos != null) ||
    Object.values(bucket).find((result) => isProvisionalRawResult(result)) ||
    null
  );
}

export function pickOfficialRaceBucket(schedule) {
  const buckets = [];

  for (const [bucketKey, bucket] of Object.entries(schedule?.drivers || {})) {
    const sample = sampleResultFromBucket(bucket);
    if (!sample) continue;
    buckets.push({
      bucketKey,
      bucket,
      sample,
      session: String(sample.session || '').toUpperCase(),
      countStats: String(sample.count_stats || '').toUpperCase(),
      sessionNum: Number(sample.session_num ?? -999),
    });
  }

  if (!buckets.length) return null;

  const raceSession = buckets.find((entry) => entry.session === 'RACE');
  if (raceSession) return raceSession;

  const countedSession = buckets.find((entry) => entry.countStats === 'Y');
  if (countedSession) return countedSession;

  return buckets.sort((a, b) => b.sessionNum - a.sessionNum)[0];
}

function readRawStatus(result) {
  const status = String(result?.status || '').trim();
  return status || null;
}

function inferProvisionalType(rawResult) {
  const explicit = String(rawResult?.provisional_type || rawResult?.provisionalType || '').toLowerCase();
  if (explicit === 'free' || explicit === 'purchased') return explicit;
  return null;
}

export function buildCanonicalOfficialRaceResult(driverId, rawResult, options = {}) {
  const finish = options.assignedFinishPosition ?? parseFinish(rawResult?.finish_pos ?? rawResult?.finish);
  const isProvisional = Boolean(options.isProvisional ?? isProvisionalRawResult(rawResult));
  const startingPosRaw = Number(rawResult?.qualify_pos);
  const startingPos =
    Number.isFinite(startingPosRaw) && startingPosRaw > 0 ? startingPosRaw : null;
  const lapsLed = Number(rawResult?.laps_led);
  const incidents = Number(rawResult?.incidents);
  const avgPos = Number(rawResult?.avg_pos);
  const arp = Number(rawResult?.arp);
  const totalPoints = Number(rawResult?.total_points ?? rawResult?.points ?? rawResult?.race_points);
  const rawStatus = readRawStatus(rawResult);
  const participationStatus = isProvisional
    ? 'provisional'
    : finish
      ? 'started'
      : rawStatus
        ? String(rawStatus).toLowerCase()
        : 'dns';

  return {
    driverId: String(driverId),
    iracingId: rawResult?.driver_id != null ? String(rawResult.driver_id) : String(driverId),
    driverName: null,
    carNumber: null,
    startPosition: startingPos,
    finishPosition: finish,
    finish,
    startingPos,
    status: isProvisional ? 'Provisional' : rawStatus,
    participationStatus,
    isProvisional,
    provisionalType: isProvisional ? inferProvisionalType(rawResult) : null,
    officialResultFound: true,
    source: 'simracerhub',
    lapsLed: Number.isFinite(lapsLed) ? lapsLed : null,
    incidents: Number.isFinite(incidents) ? incidents : null,
    points: Number.isFinite(totalPoints) ? totalPoints : null,
    averageRunningPosition: Number.isFinite(arp) ? arp : Number.isFinite(avgPos) ? avgPos : null,
    avgPos: Number.isFinite(avgPos) ? avgPos : null,
    session: rawResult?.session ?? null,
    countStats: rawResult?.count_stats ?? null,
    raceId: rawResult?.race_id ?? null,
    assignedFinishPosition: isProvisional ? finish : null,
    rawProvisional: rawResult?.provisional ?? null,
    rawStatus,
  };
}

export function normalizeDriverRaceResult(result, options = {}) {
  if (!result || typeof result !== 'object') return null;

  const isProvisional = Boolean(options.isProvisional ?? isProvisionalRawResult(result));
  const finish = isProvisional
    ? options.assignedFinishPosition ?? null
    : parseFinish(result.finish_pos ?? result.finish);

  if (!isProvisional && !finish) return null;
  if (isProvisional && !Number.isFinite(Number(options.assignedFinishPosition))) return null;

  return buildCanonicalOfficialRaceResult(String(options.driverId || result.driver_id || ''), result, {
    isProvisional,
    assignedFinishPosition: isProvisional ? Number(options.assignedFinishPosition) : finish,
  });
}

export function extractOfficialRaceField(schedule) {
  const official = pickOfficialRaceBucket(schedule);
  if (!official) {
    return {
      finishes: {},
      driverResults: {},
      meta: null,
    };
  }

  const physicalEntries = [];
  const provisionalEntries = [];

  for (const [driverId, rawResult] of Object.entries(official.bucket)) {
    if (isProvisionalRawResult(rawResult)) {
      provisionalEntries.push({ driverId: String(driverId), rawResult });
      continue;
    }
    const finish = parseFinish(rawResult.finish_pos ?? rawResult.finish);
    if (finish) {
      physicalEntries.push({ driverId: String(driverId), rawResult, finish });
    }
  }

  physicalEntries.sort((a, b) => a.finish - b.finish);

  const officialStarterCount = physicalEntries.length;
  const provisionalCount = provisionalEntries.length;
  const totalScoredFieldCount = officialStarterCount + provisionalCount;

  const finishes = {};
  const driverResults = {};

  for (const entry of physicalEntries) {
    const normalized = normalizeDriverRaceResult(entry.rawResult, {
      driverId: entry.driverId,
      isProvisional: false,
    });
    if (!normalized) continue;
    finishes[entry.driverId] = normalized.finish;
    driverResults[entry.driverId] = normalized;
  }

  provisionalEntries.forEach((entry, index) => {
    const assignedFinish = officialStarterCount + index + 1;
    const normalized = normalizeDriverRaceResult(entry.rawResult, {
      driverId: entry.driverId,
      isProvisional: true,
      assignedFinishPosition: assignedFinish,
    });
    if (!normalized) return;
    finishes[entry.driverId] = assignedFinish;
    driverResults[entry.driverId] = normalized;
  });

  const winnerEntry = Object.entries(finishes).find(([, finish]) => finish === 1);

  return {
    finishes,
    driverResults,
    meta: {
      bucketKey: official.bucketKey,
      raceId: official.sample?.race_id ?? null,
      session: official.sample?.session ?? null,
      sessionNum: official.sample?.session_num ?? null,
      countStats: official.sample?.count_stats ?? null,
      bucketDriverCount: Object.keys(official.bucket).length,
      driverCount: totalScoredFieldCount,
      officialStarterCount,
      provisionalCount,
      totalScoredFieldCount,
      provisionalDriverIds: provisionalEntries.map((entry) => entry.driverId),
      winnerDriverId: winnerEntry?.[0] ?? null,
    },
  };
}

export function extractOfficialRaceFinishes(schedule) {
  const field = extractOfficialRaceField(schedule);
  return {
    finishes: field.finishes,
    driverResults: field.driverResults,
    meta: field.meta,
  };
}

export function countOfficialRaceStarters(schedule) {
  const official = pickOfficialRaceBucket(schedule);
  if (!official?.bucket) {
    return {
      starterCount: null,
      finisherCount: null,
      provisionalCount: null,
      totalScoredFieldCount: null,
      bucketKey: null,
    };
  }

  const field = extractOfficialRaceField(schedule);

  return {
    starterCount: field.meta?.bucketDriverCount ?? Object.keys(official.bucket).length,
    finisherCount: field.meta?.officialStarterCount ?? null,
    provisionalCount: field.meta?.provisionalCount ?? 0,
    totalScoredFieldCount: field.meta?.totalScoredFieldCount ?? null,
    bucketKey: field.meta?.bucketKey ?? official.bucketKey,
  };
}

export function findScheduleEntryByScheduleId(schedules, scheduleId) {
  if (!scheduleId) return null;
  for (const schedule of Object.values(schedules || {})) {
    if (String(schedule.schedule_id) === String(scheduleId)) return schedule;
  }
  return null;
}

export function extractSegmentResultsForDriver(schedule, driverId) {
  if (!schedule?.drivers || driverId == null) return [];

  const segmentBuckets = [];
  for (const [, bucket] of Object.entries(schedule.drivers)) {
    const sample = sampleResultFromBucket(bucket);
    if (!sample) continue;
    if (String(sample.session || '').toUpperCase() !== 'SEGMENT') continue;
    segmentBuckets.push({
      sessionNum: Number(sample.session_num ?? 0),
      bucket,
    });
  }

  segmentBuckets.sort((a, b) => a.sessionNum - b.sessionNum);

  return segmentBuckets
    .map((entry, index) => {
      const normalized = normalizeDriverRaceResult(entry.bucket[String(driverId)]);
      if (!normalized?.finish) return null;
      return {
        stage: index + 1,
        finish: normalized.finish,
        points: normalized.points,
      };
    })
    .filter(Boolean);
}

export function extractFinishRacesFromSchedules(schedules) {
  const races = [];

  for (const [scheduleKey, schedule] of Object.entries(schedules || {})) {
    const { finishes, driverResults, meta } = extractOfficialRaceField(schedule);
    if (!Object.keys(finishes).length || !meta) continue;

    races.push({
      scheduleKey,
      scheduleId: schedule.schedule_id ?? null,
      raceId: meta.raceId,
      raceDate: schedule.race_date ?? null,
      finishes,
      driverResults,
      winnerDriverId: meta.winnerDriverId,
      session: meta.session,
      countStats: meta.countStats,
      driverCount: meta.totalScoredFieldCount,
      officialStarterCount: meta.officialStarterCount,
      provisionalCount: meta.provisionalCount,
      totalScoredFieldCount: meta.totalScoredFieldCount,
      provisionalDriverIds: meta.provisionalDriverIds || [],
    });
  }

  return races;
}

export function summarizeLast3Finishes(recentRaceFinishes) {
  const finishes = (recentRaceFinishes || [])
    .map((entry) => Number(entry.finish))
    .filter((value) => Number.isFinite(value) && value >= 1);

  if (!finishes.length) {
    return {
      last3RaceAverageFinish: null,
      bestFinishLast3: null,
      worstFinishLast3: null,
    };
  }

  const total = finishes.reduce((sum, value) => sum + value, 0);
  return {
    last3RaceAverageFinish: Number((total / finishes.length).toFixed(1)),
    bestFinishLast3: Math.min(...finishes),
    worstFinishLast3: Math.max(...finishes),
  };
}

export function summarizeLast3RaceWindow(recentRaceFinishes, alignedWindowRaces = [], driverId = null) {
  const finishSummary = summarizeLast3Finishes(recentRaceFinishes);
  const window = Array.isArray(alignedWindowRaces) ? alignedWindowRaces : [];
  const last3RaceWindowSize = window.length;
  const missedRecentRaces = window
    .filter((race) => {
      if (!driverId) return false;
      const finish = race.finishes?.[String(driverId)];
      return !Number.isFinite(finish);
    })
    .map((race) => ({
      raceNumber: race.pointsRaceNumber,
      track: race.track,
    }));
  const last3RaceStarts = (recentRaceFinishes || []).length;
  const last3RaceDnpCount = missedRecentRaces.length;
  const missedRecentRaceNames = missedRecentRaces
    .map((race) => race.track)
    .filter(Boolean);

  return {
    ...finishSummary,
    last3RaceStarts,
    last3RaceWindowSize,
    last3RaceDnpCount,
    missedRecentRaceNames,
    missedRecentRaces,
  };
}
