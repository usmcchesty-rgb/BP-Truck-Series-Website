import {
  buildRaceProgressionDiagnostics,
  getEffectiveRaceDateStatus,
  hasRaceResults,
} from './_race-date-status.js';

const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

export function getScheduleRow(race) {
  const value = race?.scheduleRow ?? race?.raceNumber;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isNonPointsRace(race) {
  const points = String(race?.points ?? '')
    .trim()
    .toLowerCase();
  const status = String(race?.status ?? '')
    .trim()
    .toLowerCase();
  const label = String(race?.track ?? '');

  if (points === 'no' || status === 'non-points') return true;
  return NON_POINTS_LABEL_PATTERN.test(label);
}

export function buildPointsRaceIndex(races) {
  let officialPointsRaceNumber = 0;
  const excludedNonPointsRaces = [];
  const enriched = (races || []).map((race) => {
    const scheduleRow = getScheduleRow(race);
    const nonPoints = isNonPointsRace(race);

    if (nonPoints) {
      excludedNonPointsRaces.push({
        scheduleRow,
        rawScheduleIndex: scheduleRow,
        track: race.track,
        date: race.date,
        points: race.points,
        status: race.status,
      });
      return {
        ...race,
        scheduleRow,
        nonPoints: true,
        officialPointsRaceNumber: null,
      };
    }

    officialPointsRaceNumber += 1;
    return {
      ...race,
      scheduleRow,
      nonPoints: false,
      officialPointsRaceNumber,
    };
  });

  return {
    races: enriched,
    excludedNonPointsCount: excludedNonPointsRaces.length,
    excludedNonPointsRaces,
  };
}

export function enrichScheduleRaces(parsedRaces) {
  return buildPointsRaceIndex(parsedRaces).races;
}

export function getPointsRaceByNumber(scheduleRaces, pointsRaceNumber) {
  const target = Number(pointsRaceNumber);
  if (!Number.isFinite(target) || target < 1) return null;

  return (
    scheduleRaces.find(
      (race) => !race.nonPoints && race.officialPointsRaceNumber === target
    ) || null
  );
}

export function getRecentPointsRaceResults(scheduleRaces, upToPointsRaceNumber, limit = 3) {
  const cutoff = Number(upToPointsRaceNumber);
  if (!Number.isFinite(cutoff) || cutoff < 1) return [];

  return scheduleRaces
    .filter(
      (race) =>
        !race.nonPoints &&
        race.winner &&
        race.officialPointsRaceNumber != null &&
        race.officialPointsRaceNumber <= cutoff
    )
    .slice(-limit);
}

export function getPointsRaceByScheduleId(scheduleRaces, scheduleId) {
  if (!scheduleId) return null;
  return (
    scheduleRaces.find(
      (race) =>
        !race.nonPoints &&
        race.scheduleId != null &&
        String(race.scheduleId) === String(scheduleId)
    ) || null
  );
}

export function getLatestCompletedPointsRace(scheduleRaces, { now = new Date(), settings = null } = {}) {
  let latest = null;

  for (const race of scheduleRaces || []) {
    if (race.nonPoints || race.officialPointsRaceNumber == null) continue;

    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults: hasRaceResults(race),
      now,
      settings,
    });

    if (status.isCompleted) {
      latest = race;
    }
  }

  return latest;
}

export function resolveSeasonScheduleProgress(
  scheduleRaces = [],
  { now = new Date(), settings = null } = {}
) {
  const pointsRaces = (scheduleRaces || []).filter((race) => !race.nonPoints);
  const totalPointsRaces = pointsRaces.length;
  let completedPointsRaces = 0;

  for (const race of pointsRaces) {
    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults: hasRaceResults(race),
      now,
      settings,
    });
    if (status.isCompleted) completedPointsRaces += 1;
  }

  const remainingPointsRaces = Math.max(0, totalPointsRaces - completedPointsRaces);
  const currentSeasonComplete =
    totalPointsRaces > 0 && completedPointsRaces >= totalPointsRaces;

  return {
    totalPointsRaces,
    completedPointsRaces,
    remainingPointsRaces,
    currentSeasonComplete,
  };
}

export function getCompletedPointsRaces(
  scheduleRaces,
  { now = new Date(), settings = null } = {}
) {
  const completed = [];

  for (const race of scheduleRaces || []) {
    if (race.nonPoints || race.officialPointsRaceNumber == null) continue;

    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults: hasRaceResults(race),
      now,
      settings,
    });

    if (status.isCompleted) {
      completed.push(race);
    }
  }

  return completed;
}

export function resolveStandingsSnapshotRace(scheduleRaces, requestedRaceNumber) {
  const requested = Number(requestedRaceNumber);
  const currentRace = getPointsRaceByNumber(scheduleRaces, requested);

  if (currentRace?.winner) {
    return currentRace;
  }

  const completedBefore = (scheduleRaces || []).filter(
    (race) =>
      !race.nonPoints &&
      race.winner &&
      race.officialPointsRaceNumber != null &&
      race.officialPointsRaceNumber < requested
  );

  return completedBefore.length ? completedBefore[completedBefore.length - 1] : null;
}

export function buildRaceNumberDebug(
  scheduleRaces,
  requestedRaceNumber,
  { now = new Date(), settings = null } = {}
) {
  const requested = Number(requestedRaceNumber);
  const currentRace = getPointsRaceByNumber(scheduleRaces, requested);
  const previousRace = getPointsRaceByNumber(scheduleRaces, requested - 1);
  const recentResults = getRecentPointsRaceResults(scheduleRaces, requested, 3);
  const latestCompleted = getLatestCompletedPointsRace(scheduleRaces, { now, settings });
  const standingsRace = resolveStandingsSnapshotRace(scheduleRaces, requested);
  const standingsRaceNumber = standingsRace?.officialPointsRaceNumber ?? null;
  const requestedRaceStatus = currentRace
    ? getEffectiveRaceDateStatus({
        raceDate: currentRace.date,
        hasResults: hasRaceResults(currentRace),
        now,
        settings,
      })
    : null;
  const raceProgression = buildRaceProgressionDiagnostics(scheduleRaces, { now, settings });
  const progressionSource = requestedRaceStatus || raceProgression;

  return {
    requestedRaceNumber: requested,
    resolvedPointsRaceNumber: currentRace?.officialPointsRaceNumber ?? null,
    resolvedScheduleRow: currentRace?.scheduleRow ?? null,
    currentRaceName: currentRace?.track ?? null,
    previousRaceName: previousRace?.track ?? null,
    recentResultsRaceNumbers: recentResults.map((race) => race.officialPointsRaceNumber),
    recentResultsTracks: recentResults.map((race) => race.track),
    excludedNonPointsCount: scheduleRaces.filter((race) => race.nonPoints).length,
    standingsRaceNumber,
    standingsSnapshotDate: standingsRace?.date ?? null,
    statsRaceNumber: standingsRaceNumber,
    latestCompletedRaceNumber: latestCompleted?.officialPointsRaceNumber ?? null,
    standingsScheduleId: standingsRace?.scheduleId ?? null,
    standingsScheduleRow: standingsRace?.scheduleRow ?? null,
    standingsTrack: standingsRace?.track ?? null,
    standingsFrozenToRequestedRace: standingsRaceNumber === requested,
    usingFutureStandings: false,
    standingsSnapshotSource: currentRace?.winner
      ? 'requested-race-completed'
      : standingsRace
        ? 'latest-completed-before-requested'
        : 'none',
    currentEasternTime: raceProgression.currentEasternTime,
    raceDate: requestedRaceStatus?.raceDate ?? currentRace?.date ?? raceProgression.raceDate,
    configuredRaceStartTime:
      progressionSource?.configuredRaceStartTime ?? raceProgression.configuredRaceStartTime,
    completionBufferMinutes:
      progressionSource?.completionBufferMinutes ?? raceProgression.completionBufferMinutes,
    effectiveAdvanceTime:
      progressionSource?.effectiveAdvanceTime ?? raceProgression.effectiveAdvanceTime,
    raceStatus: requestedRaceStatus?.raceStatus ?? raceProgression.raceStatus,
    canAdvanceToNextRace:
      requestedRaceStatus?.canAdvanceToNextRace ?? raceProgression.canAdvanceToNextRace,
    advanceReason: requestedRaceStatus?.advanceReason ?? raceProgression.advanceReason,
    suggestedPointsRaceNumber: raceProgression.suggestedPointsRaceNumber,
    effectiveCompletedPointsCount: raceProgression.effectiveCompletedPointsCount,
    currentUpcomingPointsRaceNumber: raceProgression.currentUpcomingPointsRaceNumber,
  };
}
