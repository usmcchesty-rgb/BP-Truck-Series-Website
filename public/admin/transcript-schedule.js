/**
 * Transcript editor schedule helpers — canonical race number + track resolution.
 * Used by Broadcast Transcripts admin and regression tests.
 */

const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

export function isNonPointsScheduleRace(race) {
  const points = String(race?.points ?? '').trim().toLowerCase();
  const status = String(race?.status ?? '').trim().toLowerCase();
  const label = String(race?.track ?? race?.trackName ?? '');
  if (points === 'no' || status === 'non-points') return true;
  return NON_POINTS_LABEL_PATTERN.test(label);
}

function getScheduleRow(race) {
  const value = race?.scheduleRow ?? race?.raceNumber ?? race?.race_number;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Add officialPointsRaceNumber using the same points-race indexing as enrichScheduleRaces.
 * Does not reorder or filter the source schedule rows.
 */
export function enrichTranscriptScheduleRaces(rawRaces) {
  let officialPointsRaceNumber = 0;

  return (rawRaces || []).map((race) => {
    const scheduleRow = getScheduleRow(race);
    const nonPoints = isNonPointsScheduleRace(race);

    if (nonPoints) {
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
}

/**
 * Preferred resolution order for transcript canonical race numbers.
 */
export function resolveTranscriptRaceNumber(race) {
  if (!race) return null;

  if (race.nonPoints) {
    const official = Number(race.officialPointsRaceNumber);
    return Number.isFinite(official) && official > 0 ? official : null;
  }

  const candidates = [
    race.officialPointsRaceNumber,
    race.raceNumber,
    race.race_number,
    race.scheduleRaceNumber,
    race.scheduleRow,
  ];

  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return null;
}

export function resolveTranscriptTrackName(race) {
  if (!race) return 'TBD';
  const name = String(race.track || race.trackName || race.raceName || race.displayName || '').trim();
  return name || 'TBD';
}

export function buildTranscriptRaceOptionValue(race) {
  if (race?.nonPoints) {
    if (race?.scheduleId) return `schedule:${race.scheduleId}`;
    if (race?.scheduleRow != null) return `row:${race.scheduleRow}`;
    return '';
  }

  const canonical = resolveTranscriptRaceNumber(race);
  if (canonical != null) return String(canonical);
  if (race?.scheduleId) return `schedule:${race.scheduleId}`;
  if (race?.scheduleRow != null) return `row:${race.scheduleRow}`;
  return '';
}

export function formatTranscriptRaceOptionLabel(race) {
  const track = resolveTranscriptTrackName(race);
  const num = resolveTranscriptRaceNumber(race);
  if (num != null) return `Race ${num} — ${track}`;
  console.warn('[transcript-schedule] Unnumbered schedule row', {
    scheduleId: race?.scheduleId ?? null,
    scheduleRow: race?.scheduleRow ?? null,
    track,
  });
  return `Unnumbered race — ${track}`;
}

export function findTranscriptScheduleRace(scheduleRaces, optionValue) {
  const value = String(optionValue ?? '').trim();
  if (!value) return null;

  if (value.startsWith('schedule:')) {
    const scheduleId = value.slice('schedule:'.length);
    return scheduleRaces.find((race) => String(race.scheduleId || '') === scheduleId) || null;
  }

  if (value.startsWith('row:')) {
    const row = Number(value.slice('row:'.length));
    return scheduleRaces.find((race) => Number(race.scheduleRow) === row) || null;
  }

  const target = Number(value);
  if (!Number.isFinite(target) || target < 1) return null;

  return (
    scheduleRaces.find((race) => resolveTranscriptRaceNumber(race) === target) ||
    scheduleRaces.find((race) => Number(race.officialPointsRaceNumber) === target) ||
    null
  );
}

export function listTranscriptScheduleOptions(scheduleRaces) {
  return (scheduleRaces || [])
    .filter((race) => !race.nonPoints)
    .map((race) => ({
      value: buildTranscriptRaceOptionValue(race),
      label: formatTranscriptRaceOptionLabel(race),
      race,
    }))
    .filter((option) => option.value);
}

export function buildTranscriptSelectionDiagnostics({
  selectedOptionValue,
  race,
  savedTranscriptFound = false,
}) {
  return {
    selectedOptionValue: selectedOptionValue ?? null,
    resolvedRaceNumber: resolveTranscriptRaceNumber(race),
    officialPointsRaceNumber: race?.officialPointsRaceNumber ?? null,
    rawRaceNumber: race?.raceNumber ?? race?.race_number ?? null,
    scheduleId: race?.scheduleId ?? null,
    scheduleRow: race?.scheduleRow ?? null,
    resolvedTrackName: resolveTranscriptTrackName(race),
    savedTranscriptFound: Boolean(savedTranscriptFound),
  };
}
