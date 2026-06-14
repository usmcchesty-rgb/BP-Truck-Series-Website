export const EASTERN_TIMEZONE = 'America/New_York';
export const DEFAULT_RACE_START_TIME = '9:00 PM ET';
export const DEFAULT_RACE_START_MINUTES_ET = 21 * 60;
export const DEFAULT_COMPLETION_BUFFER_MINUTES = 180;

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

export function parseRaceStartTimeToMinutes(raceStartTime) {
  const raw = String(raceStartTime || '').trim();
  if (!raw) return null;

  const match12 = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (match12) {
    let hour = Number(match12[1]);
    const minute = Number(match12[2] || 0);
    const ampm = match12[3].toUpperCase();

    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

    if (hour === 12) hour = ampm === 'AM' ? 0 : 12;
    else if (ampm === 'PM') hour += 12;

    return hour * 60 + minute;
  }

  const match24 = raw.match(/\b(\d{1,2}):(\d{2})\b/);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return hour * 60 + minute;
    }
  }

  return null;
}

export function formatMinutesAsEasternTime(totalMinutes) {
  const minutesInDay = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour24 = Math.floor(minutesInDay / 60);
  const minute = minutesInDay % 60;
  const hour12 = hour24 % 12 || 12;
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  return `${hour12}:${String(minute).padStart(2, '0')} ${ampm} ET`;
}

export function resolveRaceProgressionSettings(settings = {}) {
  const rawStartTime = String(settings.raceStartTime || '').trim();
  const parsedStart = parseRaceStartTimeToMinutes(rawStartTime);
  const completionBufferMinutes = normalizeCompletionBufferMinutes(
    settings.raceCompletionBufferMinutes
  );

  if (parsedStart == null) {
    return {
      configuredRaceStartTime: rawStartTime || DEFAULT_RACE_START_TIME,
      configuredRaceStartMinutes: null,
      completionBufferMinutes,
      effectiveAdvanceMinutes: DEFAULT_RACE_START_MINUTES_ET,
      effectiveAdvanceTime: DEFAULT_RACE_START_TIME,
      usingFallbackStart: true,
    };
  }

  const effectiveAdvanceMinutes = parsedStart + completionBufferMinutes;

  return {
    configuredRaceStartTime: rawStartTime,
    configuredRaceStartMinutes: parsedStart,
    completionBufferMinutes,
    effectiveAdvanceMinutes,
    effectiveAdvanceTime: formatMinutesAsEasternTime(effectiveAdvanceMinutes),
    usingFallbackStart: false,
  };
}

function normalizeCompletionBufferMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_COMPLETION_BUFFER_MINUTES;
  }
  return Math.round(parsed);
}

export function normalizeProgressionOptions(options = {}) {
  if (options.progressionSettings) {
    return options.progressionSettings;
  }

  if (
    options.raceStartTime != null ||
    options.completionBufferMinutes != null ||
    options.raceCompletionBufferMinutes != null
  ) {
    return resolveRaceProgressionSettings({
      raceStartTime: options.raceStartTime,
      raceCompletionBufferMinutes:
        options.completionBufferMinutes ?? options.raceCompletionBufferMinutes,
    });
  }

  if (options.settings) {
    return resolveRaceProgressionSettings(options.settings);
  }

  return resolveRaceProgressionSettings({});
}

function calendarDayIndex({ year, month, day }) {
  return year * 10000 + month * 100 + day;
}

function isPastEffectiveAdvanceOnRaceDay(eastern, progressionSettings) {
  const minutesSinceMidnight = eastern.hour * 60 + eastern.minute;
  const advanceThresholdMinutes = progressionSettings.effectiveAdvanceMinutes;

  if (advanceThresholdMinutes < 24 * 60) {
    return minutesSinceMidnight >= advanceThresholdMinutes;
  }

  return false;
}

function buildStatusPayload({
  isRaceDay,
  isCompleted,
  isUpcoming,
  canAdvanceToNextRace,
  currentEasternTime,
  raceDate,
  raceStatus,
  advanceReason,
  progressionSettings,
}) {
  return {
    isRaceDay,
    isCompleted,
    isUpcoming,
    canAdvanceToNextRace,
    raceDate,
    configuredRaceStartTime: progressionSettings.configuredRaceStartTime,
    completionBufferMinutes: progressionSettings.completionBufferMinutes,
    effectiveAdvanceTime: progressionSettings.effectiveAdvanceTime,
    currentEasternTime,
    raceStatus,
    advanceReason,
  };
}

export function hasRaceResults(race) {
  return Boolean(String(race?.winner ?? '').trim());
}

export function getEffectiveRaceDateStatus({
  raceDate,
  hasResults = false,
  now = new Date(),
  settings = null,
  raceStartTime = null,
  completionBufferMinutes = null,
  progressionSettings = null,
} = {}) {
  const resolvedProgression =
    progressionSettings ||
    normalizeProgressionOptions({
      settings,
      raceStartTime,
      completionBufferMinutes,
    });
  const currentEasternTime = formatCurrentEasternTime(now);
  const eastern = getEasternDateParts(now);
  const raceParts = parseScheduleDateParts(raceDate);

  if (!raceParts) {
    return buildStatusPayload({
      isRaceDay: false,
      isCompleted: Boolean(hasResults),
      isUpcoming: !hasResults,
      canAdvanceToNextRace: Boolean(hasResults),
      currentEasternTime,
      raceDate: raceDate || null,
      raceStatus: hasResults ? 'completed' : 'unknown-date',
      advanceReason: hasResults ? 'results-posted' : 'invalid-race-date',
      progressionSettings: resolvedProgression,
    });
  }

  const isRaceDay =
    eastern.year === raceParts.year &&
    eastern.month === raceParts.month &&
    eastern.day === raceParts.day;

  if (hasResults) {
    return buildStatusPayload({
      isRaceDay,
      isCompleted: true,
      isUpcoming: false,
      canAdvanceToNextRace: true,
      currentEasternTime,
      raceDate,
      raceStatus: 'completed',
      advanceReason: 'results-posted',
      progressionSettings: resolvedProgression,
    });
  }

  const pastAdvanceLock = isPastEffectiveAdvanceOnRaceDay(eastern, resolvedProgression);

  if (isRaceDay && !pastAdvanceLock) {
    return buildStatusPayload({
      isRaceDay: true,
      isCompleted: false,
      isUpcoming: true,
      canAdvanceToNextRace: false,
      currentEasternTime,
      raceDate,
      raceStatus: 'upcoming-race-day-locked',
      advanceReason: resolvedProgression.usingFallbackStart
        ? 'race-day-before-fallback-completion-window'
        : 'race-day-before-configured-completion-window',
      progressionSettings: resolvedProgression,
    });
  }

  if (isRaceDay && pastAdvanceLock) {
    return buildStatusPayload({
      isRaceDay: true,
      isCompleted: false,
      isUpcoming: false,
      canAdvanceToNextRace: true,
      currentEasternTime,
      raceDate,
      raceStatus: 'race-day-after-lock',
      advanceReason: resolvedProgression.usingFallbackStart
        ? 'race-day-after-fallback-completion-window'
        : 'race-day-after-configured-completion-window',
      progressionSettings: resolvedProgression,
    });
  }

  const raceDayIndex = calendarDayIndex(raceParts);
  const todayIndex = calendarDayIndex(eastern);

  if (raceDayIndex > todayIndex) {
    return buildStatusPayload({
      isRaceDay: false,
      isCompleted: false,
      isUpcoming: true,
      canAdvanceToNextRace: false,
      currentEasternTime,
      raceDate,
      raceStatus: 'upcoming-future-date',
      advanceReason: 'future-race-date',
      progressionSettings: resolvedProgression,
    });
  }

  return buildStatusPayload({
    isRaceDay: false,
    isCompleted: false,
    isUpcoming: false,
    canAdvanceToNextRace: true,
    currentEasternTime,
    raceDate,
    raceStatus: 'past-date-no-results',
    advanceReason: 'past-race-date-no-results',
    progressionSettings: resolvedProgression,
  });
}

function buildStatusOptions(options = {}) {
  const progressionSettings = normalizeProgressionOptions(options);
  return { ...options, progressionSettings };
}

export function findEffectiveNextScheduleRace(races, options = {}) {
  const { now = new Date(), progressionSettings } = buildStatusOptions(options);

  for (const race of races || []) {
    const hasResults = hasRaceResults(race);
    if (hasResults) continue;

    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults,
      now,
      progressionSettings,
    });

    if (!status.canAdvanceToNextRace) {
      return { race, status };
    }
  }

  return { race: null, status: null };
}

export function countEffectiveCompletedScheduleRaces(races, options = {}) {
  const { now = new Date(), progressionSettings } = buildStatusOptions(options);

  return (races || []).filter((race) => {
    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults: hasRaceResults(race),
      now,
      progressionSettings,
    });
    return status.isCompleted;
  }).length;
}

export function findEffectiveNextPointsRace(enrichedRaces, options = {}) {
  const { now = new Date(), progressionSettings } = buildStatusOptions(options);

  for (const race of enrichedRaces || []) {
    if (race.nonPoints) continue;

    const hasResults = hasRaceResults(race);
    if (hasResults) continue;

    const status = getEffectiveRaceDateStatus({
      raceDate: race.date,
      hasResults,
      now,
      progressionSettings,
    });

    if (!status.canAdvanceToNextRace) {
      return { race, status };
    }
  }

  return { race: null, status: null };
}

export function getEffectivePointsRaceProgression(enrichedRaces, options = {}) {
  const { now = new Date(), progressionSettings } = buildStatusOptions(options);
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
      progressionSettings,
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
    { now, progressionSettings }
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
    progressionSettings,
  };
}

export function buildRaceProgressionDiagnostics(enrichedRaces, options = {}) {
  const progression = getEffectivePointsRaceProgression(enrichedRaces, options);
  const status = progression.currentUpcomingStatus;
  const progressionSettings = progression.progressionSettings;

  return {
    currentEasternTime: progression.currentEasternTime,
    raceDate: status?.raceDate ?? progression.currentUpcomingPointsRace?.date ?? null,
    configuredRaceStartTime: progressionSettings?.configuredRaceStartTime ?? null,
    completionBufferMinutes: progressionSettings?.completionBufferMinutes ?? null,
    effectiveAdvanceTime: progressionSettings?.effectiveAdvanceTime ?? null,
    raceStatus: status?.raceStatus ?? null,
    canAdvanceToNextRace: status?.canAdvanceToNextRace ?? null,
    advanceReason: status?.advanceReason ?? null,
    suggestedPointsRaceNumber: progression.suggestedPointsRaceNumber,
    effectiveCompletedPointsCount: progression.effectiveCompletedPointsCount,
    currentUpcomingPointsRaceNumber:
      progression.currentUpcomingPointsRace?.officialPointsRaceNumber ?? null,
  };
}
