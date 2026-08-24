/**
 * Season championship structure, race counts, and playoff phase derivation.
 *
 * Display race labels (1A / 1B / 1 / 2…) live in `_schedule-points-races.js`.
 * This module owns regular-season vs playoff structure for Season 11.
 */

import {
  buildSiteResultsUrl,
  getLatestCompletedPointsRace,
} from './_schedule-points-races.js';
import {
  getEffectiveRaceDateStatus,
  hasRaceResults,
} from './_race-date-status.js';

/** Confirmed Season 11: 20 regular + 10 playoff (3+3+4) = 30 championship races. */
export const SEASON_CHAMPIONSHIP_STRUCTURE = {
  regularSeasonRaces: 20,
  playoffQualifierCut: 16,
  playoffRounds: [
    {
      id: 'round_1',
      roundName: 'ROUND 1',
      raceCount: 3,
      fieldSize: 16,
      advanceSize: 12,
      eliminationCount: 4,
    },
    {
      id: 'round_2',
      roundName: 'ROUND 2',
      raceCount: 3,
      fieldSize: 12,
      advanceSize: 8,
      eliminationCount: 4,
    },
    {
      id: 'final',
      roundName: 'CHAMPIONSHIP ROUND',
      raceCount: 4,
      fieldSize: 8,
      advanceSize: null,
      eliminationCount: 0,
    },
  ],
};

export function playoffRacesTotal(structure = SEASON_CHAMPIONSHIP_STRUCTURE) {
  return (structure.playoffRounds || []).reduce(
    (sum, round) => sum + Number(round.raceCount || 0),
    0
  );
}

export function normalChampionshipRacesTotal(
  structure = SEASON_CHAMPIONSHIP_STRUCTURE
) {
  return Number(structure.regularSeasonRaces || 0) + playoffRacesTotal(structure);
}

export function isRaceCompleted(
  race,
  { now = new Date(), settings = null } = {}
) {
  if (!race) return false;
  const status = getEffectiveRaceDateStatus({
    raceDate: race.date,
    hasResults: hasRaceResults(race),
    now,
    settings,
  });
  return Boolean(status.isCompleted);
}

export function resolveSeasonRaceCounts(
  enrichedRaces = [],
  {
    now = new Date(),
    settings = null,
    structure = SEASON_CHAMPIONSHIP_STRUCTURE,
  } = {}
) {
  const races = enrichedRaces || [];
  const options = { now, settings };

  let completedScheduleEvents = 0;
  let completedNormalChampionshipRaces = 0;
  let completedOpeningDuels = 0;

  for (const race of races) {
    if (!isRaceCompleted(race, options)) continue;
    completedScheduleEvents += 1;
    if (race.countsAsNormalChampionshipRace) completedNormalChampionshipRaces += 1;
    if (race.isOpeningDuel) completedOpeningDuels += 1;
  }

  const normalTotal =
    races.filter((race) => race.countsAsNormalChampionshipRace).length ||
    normalChampionshipRacesTotal(structure);
  const regularTotal = Number(structure.regularSeasonRaces) || 20;
  const playoffTotal = playoffRacesTotal(structure);

  const completedRegularSeasonRaces = Math.min(
    completedNormalChampionshipRaces,
    regularTotal
  );
  const completedPlayoffRaces = Math.max(
    0,
    completedNormalChampionshipRaces - regularTotal
  );

  return {
    scheduleEventsTotal: races.length,
    completedScheduleEvents,
    openingDuelsTotal: races.filter((race) => race.isOpeningDuel).length,
    completedOpeningDuels,
    normalChampionshipRacesTotal: normalTotal,
    completedNormalChampionshipRaces,
    regularSeasonRacesTotal: regularTotal,
    completedRegularSeasonRaces,
    playoffRacesTotal: playoffTotal,
    completedPlayoffRaces: Math.min(completedPlayoffRaces, playoffTotal),
  };
}

/**
 * Derive playoff/regular phase from completed normal championship race count.
 */
export function derivePlayoffPhase(
  completedNormalChampionshipRaces,
  structure = SEASON_CHAMPIONSHIP_STRUCTURE
) {
  const regularTotal = Number(structure.regularSeasonRaces) || 20;
  const completed = Math.max(0, Number(completedNormalChampionshipRaces) || 0);
  const playoffTotal = playoffRacesTotal(structure);
  const qualifierCut = Number(structure.playoffQualifierCut) || 16;

  if (completed < regularTotal) {
    return {
      phase: 'regular_season',
      roundName: 'REGULAR SEASON',
      roundId: null,
      playoffRaceIndex: 0,
      roundRaceIndex: 0,
      roundRaceNumber: null,
      roundRaceCount: regularTotal,
      fieldSize: null,
      advanceSize: qualifierCut,
      eliminationCount: null,
      cutPosition: qualifierCut,
      isRegularSeason: true,
      isPlayoffs: false,
      isFinalRound: false,
      isSeasonComplete: false,
      regularSeasonComplete: false,
      showCutColumn: true,
      cutColumnLabel: 'CUT',
    };
  }

  const playoffCompleted = completed - regularTotal;

  if (playoffCompleted >= playoffTotal) {
    return {
      phase: 'season_complete',
      roundName: 'SEASON COMPLETE',
      roundId: 'season_complete',
      playoffRaceIndex: playoffTotal,
      roundRaceIndex: playoffTotal,
      roundRaceNumber: null,
      roundRaceCount: playoffTotal,
      fieldSize: 8,
      advanceSize: null,
      eliminationCount: 0,
      cutPosition: null,
      isRegularSeason: false,
      isPlayoffs: true,
      isFinalRound: true,
      isSeasonComplete: true,
      regularSeasonComplete: true,
      showCutColumn: false,
      cutColumnLabel: null,
    };
  }

  let remaining = playoffCompleted;
  for (const round of structure.playoffRounds || []) {
    const raceCount = Number(round.raceCount) || 0;
    if (remaining < raceCount) {
      const isFinal = round.id === 'final';
      const advanceSize =
        round.advanceSize == null ? null : Number(round.advanceSize);
      return {
        phase: round.id,
        roundName: round.roundName,
        roundId: round.id,
        playoffRaceIndex: playoffCompleted,
        roundRaceIndex: remaining,
        roundRaceNumber: remaining + 1,
        roundRaceCount: raceCount,
        fieldSize: Number(round.fieldSize) || null,
        advanceSize,
        eliminationCount: Number(round.eliminationCount) || 0,
        cutPosition: isFinal ? null : advanceSize,
        isRegularSeason: false,
        isPlayoffs: true,
        isFinalRound: isFinal,
        isSeasonComplete: false,
        regularSeasonComplete: true,
        showCutColumn: !isFinal && advanceSize != null,
        cutColumnLabel: isFinal ? null : 'CUT',
      };
    }
    remaining -= raceCount;
  }

  return {
    phase: 'season_complete',
    roundName: 'SEASON COMPLETE',
    roundId: 'season_complete',
    playoffRaceIndex: playoffTotal,
    roundRaceIndex: playoffTotal,
    roundRaceNumber: null,
    roundRaceCount: playoffTotal,
    fieldSize: 8,
    advanceSize: null,
    eliminationCount: 0,
    cutPosition: null,
    isRegularSeason: false,
    isPlayoffs: true,
    isFinalRound: true,
    isSeasonComplete: true,
    regularSeasonComplete: true,
    showCutColumn: false,
    cutColumnLabel: null,
  };
}

export function resolveSeasonPhaseFromSchedule(enrichedRaces = [], options = {}) {
  const counts = resolveSeasonRaceCounts(enrichedRaces, options);
  const phase = derivePlayoffPhase(
    counts.completedNormalChampionshipRaces,
    options.structure || SEASON_CHAMPIONSHIP_STRUCTURE
  );
  const latest = getLatestCompletedPointsRace(enrichedRaces, options);

  return {
    counts,
    phase,
    latestCompletedDisplayRaceLabel: latest?.displayRaceLabel || null,
    latestCompletedOfficialPointsRaceNumber:
      latest?.officialPointsRaceNumber ?? null,
  };
}

export function formatStandingsSidebarPhase(phase, counts) {
  if (!phase) {
    return {
      primary: `${counts?.completedRegularSeasonRaces ?? 0} / ${counts?.regularSeasonRacesTotal ?? 20}`,
      secondary: 'REGULAR SEASON RACES',
      detail: null,
    };
  }

  if (phase.isSeasonComplete) {
    return {
      primary: 'SEASON COMPLETE',
      secondary: 'FINAL 8 CHAMPIONSHIP',
      detail: null,
    };
  }

  if (phase.isRegularSeason) {
    return {
      primary: `${counts.completedRegularSeasonRaces} / ${counts.regularSeasonRacesTotal}`,
      secondary: 'REGULAR SEASON RACES',
      detail: null,
    };
  }

  const raceLine =
    phase.roundRaceNumber != null
      ? `Race ${phase.roundRaceNumber} of ${phase.roundRaceCount}`
      : null;

  let detail = null;
  if (phase.isFinalRound) {
    detail = `FINAL ${phase.fieldSize}`;
  } else if (phase.fieldSize && phase.advanceSize) {
    detail = `${phase.fieldSize} Drivers → ${phase.advanceSize} Advance`;
  }

  return {
    primary: phase.roundName,
    secondary: raceLine,
    detail,
  };
}

export function buildSeasonScheduleAuditRows(
  enrichedRaces = [],
  {
    now = new Date(),
    settings = null,
    structure = SEASON_CHAMPIONSHIP_STRUCTURE,
  } = {}
) {
  return (enrichedRaces || []).map((race, index) => {
    const completed = isRaceCompleted(race, { now, settings });
    const normalIndex = race.countsAsNormalChampionshipRace
      ? race.officialPointsRaceNumber
      : null;
    let eventPhase = 'opening_duel';
    if (race.countsAsNormalChampionshipRace) {
      const n = Number(race.officialPointsRaceNumber) || 0;
      eventPhase = derivePlayoffPhase(n, structure).phase;
    } else if (race.nonPoints && !race.isOpeningDuel) {
      eventPhase = 'non_points';
    }

    return {
      sourceIndex: index + 1,
      scheduleRow: race.scheduleRow ?? null,
      eventId: race.scheduleId || null,
      date: race.date || null,
      track: race.track || null,
      eventType: race.isOpeningDuel
        ? 'opening_duel'
        : race.nonPoints
          ? 'non_points'
          : 'championship',
      displayRaceLabel: race.displayRaceLabel || null,
      normalChampionshipIndex: normalIndex,
      regularOrPlayoffPhase: eventPhase,
      completed,
      resultLink: completed ? buildSiteResultsUrl(race) : null,
    };
  });
}
