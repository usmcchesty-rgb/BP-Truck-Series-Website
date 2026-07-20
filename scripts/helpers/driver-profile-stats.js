import { enrichScheduleRaces } from '../../api/_schedule-points-races.js';
import { extractFinishRacesFromSchedules } from '../../api/_simracerhub-schedule-results.js';
import {
  buildDriverStatsIdentityDiagnostics,
  findStandingsRowForIdentity,
  resolveDriverStatsIdentity,
} from './driver-stats-identity.js';

function extractScheduleIdFromLink(link) {
  const match = String(link || '').match(/schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

function buildCompletedPointsRaces(scheduleRaces) {
  return enrichScheduleRaces(scheduleRaces).filter(
    (race) => !race.nonPoints && race.winner && race.officialPointsRaceNumber != null
  );
}

export function alignDriverRaceHistory(srhDriverId, schedules, scheduleRaces) {
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  const completedPoints = buildCompletedPointsRaces(scheduleRaces);
  const finishByScheduleId = new Map(
    finishRaces
      .filter((race) => race.scheduleId != null)
      .map((race) => [String(race.scheduleId), race])
  );
  const usedFinishKeys = new Set();
  const aligned = [];
  const driverKey = String(srhDriverId || '');

  for (const race of completedPoints) {
    const scheduleId =
      race.scheduleId != null
        ? String(race.scheduleId)
        : extractScheduleIdFromLink(race.link);
    let finishRace = scheduleId ? finishByScheduleId.get(scheduleId) : null;

    if (finishRace) {
      usedFinishKeys.add(String(finishRace.scheduleKey));
    } else {
      const remaining = finishRaces.filter(
        (entry) => !usedFinishKeys.has(String(entry.scheduleKey))
      );
      finishRace = remaining[0] || null;
      if (finishRace) usedFinishKeys.add(String(finishRace.scheduleKey));
    }

    const finish = finishRace?.finishes?.[driverKey];
    if (!Number.isFinite(finish)) continue;

    const result = finishRace?.driverResults?.[driverKey] || null;
    aligned.push({
      raceNumber: race.officialPointsRaceNumber,
      track: race.track,
      date: race.date,
      finish,
      start: result?.startingPos ?? null,
      startingPos: result?.startingPos ?? null,
      status: result?.status ?? null,
      lapsLed: result?.lapsLed ?? null,
      incidents: result?.incidents ?? null,
      points: result?.points ?? null,
    });
  }

  return aligned;
}

export function computeBestFinish(srhDriverId, schedules) {
  const finishRaces = extractFinishRacesFromSchedules(schedules);
  const driverKey = String(srhDriverId || '');
  let best = null;

  for (const race of finishRaces) {
    const finish = race.finishes?.[driverKey];
    if (!Number.isFinite(finish)) continue;
    if (best === null || finish < best) best = finish;
  }

  return best;
}

export function buildDriverSeasonStats(profile = {}, context = {}) {
  const standingsRows = context.standingsRows || [];
  const standingsMaps = context.standingsMaps || null;
  const identity = resolveDriverStatsIdentity(profile, {
    ...context,
    standingsRows,
    standingsMaps,
  });
  const standingsRow = findStandingsRowForIdentity(identity, standingsRows, standingsMaps);
  const leader =
    context.leader ||
    standingsRows.find((row) => Number(row.position) === 1) ||
    null;
  const schedules = context.schedules || {};
  const scheduleRaces = context.scheduleRaces || [];

  const statsDriverId = identity.resolved ? identity.srhDriverId : null;
  const recentRaces = statsDriverId
    ? alignDriverRaceHistory(statsDriverId, schedules, scheduleRaces)
    : [];
  const bestFinish = statsDriverId ? computeBestFinish(statsDriverId, schedules) : null;
  const pointsBehind =
    leader && standingsRow?.points != null
      ? Math.max(0, Number(leader.points) - Number(standingsRow.points))
      : null;

  const stats = {
    position: standingsRow?.position ?? null,
    points: standingsRow?.points ?? null,
    pointsBehind,
    races: standingsRow?.races ?? null,
    wins: standingsRow?.wins ?? null,
    top5: standingsRow?.top5 ?? null,
    top10: standingsRow?.top10 ?? null,
    avgFinish: standingsRow?.avgFinish ?? null,
    lapsLed: standingsRow?.lapsLed ?? null,
    incidents: standingsRow?.incidents ?? null,
    bestFinish,
    recentRaces: [...recentRaces].reverse(),
    identity,
    statsSource: identity.resolved ? 'simracerhub_standings' : null,
  };

  const diagnostics = buildDriverStatsIdentityDiagnostics(profile, {
    ...context,
    standingsRows,
    standingsMaps,
    schedules,
    recentRaces: stats.recentRaces,
  });

  return {
    stats,
    identity,
    standingsRow,
    diagnostics,
  };
}
