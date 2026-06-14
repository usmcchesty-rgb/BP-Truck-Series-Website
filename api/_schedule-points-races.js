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

export function getLatestCompletedPointsRace(scheduleRaces) {
  const completed = (scheduleRaces || []).filter(
    (race) => !race.nonPoints && race.winner && race.officialPointsRaceNumber != null
  );
  return completed.length ? completed[completed.length - 1] : null;
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

export function buildRaceNumberDebug(scheduleRaces, requestedRaceNumber) {
  const requested = Number(requestedRaceNumber);
  const currentRace = getPointsRaceByNumber(scheduleRaces, requested);
  const previousRace = getPointsRaceByNumber(scheduleRaces, requested - 1);
  const recentResults = getRecentPointsRaceResults(scheduleRaces, requested, 3);
  const latestCompleted = getLatestCompletedPointsRace(scheduleRaces);
  const standingsRace = resolveStandingsSnapshotRace(scheduleRaces, requested);
  const standingsRaceNumber = standingsRace?.officialPointsRaceNumber ?? null;

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
  };
}
