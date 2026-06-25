import { extractScheduleIdFromResultLink } from './_caution-stats.js';
import { getCompletedPointsRaces } from './_schedule-points-races.js';
import { extractFinishRacesFromSchedules } from './_simracerhub-schedule-results.js';

export function deriveDriverActivityStatus({
  last5Starts = 0,
  last5WindowSize = 0,
  lastStartRaceNumber = null,
} = {}) {
  const starts = Number(last5Starts) || 0;
  const windowSize = Number(last5WindowSize) || 0;
  const parsedLastStart = Number(lastStartRaceNumber);
  const lastStart =
    lastStartRaceNumber != null && Number.isFinite(parsedLastStart) && parsedLastStart > 0
      ? parsedLastStart
      : null;

  const status = windowSize > 0 && starts === 0 ? 'Inactive' : 'Active';

  return { status, lastStartRaceNumber: lastStart };
}

function resolveScheduleRaceId(race) {
  if (race?.scheduleId != null) return String(race.scheduleId);
  const fromLink = extractScheduleIdFromResultLink(race?.link || '');
  return fromLink || null;
}

export function buildDriverActivityMap({
  scheduleRaces = [],
  srhSchedules = {},
  settings = null,
  now = new Date(),
} = {}) {
  const completed = getCompletedPointsRaces(scheduleRaces, { now, settings });
  const last5Races = completed.slice(-5);
  const last5RaceNumbers = new Set(
    last5Races.map((race) => Number(race.officialPointsRaceNumber)).filter(Number.isFinite)
  );
  const last5WindowSize = last5RaceNumbers.size;

  const scheduleIdToPointsRace = new Map();
  for (const race of completed) {
    const scheduleId = resolveScheduleRaceId(race);
    const pointsRaceNumber = Number(race.officialPointsRaceNumber);
    if (scheduleId && Number.isFinite(pointsRaceNumber)) {
      scheduleIdToPointsRace.set(scheduleId, pointsRaceNumber);
    }
  }

  const startsByDriver = new Map();

  for (const finishRace of extractFinishRacesFromSchedules(srhSchedules)) {
    const pointsRaceNumber = scheduleIdToPointsRace.get(String(finishRace.scheduleId));
    if (!Number.isFinite(pointsRaceNumber)) continue;

    for (const driverId of Object.keys(finishRace.finishes || {})) {
      const id = String(driverId);
      if (!startsByDriver.has(id)) startsByDriver.set(id, new Set());
      startsByDriver.get(id).add(pointsRaceNumber);
    }
  }

  const byDriverId = new Map();

  for (const [driverId, raceNumbers] of startsByDriver) {
    const sorted = [...raceNumbers].sort((a, b) => a - b);
    const last5Starts = sorted.filter((n) => last5RaceNumbers.has(n)).length;
    byDriverId.set(
      driverId,
      deriveDriverActivityStatus({
        last5Starts,
        last5WindowSize,
        lastStartRaceNumber: sorted[sorted.length - 1] ?? null,
      })
    );
  }

  return {
    byDriverId,
    last5WindowSize,
    getForDriverId(driverId) {
      const id = String(driverId);
      if (byDriverId.has(id)) return byDriverId.get(id);
      return deriveDriverActivityStatus({
        last5Starts: 0,
        last5WindowSize,
        lastStartRaceNumber: null,
      });
    },
  };
}
