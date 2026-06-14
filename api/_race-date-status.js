export const EASTERN_TIMEZONE = 'America/New_York';
export const RACE_DAY_ADVANCE_HOUR_ET = 21;

const MONTH_NAMES = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

export function getEasternDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function formatCurrentEasternTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

export function parseScheduleDateParts(dateStr) {
  const raw = String(dateStr || '').trim();
  if (!raw) return null;

  const match = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!match) return null;

  const month = MONTH_NAMES[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) {
    return null;
  }

  return { year, month, day };
}

function calendarDayIndex({ year, month, day }) {
  return year * 10000 + month * 100 + day;
}

export function hasRaceResults(race) {
  return Boolean(String(race?.winner ?? '').trim());
}

export function getEffectiveRaceDateStatus({
  raceDate,
  hasResults = false,
  now = new Date(),
} = {}) {
  const currentEasternTime = formatCurrentEasternTime(now);
  const eastern = getEasternDateParts(now);
  const raceParts = parseScheduleDateParts(raceDate);

  if (!raceParts) {
    return {
      isRaceDay: false,
      isCompleted: Boolean(hasResults),
      isUpcoming: !hasResults,
      canAdvanceToNextRace: Boolean(hasResults),
      currentEasternTime,
      raceDate: raceDate || null,
      raceStatus: hasResults ? 'completed' : 'unknown-date',
      advanceReason: hasResults ? 'results-posted' : 'invalid-race-date',
    };
  }

  const isRaceDay =
    eastern.year === raceParts.year &&
    eastern.month === raceParts.month &&
    eastern.day === raceParts.day;

  if (hasResults) {
    return {
      isRaceDay,
      isCompleted: true,
      isUpcoming: false,
      canAdvanceToNextRace: true,
      currentEasternTime,
      raceDate,
      raceStatus: 'completed',
      advanceReason: 'results-posted',
    };
  }

  const minutesSinceMidnight = eastern.hour * 60 + eastern.minute;
  const advanceThresholdMinutes = RACE_DAY_ADVANCE_HOUR_ET * 60;
  const pastAdvanceLock = minutesSinceMidnight >= advanceThresholdMinutes;

  if (isRaceDay && !pastAdvanceLock) {
    return {
      isRaceDay: true,
      isCompleted: false,
      isUpcoming: true,
      canAdvanceToNextRace: false,
      currentEasternTime,
      raceDate,
      raceStatus: 'upcoming-race-day-locked',
      advanceReason: 'race-day-before-9pm-et',
    };
  }

  if (isRaceDay && pastAdvanceLock) {
    return {
      isRaceDay: true,
      isCompleted: false,
      isUpcoming: false,
      canAdvanceToNextRace: true,
      currentEasternTime,
      raceDate,
      raceStatus: 'race-day-after-lock',
      advanceReason: 'race-day-after-9pm-et-no-results',
    };
  }

  const raceDayIndex = calendarDayIndex(raceParts);
  const todayIndex = calendarDayIndex(eastern);

  if (raceDayIndex > todayIndex) {
    return {
      isRaceDay: false,
      isCompleted: false,
      isUpcoming: true,
      canAdvanceToNextRace: false,
      currentEasternTime,
      raceDate,
      raceStatus: 'upcoming-future-date',
      advanceReason: 'future-race-date',
    };
  }

  return {
    isRaceDay: false,
    isCompleted: false,
    isUpcoming: false,
    canAdvanceToNextRace: true,
    currentEasternTime,
    raceDate,
    raceStatus: 'past-date-no-results',
    advanceReason: 'past-race-date-no-results',
  };
}

export function findEffectiveNextScheduleRace(races, { now = new Date() } = {}) {
  for (const race of races || []) {
    const hasResults = hasRaceResults(race);
    if (hasResults) continue;

    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults,
      now,
    });

    if (!status.canAdvanceToNextRace) {
      return { race, status };
    }
  }

  return { race: null, status: null };
}

export function countEffectiveCompletedScheduleRaces(races, { now = new Date() } = {}) {
  return (races || []).filter((race) => {
    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults: hasRaceResults(race),
      now,
    });
    return status.isCompleted;
  }).length;
}

export function findEffectiveNextPointsRace(enrichedRaces, { now = new Date() } = {}) {
  for (const race of enrichedRaces || []) {
    if (race.nonPoints) continue;

    const hasResults = hasRaceResults(race);
    if (hasResults) continue;

    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults,
      now,
    });

    if (!status.canAdvanceToNextRace) {
      return { race, status };
    }
  }

  return { race: null, status: null };
}

export function getEffectivePointsRaceProgression(enrichedRaces, { now = new Date() } = {}) {
  const currentEasternTime = formatCurrentEasternTime(now);
  let effectiveCompletedPointsCount = 0;
  let latestCompletedPointsRace = null;
  let currentUpcomingPointsRace = null;
  let currentUpcomingStatus = null;

  for (const race of enrichedRaces || []) {
    if (race.nonPoints) continue;

    const hasResults = hasRaceResults(race);
    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults,
      now,
    });

    if (status.isCompleted) {
      effectiveCompletedPointsCount += 1;
      latestCompletedPointsRace = race;
      continue;
    }

    if (!status.canAdvanceToNextRace) {
      currentUpcomingPointsRace = race;
      currentUpcomingStatus = status;
      break;
    }
  }

  const { race: nextPointsRace, status: nextRaceStatus } = findEffectiveNextPointsRace(
    enrichedRaces,
    { now }
  );

  const activeUpcomingRace = currentUpcomingPointsRace || nextPointsRace;
  const activeUpcomingStatus = currentUpcomingStatus || nextRaceStatus;
  const suggestedPointsRaceNumber =
    activeUpcomingRace?.officialPointsRaceNumber ??
    (effectiveCompletedPointsCount > 0 ? effectiveCompletedPointsCount + 1 : 1);

  return {
    currentEasternTime,
    effectiveCompletedPointsCount,
    latestCompletedPointsRace,
    currentUpcomingPointsRace: activeUpcomingRace,
    currentUpcomingStatus: activeUpcomingStatus,
    suggestedPointsRaceNumber,
    nextPointsRace,
    nextRaceStatus: activeUpcomingStatus,
  };
}

export function buildRaceProgressionDiagnostics(enrichedRaces, { now = new Date() } = {}) {
  const progression = getEffectivePointsRaceProgression(enrichedRaces, { now });
  const status = progression.currentUpcomingStatus;

  return {
    currentEasternTime: progression.currentEasternTime,
    raceDate: status?.raceDate ?? progression.currentUpcomingPointsRace?.date ?? null,
    raceStatus: status?.raceStatus ?? null,
    canAdvanceToNextRace: status?.canAdvanceToNextRace ?? null,
    advanceReason: status?.advanceReason ?? null,
    suggestedPointsRaceNumber: progression.suggestedPointsRaceNumber,
    effectiveCompletedPointsCount: progression.effectiveCompletedPointsCount,
    currentUpcomingPointsRaceNumber:
      progression.currentUpcomingPointsRace?.officialPointsRaceNumber ?? null,
  };
}
