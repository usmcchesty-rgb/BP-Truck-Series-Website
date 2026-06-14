/**
 * SimRacerHub standings API (`get_standings.php`) embeds per-race results under:
 *   schedules[index].drivers[race_id][driver_id] -> result object
 *
 * Each points race typically has 3 buckets: 2 SEGMENT sessions + 1 RACE session.
 * Use the RACE session (session === 'RACE', count_stats === 'Y') for official finishes.
 *
 * Reliable per-race fields (race-specific, RACE session):
 *   finish_pos, qualify_pos, laps_led, incidents, avg_pos, arp (average running position)
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
  ],
  seasonOnlyFields: ['wins', 't5', 't10', 'led', 'inc', 'tpts', 'pos2'],
  segmentOnlyUnreliable: true,
};

function parseFinish(value) {
  const finish = Number(value);
  return Number.isFinite(finish) && finish >= 1 ? finish : null;
}

function sampleResultFromBucket(bucket) {
  if (!bucket || typeof bucket !== 'object') return null;
  return Object.values(bucket).find((result) => result?.finish_pos != null) || null;
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

export function normalizeDriverRaceResult(result) {
  if (!result || typeof result !== 'object') return null;

  const finish = parseFinish(result.finish_pos ?? result.finish);
  if (!finish) return null;

  const startingPos = Number(result.qualify_pos);
  const lapsLed = Number(result.laps_led);
  const incidents = Number(result.incidents);
  const avgPos = Number(result.avg_pos);
  const arp = Number(result.arp);

  return {
    finish,
    startingPos: Number.isFinite(startingPos) && startingPos > 0 ? startingPos : null,
    lapsLed: Number.isFinite(lapsLed) ? lapsLed : null,
    incidents: Number.isFinite(incidents) ? incidents : null,
    averageRunningPosition: Number.isFinite(arp) ? arp : Number.isFinite(avgPos) ? avgPos : null,
    avgPos: Number.isFinite(avgPos) ? avgPos : null,
    session: result.session ?? null,
    countStats: result.count_stats ?? null,
    raceId: result.race_id ?? null,
  };
}

export function extractOfficialRaceFinishes(schedule) {
  const official = pickOfficialRaceBucket(schedule);
  if (!official) return { finishes: {}, driverResults: {}, meta: null };

  const finishes = {};
  const driverResults = {};

  for (const [driverId, result] of Object.entries(official.bucket)) {
    const normalized = normalizeDriverRaceResult(result);
    if (!normalized) continue;
    finishes[String(driverId)] = normalized.finish;
    driverResults[String(driverId)] = normalized;
  }

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
      driverCount: Object.keys(finishes).length,
      winnerDriverId: winnerEntry?.[0] ?? null,
    },
  };
}

export function extractFinishRacesFromSchedules(schedules) {
  const races = [];

  for (const [scheduleKey, schedule] of Object.entries(schedules || {})) {
    const { finishes, driverResults, meta } = extractOfficialRaceFinishes(schedule);
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
      driverCount: meta.driverCount,
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
