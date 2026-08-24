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

function extractScheduleId(race) {
  if (race?.scheduleId != null && String(race.scheduleId).trim()) {
    return String(race.scheduleId).trim();
  }
  const match = String(race?.link || '').match(/[?&]schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

function openingDuelLetter(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 26) return null;
  return String.fromCharCode(64 + ordinal);
}

/**
 * Public Season 11 display labels:
 * opening duels before the first points race → 1A, 1B, …
 * normal championship races → "1", "2", … (official points index)
 */
export function attachDisplayRaceLabels(races = []) {
  let openingDuelOrdinal = 0;
  let seenPointsRace = false;

  return (races || []).map((race) => {
    const scheduleId = extractScheduleId(race);
    const scheduleRow = getScheduleRow(race);
    const nonPoints = race.nonPoints === true || isNonPointsRace(race);

    if (nonPoints) {
      let isOpeningDuel = false;
      let duelCode = null;
      let displayRaceLabel = null;

      if (!seenPointsRace) {
        openingDuelOrdinal += 1;
        isOpeningDuel = true;
        duelCode = openingDuelLetter(openingDuelOrdinal);
        displayRaceLabel = duelCode ? `1${duelCode}` : null;
      }

      return {
        ...race,
        scheduleRow,
        scheduleId,
        nonPoints: true,
        isOpeningDuel,
        duelCode,
        displayRaceLabel,
        countsAsNormalChampionshipRace: false,
        officialPointsRaceNumber: race.officialPointsRaceNumber ?? null,
      };
    }

    seenPointsRace = true;
    const officialPointsRaceNumber = Number(race.officialPointsRaceNumber);
    const label =
      Number.isFinite(officialPointsRaceNumber) && officialPointsRaceNumber > 0
        ? String(officialPointsRaceNumber)
        : null;

    return {
      ...race,
      scheduleRow,
      scheduleId,
      nonPoints: false,
      isOpeningDuel: false,
      duelCode: null,
      displayRaceLabel: label,
      countsAsNormalChampionshipRace: true,
      officialPointsRaceNumber: Number.isFinite(officialPointsRaceNumber)
        ? officialPointsRaceNumber
        : null,
    };
  });
}

export function formatRaceDisplayTitle(raceOrLabel) {
  if (raceOrLabel == null) return 'Race';
  if (typeof raceOrLabel === 'string' || typeof raceOrLabel === 'number') {
    const label = String(raceOrLabel).trim();
    return label ? `Race ${label}` : 'Race';
  }
  const label = String(raceOrLabel.displayRaceLabel || '').trim();
  if (label) return `Race ${label}`;
  if (raceOrLabel.officialPointsRaceNumber != null) {
    return `Race ${raceOrLabel.officialPointsRaceNumber}`;
  }
  return 'Race';
}

export function buildSiteResultsUrl(race) {
  if (!race || !hasRaceResults(race)) return null;
  const scheduleId = extractScheduleId(race);
  if (scheduleId) {
    return `/results.html?scheduleId=${encodeURIComponent(scheduleId)}`;
  }
  const label = String(race.displayRaceLabel || '').trim();
  if (label) {
    return `/results.html?race=${encodeURIComponent(label)}`;
  }
  if (race.officialPointsRaceNumber != null) {
    return `/results.html?race=${encodeURIComponent(
      String(race.officialPointsRaceNumber)
    )}`;
  }
  return null;
}

export function resolveRaceForResultsQuery(
  enrichedRaces = [],
  { scheduleId = null, race = null, raceNumber = null, raceLabel = null } = {}
) {
  const list = enrichedRaces || [];

  if (scheduleId != null && String(scheduleId).trim()) {
    const id = String(scheduleId).trim();
    const byId = list.find((row) => String(row.scheduleId || '') === id);
    if (byId) return byId;
  }

  const raw = String(raceLabel || race || raceNumber || '').trim();
  if (!raw) return null;

  if (/^\d+[A-Za-z]$/i.test(raw)) {
    const needle = raw.toUpperCase();
    return (
      list.find(
        (row) => String(row.displayRaceLabel || '').toUpperCase() === needle
      ) || null
    );
  }

  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return getPointsRaceByNumber(list, n);
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
    races: attachDisplayRaceLabels(enriched),
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
