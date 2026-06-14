import { matchDriverIdByName } from './_power-rankings-recent-form.js';

function normalizeTrack(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trackTokens(value) {
  return normalizeTrack(value)
    .split(' ')
    .filter((token) => token.length > 2);
}

function tracksLikelyMatch(pageTrack, apiTrack) {
  const page = normalizeTrack(pageTrack);
  const api = normalizeTrack(apiTrack);
  if (!page || !api) return false;
  if (page === api || page.includes(api) || api.includes(page)) return true;

  const pageTokens = trackTokens(pageTrack);
  const apiTokens = trackTokens(apiTrack);
  if (!pageTokens.length || !apiTokens.length) return false;

  const overlap = pageTokens.filter((token) => apiTokens.includes(token)).length;
  return overlap >= Math.min(2, pageTokens.length, apiTokens.length);
}

function datesRoughlyMatch(pageDate, apiRaceDateUnix) {
  const pageText = String(pageDate || '').trim();
  const unix = Number(apiRaceDateUnix);
  if (!pageText || !Number.isFinite(unix)) return false;

  const parsed = new Date(`${pageText}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;

  const apiDate = new Date(unix * 1000);
  return parsed.toDateString() === apiDate.toDateString();
}

function pickWinnerFallbackMatch(race, finishRaces, winnerDriverId, reservedScheduleApiIds) {
  if (!winnerDriverId) return { match: null, method: 'none', warning: null };

  const candidates = finishRaces.filter(
    (entry) =>
      entry.winnerDriverId === winnerDriverId &&
      !reservedScheduleApiIds.has(String(entry.scheduleId))
  );

  if (candidates.length === 0) {
    return {
      match: null,
      method: 'none',
      warning: race.winner
        ? `No schedules API race found for winner ${race.winner} without schedule_id.`
        : 'Missing schedule_id and race winner.',
    };
  }

  if (candidates.length === 1) {
    return { match: candidates[0], method: 'fallback-winner-id-match', warning: null };
  }

  const dateMatches = candidates.filter((entry) => datesRoughlyMatch(race.date, entry.raceDate));
  if (dateMatches.length === 1) {
    return {
      match: dateMatches[0],
      method: 'fallback-winner-id-match-date-confirmed',
      warning: null,
    };
  }

  const unusedAfterDate = dateMatches.length ? dateMatches : candidates;
  const trackMatches = unusedAfterDate.filter((entry) =>
    tracksLikelyMatch(race.track, entry.track || entry.eventName)
  );
  if (trackMatches.length === 1) {
    return {
      match: trackMatches[0],
      method: 'fallback-winner-id-match-track-confirmed',
      warning: null,
    };
  }

  return {
    match: null,
    method: 'fallback-winner-id-ambiguous',
    warning: `Multiple schedules API races match winner ${race.winner}; alignment refused without schedule_id or unique date/track confirmation.`,
  };
}

function buildAlignedRaceRow(race, match, winnerDriverId, alignmentMethod, alignmentMismatchWarning) {
  return {
    pointsRaceNumber: race.officialPointsRaceNumber,
    scheduleRow: race.scheduleRow,
    track: race.track,
    date: race.date,
    winner: race.winner,
    winnerDriverId,
    schedulePageScheduleId: race.scheduleId ? String(race.scheduleId) : null,
    schedulesApiScheduleId: match?.scheduleId ? String(match.scheduleId) : null,
    finishes: match?.finishes || {},
    schedulesApiScheduleKey: match?.scheduleKey ?? null,
    alignmentMethod,
    alignmentMismatchWarning,
    schedulesApiFinishesCount: Object.keys(match?.finishes || {}).length,
  };
}

export function alignFinishRacesWithTrace(recentPointsRaces, finishRaces, driverLookup) {
  const reservedScheduleApiIds = new Set();
  const aligned = [];

  for (const race of recentPointsRaces) {
    const winnerDriverId = matchDriverIdByName(race.winner, driverLookup);
    const schedulePageScheduleId = race.scheduleId ? String(race.scheduleId) : null;
    let match = null;
    let alignmentMethod = 'none';
    let alignmentMismatchWarning = null;

    if (schedulePageScheduleId) {
      match =
        finishRaces.find((entry) => String(entry.scheduleId) === schedulePageScheduleId) || null;
      if (match) {
        alignmentMethod = 'schedules-api-schedule-id-match';
      } else {
        alignmentMismatchWarning = `No schedules API entry for schedule_id ${schedulePageScheduleId}.`;
      }
    } else {
      const fallback = pickWinnerFallbackMatch(
        race,
        finishRaces,
        winnerDriverId,
        reservedScheduleApiIds
      );
      match = fallback.match;
      alignmentMethod = fallback.method;
      alignmentMismatchWarning = fallback.warning;
    }

    if (match) {
      reservedScheduleApiIds.add(String(match.scheduleId));
    }

    aligned.push(
      buildAlignedRaceRow(race, match, winnerDriverId, alignmentMethod, alignmentMismatchWarning)
    );
  }

  const allMissingFinishes = aligned.every((race) => Object.keys(race.finishes).length === 0);
  const allMissingScheduleIds = recentPointsRaces.every((race) => !race.scheduleId);

  if (allMissingFinishes && allMissingScheduleIds && finishRaces.length) {
    const tail = finishRaces.slice(-recentPointsRaces.length);
    return recentPointsRaces.map((race, index) =>
      buildAlignedRaceRow(
        race,
        tail[index] || null,
        matchDriverIdByName(race.winner, driverLookup),
        'schedules-api-index-fallback',
        'All schedule_id and winner alignments failed; index fallback used.'
      )
    );
  }

  return aligned;
}
