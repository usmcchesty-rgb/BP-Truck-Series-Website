import { getRecentPointsRaceResults } from './_schedule-points-races.js';
import { matchDriverIdByName } from './_power-rankings-recent-form.js';
import { alignFinishRacesWithTrace } from './_power-rankings-schedule-alignment.js';
import { extractFinishRacesFromSchedules } from './_simracerhub-schedule-results.js';

export { alignFinishRacesWithTrace };

export const DEFAULT_AUDIT_DRIVER_NAMES = [
  'Mark Arthur',
  'Chris Berg',
  'Justin Levine',
  'Kyle Wellman',
];

export const DATA_SOURCES = {
  SIMRACERHUB_SCHEDULES: 'SimRacerHub schedules API',
  PARSED_SCHEDULE_PAGE: 'parsed schedule page',
  STANDINGS_API: 'standings API',
  DATABASE: 'database',
  CACHED: 'cached data',
  NOT_IN_SOURCE: 'not present in source data',
  MODEL_INFERRED: 'not in prompt payload (model-inferred)',
};

export function getAlignedRaceFinishes(scheduleRaces, raceNumber, schedules, driverLookup) {
  const recentPointsRaces = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3);
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  return alignFinishRacesWithTrace(recentPointsRaces, finishRaces, driverLookup);
}

function raceLabel(race) {
  return `Race ${race.pointsRaceNumber} - ${race.track || 'Unknown'}`;
}

function finishSentInRecentResultsPayload(race, driverId, driverName) {
  if (!race?.winner) return false;
  if (driverId && race.winnerDriverId && String(race.winnerDriverId) === String(driverId)) {
    return true;
  }
  const winnerNorm = String(race.winner || '').toLowerCase().trim();
  const nameNorm = String(driverName || '').toLowerCase().trim();
  return Boolean(winnerNorm && nameNorm && winnerNorm === nameNorm);
}

function findFinishReferencesInPrompt(contextPayload, driverName, race) {
  const references = [];
  const needle = String(driverName || '').toLowerCase();
  const trackNeedle = String(race?.track || '').toLowerCase();
  if (!needle) return references;

  const manualNotes = String(contextPayload?.manualRaceNotes || '').toLowerCase();
  if (manualNotes.includes(needle) && (!trackNeedle || manualNotes.includes(trackNeedle))) {
    references.push({
      location: 'manualRaceNotes',
      dataSource: DATA_SOURCES.PARSED_SCHEDULE_PAGE,
    });
  }

  const transcriptSummary = String(contextPayload?.broadcastContext?.summary || '').toLowerCase();
  if (transcriptSummary.includes(needle) && (!trackNeedle || transcriptSummary.includes(trackNeedle))) {
    references.push({
      location: 'broadcastContext.summary',
      dataSource: 'YouTube transcript summary',
    });
  }

  return references;
}

function buildDriverRaceRow({
  driverId,
  driverName,
  race,
  finishPosition,
  dataSource,
  sentToModel,
  promptNote,
}) {
  return {
    driver: driverName,
    driverId: driverId || null,
    finishPosition,
    raceName: raceLabel(race),
    pointsRaceNumber: race.pointsRaceNumber,
    track: race.track || null,
    dataSource,
    sentToModel: sentToModel === true,
    promptNote: promptNote || null,
    alignmentMethod: race.alignmentMethod || null,
  };
}

export function buildRecentResultsAudit({
  scheduleRaces,
  raceNumber,
  standings,
  schedules,
  driverLookup,
  recentResults,
  recentFormAnalysis,
  contextPayload,
  standingsScheduleId,
  auditDriverNames = DEFAULT_AUDIT_DRIVER_NAMES,
}) {
  const recentPointsRaces = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3);
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  const alignedRaces = alignFinishRacesWithTrace(recentPointsRaces, finishRaces, driverLookup);

  const recentRaceResultsUsed = [];

  for (const race of alignedRaces) {
    for (const [driverId, finishPosition] of Object.entries(race.finishes || {})) {
      const driver = driverLookup.get(String(driverId));
      if (!driver) continue;

      const sentToModel = false;
      recentRaceResultsUsed.push(
        buildDriverRaceRow({
          driverId,
          driverName: driver.driverName,
          race,
          finishPosition,
          dataSource: DATA_SOURCES.SIMRACERHUB_SCHEDULES,
          sentToModel,
          promptNote:
            'Available internally from standings snapshot schedules object; not included in recentResults payload.',
        })
      );
    }

    if (race.winner) {
      recentRaceResultsUsed.push(
        buildDriverRaceRow({
          driverId: race.winnerDriverId,
          driverName: race.winner,
          race,
          finishPosition: 1,
          dataSource: DATA_SOURCES.PARSED_SCHEDULE_PAGE,
          sentToModel: true,
          promptNote: 'Included in recentResults.winner sent to the model.',
        })
      );
    }
  }

  const auditDriverTrace = auditDriverNames.map((driverName) => {
    const driverId = matchDriverIdByName(driverName, driverLookup);
    const perRace = alignedRaces.map((race) => {
      const finishFromSchedules =
        driverId && race.finishes?.[driverId] != null ? race.finishes[driverId] : null;
      const sentAsWinner = finishSentInRecentResultsPayload(race, driverId, driverName);
      const promptReferences = findFinishReferencesInPrompt(contextPayload, driverName, race);

      let promptExposure = DATA_SOURCES.NOT_IN_SOURCE;
      if (sentAsWinner) {
        promptExposure = `${DATA_SOURCES.PARSED_SCHEDULE_PAGE} (recentResults.winner only)`;
      } else if (finishFromSchedules != null) {
        promptExposure =
          'SimRacerHub schedules API (internal recentFormAnalysis only; finish not sent to model)';
      }

      return {
        raceName: raceLabel(race),
        pointsRaceNumber: race.pointsRaceNumber,
        track: race.track,
        finishPositionFromSchedulesApi: finishFromSchedules,
        finishPositionSentToModel: sentAsWinner ? 1 : null,
        dataSource:
          finishFromSchedules != null
            ? DATA_SOURCES.SIMRACERHUB_SCHEDULES
            : sentAsWinner
              ? DATA_SOURCES.PARSED_SCHEDULE_PAGE
              : DATA_SOURCES.NOT_IN_SOURCE,
        promptExposure,
        alignmentMethod: race.alignmentMethod,
        promptReferences,
      };
    });

    const standingsRow = standings.find((row) => String(row.driverId) === String(driverId));

    return {
      driverName,
      driverId: driverId || null,
      matchedInDriverLookup: Boolean(driverId),
      perRace,
      standingsApiAggregates: standingsRow
        ? {
            dataSource: DATA_SOURCES.STANDINGS_API,
            pointsPosition: standingsRow.position,
            wins: standingsRow.wins,
            top5: standingsRow.top5,
            top10: standingsRow.top10,
            races: standingsRow.races,
            note: 'Season aggregates only — no per-race finish positions.',
          }
        : null,
    };
  });

  return {
    recentResultsSentToModel: recentResults,
    recentFormAnalysisSentToModel: recentFormAnalysis,
    standingsScheduleIdUsed: standingsScheduleId || null,
    schedulesApiRaceCount: finishRaces.length,
    alignedRaceTrace: alignedRaces.map((race) => ({
      pointsRaceNumber: race.pointsRaceNumber,
      track: race.track,
      winner: race.winner,
      alignmentMethod: race.alignmentMethod,
      schedulePageScheduleId: race.schedulePageScheduleId ?? null,
      schedulesApiScheduleId: race.schedulesApiScheduleId ?? null,
      alignmentMismatchWarning: race.alignmentMismatchWarning ?? null,
      schedulesApiScheduleKey: race.schedulesApiScheduleKey,
      schedulesApiFinishesCount: race.schedulesApiFinishesCount,
    })),
    recentRaceResultsUsed,
    auditDriverTrace,
    promptDataGap:
      'recentResults sent to the model includes winner name only per race. Individual finish positions from SimRacerHub schedules API are used internally for recentFormAnalysis but are not included in the prompt JSON. Per-race finishes not present in source payload may be model-inferred from transcript/manual notes or hallucinated.',
    databaseUsedForRecentFinishes: false,
    cachedDataUsed: false,
  };
}

export function buildRankedDriverFinishTrace(entries, honorableMentions, resultsAudit) {
  const rankedDrivers = [
    ...(entries || []).map((entry) => ({
      rank: entry.rank,
      driverId: entry.driverId,
      driverName: entry.driverName,
      role: 'top10',
    })),
    ...(honorableMentions || []).map((entry) => ({
      rank: null,
      driverId: entry.driverId,
      driverName: entry.driverName,
      role: 'honorableMention',
    })),
  ];

  const rowsByDriverId = new Map();
  for (const row of resultsAudit?.recentRaceResultsUsed || []) {
    if (!row.driverId) continue;
    if (!rowsByDriverId.has(String(row.driverId))) {
      rowsByDriverId.set(String(row.driverId), []);
    }
    rowsByDriverId.get(String(row.driverId)).push(row);
  }

  return rankedDrivers.map((driver) => {
    const sourceRows = rowsByDriverId.get(String(driver.driverId)) || [];
    return {
      rank: driver.rank,
      role: driver.role,
      driverName: driver.driverName,
      driverId: driver.driverId,
      recentRaceFinishes: sourceRows.map((row) => ({
        raceName: row.raceName,
        finishPosition: row.finishPosition,
        dataSource: row.dataSource,
        sentToModel: row.sentToModel,
      })),
      promptNote:
        sourceRows.length > 0
          ? 'See recentRaceFinishes for source-backed positions. Positions not listed were not sent to the model.'
          : 'No per-race finish positions found in traced source data for this driver.',
    };
  });
}
