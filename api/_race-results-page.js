import * as cheerio from 'cheerio';
import {
  getDriverProfiles,
  photoCacheVersion,
  slugify,
  stripPhotoUrlQuery,
  withPhotoCacheBust,
} from './_lib.js';
import { alignFinishRacesWithTrace } from './_power-rankings-schedule-alignment.js';
import {
  getCompletedPointsRaces,
  getLatestCompletedPointsRace,
  getPointsRaceByNumber,
  resolveRaceForResultsQuery,
  formatRaceDisplayTitle,
} from './_schedule-points-races.js';
import { isRaceCompleted } from './_championship-season.js';
import { extractFinishRacesFromSchedules, extractSegmentResultsForDriver, findScheduleEntryByScheduleId } from './_simracerhub-schedule-results.js';
import {
  driverProfilePublicUrl,
  resolveProfileForStandingsRow,
} from './_driver-profile-resolve.js';
import { fetchCautionCountForRace } from './_caution-stats.js';

function formatDriverName(rawName) {
  const raw = String(rawName || '').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  return raw
    .split(',')
    .reverse()
    .map((part) => part.trim())
    .join(' ');
}

function resolveScheduleId(race) {
  if (race?.scheduleId != null) return String(race.scheduleId);
  const match = String(race?.link || '').match(/schedule_id=(\d+)/i);
  return match?.[1] ? String(match[1]) : null;
}

function raceWithScheduleId(race) {
  if (!race) return null;
  return {
    ...race,
    scheduleId: resolveScheduleId(race),
  };
}

function detectLatestScheduleIdFromHtml(scheduleHtml, fallbackScheduleId) {
  if (!scheduleHtml) return fallbackScheduleId;

  const $ = cheerio.load(scheduleHtml);
  const completedScheduleIds = [];

  $('table')
    .find('tr')
    .each((_i, tr) => {
      const tds = $(tr).find('td');
      if (!tds || tds.length < 7) return;

      const winnerCell = tds.eq(6);
      const winnerText = String(
        winnerCell.find('a').first().text() || winnerCell.text() || ''
      ).trim();
      if (!winnerText) return;

      $(tr)
        .find("a[href*='race']")
        .each((_idx, anchor) => {
          const href = String($(anchor).attr('href') || '');
          const match = href.match(/schedule_id=(\d+)/);
          if (match?.[1]) completedScheduleIds.push(String(match[1]));
        });
    });

  const seen = new Set();
  const orderedUnique = completedScheduleIds.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return orderedUnique.length
    ? orderedUnique[orderedUnique.length - 1]
    : fallbackScheduleId;
}

async function fetchStandingsSnapshot(settings, scheduleHtml) {
  const seasonId = settings.seasonId || '27987';
  const fallbackScheduleId = settings.scheduleId || '346493';
  const scheduleId = detectLatestScheduleIdFromHtml(scheduleHtml, fallbackScheduleId);

  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${scheduleId}`,
    { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
  );

  if (!response.ok) {
    throw new Error(`SimRacerHub standings fetch failed (${response.status})`);
  }

  const data = await response.json();
  return { data, scheduleId };
}

function buildDriverLookup(standingsRows) {
  const lookup = new Map();

  for (const row of standingsRows) {
    lookup.set(String(row.driverId), {
      driverId: String(row.driverId),
      driverName: row.driver,
      carNumber: row.carNumber || '',
      photoUrl: row.photoUrl || '',
    });
  }

  return lookup;
}

function buildStandingsRows(data, profiles) {
  return Object.values(data.rps || {})
    .map((row) => {
      const driver = data.drivers?.[row.drid] || {};
      const rawName = driver.name || row.name || `Driver ${row.drid}`;
      const name = formatDriverName(rawName);
      const srhDriverId = String(row.drid);
      const resolution = resolveProfileForStandingsRow(
        { driverId: srhDriverId, driverName: name },
        profiles
      );
      const profile = resolution.profile;
      const displayName = profile?.display_name || name;
      const photoUrl = profile?.photo_url
        ? withPhotoCacheBust(
            stripPhotoUrlQuery(profile.photo_url),
            photoCacheVersion(profile.updated_at)
          )
        : `/assets/drivers/${slugify(displayName || name)}.png`;

      return {
        driverId: srhDriverId,
        driver: displayName,
        carNumber: profile?.car_number || '',
        photoUrl,
        profileDriverId: resolution.profileDriverId || null,
        identityMatchMethod: resolution.matchMethod || null,
      };
    })
    .filter((row) => row.driverId);
}

function findFinishRaceForAligned(alignedRace, finishRaces) {
  if (!alignedRace) return null;

  if (alignedRace.schedulesApiScheduleId) {
    const match = finishRaces.find(
      (race) => String(race.scheduleId) === String(alignedRace.schedulesApiScheduleId)
    );
    if (match) return match;
  }

  if (alignedRace.schedulesApiScheduleKey != null) {
    const match = finishRaces.find(
      (race) => String(race.scheduleKey) === String(alignedRace.schedulesApiScheduleKey)
    );
    if (match) return match;
  }

  return null;
}

function buildFinishingOrderRows(finishRace, standingsRows, profiles) {
  if (!finishRace?.driverResults) return [];

  const standingsById = Object.fromEntries(
    standingsRows.map((row) => [String(row.driverId), row])
  );

  const rows = Object.entries(finishRace.driverResults).map(([driverId, result]) => {
    const standingsRow = standingsById[String(driverId)] || null;
    const resolution = resolveProfileForStandingsRow(
      {
        driverId: String(driverId),
        driverName: standingsRow?.driver || '',
      },
      profiles
    );
    const profile = resolution.profile;
    const driverName =
      standingsRow?.driver ||
      profile?.display_name ||
      profile?.iracing_name ||
      `Driver ${driverId}`;
    const photoUrl =
      standingsRow?.photoUrl ||
      (profile?.photo_url
        ? withPhotoCacheBust(
            stripPhotoUrlQuery(profile.photo_url),
            photoCacheVersion(profile.updated_at)
          )
        : `/assets/drivers/${slugify(driverName)}.png`);
    const finish = Number(result.finishPosition ?? result.finish);
    const isProvisional = Boolean(result.isProvisional);
    const profileDriverId =
      resolution.profileDriverId || standingsRow?.profileDriverId || null;

    return {
      driverId: String(driverId),
      profileDriverId,
      profileUrl: driverProfilePublicUrl(profileDriverId || driverId),
      identityMatchMethod: resolution.matchMethod || standingsRow?.identityMatchMethod || null,
      driverName,
      carNumber: standingsRow?.carNumber || profile?.car_number || '',
      photoUrl,
      startingPos: result.startPosition ?? result.startingPos,
      finish,
      lapsLed: result.lapsLed,
      incidents: result.incidents,
      points: result.points,
      isWinner: finish === 1,
      isProvisional,
      status: isProvisional ? 'Provisional' : result.status || 'Finished',
      participationStatus: result.participationStatus || (isProvisional ? 'provisional' : 'started'),
    };
  });

  return rows
    .filter((row) => Number.isFinite(row.finish) && row.finish >= 1)
    .sort((a, b) => {
      if (a.isProvisional !== b.isProvisional) return a.isProvisional ? 1 : -1;
      return a.finish - b.finish;
    })
    .map((row) => ({
      position: row.finish,
      ...row,
    }));
}

function sumStagePoints(segments = []) {
  const withPoints = segments.filter((segment) => segment.points != null);
  if (!withPoints.length) return null;
  return withPoints.reduce((sum, segment) => sum + Number(segment.points || 0), 0);
}

function buildWinnerRaceSummary(winnerRow, scheduleEntry) {
  if (!winnerRow) return null;

  const segments = scheduleEntry
    ? extractSegmentResultsForDriver(scheduleEntry, winnerRow.driverId)
    : [];
  const stagePoints = sumStagePoints(segments);
  const racePoints = winnerRow.points ?? null;
  const startingPos = winnerRow.startingPos ?? null;
  const finish = winnerRow.finish ?? null;
  let positionsGained = null;
  if (Number.isFinite(startingPos) && Number.isFinite(finish)) {
    positionsGained = startingPos - finish;
  }

  let totalPoints = null;
  if (racePoints != null && stagePoints != null) {
    totalPoints = racePoints + stagePoints;
  } else if (racePoints != null) {
    totalPoints = racePoints;
  }

  return {
    driverId: winnerRow.driverId,
    profileDriverId: winnerRow.profileDriverId || null,
    driverName: winnerRow.driverName,
    carNumber: winnerRow.carNumber || null,
    photoUrl: winnerRow.photoUrl,
    profileUrl:
      winnerRow.profileUrl ||
      driverProfilePublicUrl(winnerRow.profileDriverId || winnerRow.driverId),
    finish,
    startingPos,
    positionsGained,
    lapsLed: winnerRow.lapsLed ?? null,
    incidents: winnerRow.incidents ?? null,
    racePoints,
    stage1Finish: segments[0]?.finish ?? null,
    stage2Finish: segments[1]?.finish ?? null,
    stagePoints,
    totalPoints,
  };
}

export async function buildRaceResultsPayload({
  enrichedRaces,
  scheduleHtml,
  settings,
  requestedRaceNumber = null,
  requestedScheduleId = null,
  requestedRaceLabel = null,
  progressionOptions = {},
}) {
  const completedPointsRaces = getCompletedPointsRaces(
    enrichedRaces,
    progressionOptions
  );
  const latestCompletedRace = getLatestCompletedPointsRace(
    enrichedRaces,
    progressionOptions
  );

  const completedResultEvents = (enrichedRaces || []).filter((race) => {
    if (!isRaceCompleted(race, progressionOptions)) return false;
    return race.countsAsNormalChampionshipRace || race.isOpeningDuel;
  });

  const completedRaceOptions = completedResultEvents.map((race) => ({
    raceNumber: race.officialPointsRaceNumber,
    displayRaceLabel: race.displayRaceLabel,
    scheduleId: race.scheduleId || null,
    track: race.track,
    date: race.date,
    winner: race.winner,
    isOpeningDuel: race.isOpeningDuel === true,
    displayTitle: formatRaceDisplayTitle(race),
  }));

  if (!completedResultEvents.length) {
    return {
      resultsAvailable: false,
      selectedRaceNumber: null,
      selectedDisplayRaceLabel: null,
      selectedDisplayTitle: null,
      selectedScheduleId: null,
      selectedRaceName: null,
      selectedRaceDate: null,
      selectedRaceWinner: null,
      resultRowsCount: 0,
      dataSource: 'none',
      alignmentMethod: 'none',
      latestCompletedRaceNumber: null,
      latestCompletedDisplayRaceLabel: null,
      completedRaces: [],
      rows: [],
      winnerSummary: null,
    };
  }

  let selectedRace = latestCompletedRace;

  const queried = resolveRaceForResultsQuery(enrichedRaces, {
    scheduleId: requestedScheduleId,
    race: requestedRaceLabel,
    raceNumber: requestedRaceNumber,
    raceLabel: requestedRaceLabel,
  });

  if (queried) {
    const isCompleted = completedResultEvents.some((race) => {
      if (queried.scheduleId && race.scheduleId) {
        return String(race.scheduleId) === String(queried.scheduleId);
      }
      if (
        queried.displayRaceLabel &&
        race.displayRaceLabel &&
        String(race.displayRaceLabel) === String(queried.displayRaceLabel)
      ) {
        return true;
      }
      return (
        queried.officialPointsRaceNumber != null &&
        race.officialPointsRaceNumber === queried.officialPointsRaceNumber
      );
    });
    if (isCompleted) selectedRace = queried;
  } else if (
    requestedRaceNumber != null &&
    Number.isFinite(Number(requestedRaceNumber)) &&
    Number(requestedRaceNumber) > 0
  ) {
    const candidate = getPointsRaceByNumber(
      enrichedRaces,
      Number(requestedRaceNumber)
    );
    const isCompleted = completedPointsRaces.some(
      (race) =>
        race.officialPointsRaceNumber === candidate?.officialPointsRaceNumber
    );
    if (candidate && isCompleted) selectedRace = candidate;
  }

  if (!selectedRace) {
    return {
      resultsAvailable: false,
      selectedRaceNumber: null,
      selectedDisplayRaceLabel: null,
      selectedDisplayTitle: null,
      selectedScheduleId: null,
      selectedRaceName: null,
      selectedRaceDate: null,
      selectedRaceWinner: null,
      resultRowsCount: 0,
      dataSource: 'none',
      alignmentMethod: 'none',
      latestCompletedRaceNumber: latestCompletedRace?.officialPointsRaceNumber ?? null,
      latestCompletedDisplayRaceLabel: latestCompletedRace?.displayRaceLabel ?? null,
      completedRaces: completedRaceOptions,
      rows: [],
      winnerSummary: null,
    };
  }

  const { data, scheduleId: snapshotScheduleId } = await fetchStandingsSnapshot(
    settings,
    scheduleHtml
  );
  const profiles = await getDriverProfiles();
  const standingsRows = buildStandingsRows(data, profiles);
  const driverLookup = buildDriverLookup(standingsRows);
  const finishRaces = extractFinishRacesFromSchedules(data.schedules || {});
  const [alignedRace] = alignFinishRacesWithTrace(
    [raceWithScheduleId(selectedRace)],
    finishRaces,
    driverLookup
  );
  const finishRace = findFinishRaceForAligned(alignedRace, finishRaces);
  const rows = buildFinishingOrderRows(finishRace, standingsRows, profiles);
  const winnerRow = rows.find((row) => row.isWinner) || rows[0] || null;
  const scheduleEntry = findScheduleEntryByScheduleId(
    data.schedules || {},
    alignedRace?.schedulesApiScheduleId || finishRace?.scheduleId || snapshotScheduleId
  );
  const winnerSummary = buildWinnerRaceSummary(winnerRow, scheduleEntry);
  const selectedScheduleId =
    alignedRace?.schedulesApiScheduleId ||
    finishRace?.scheduleId ||
    selectedRace.scheduleId ||
    snapshotScheduleId ||
    null;
  const cautionCount = await fetchCautionCountForRace({
    ...selectedRace,
    scheduleId: selectedScheduleId || selectedRace.scheduleId || null,
  });

  return {
    resultsAvailable: rows.length > 0,
    selectedRaceNumber: selectedRace.officialPointsRaceNumber,
    selectedDisplayRaceLabel: selectedRace.displayRaceLabel || null,
    selectedDisplayTitle: formatRaceDisplayTitle(selectedRace),
    selectedScheduleId,
    selectedRaceName: selectedRace.track || null,
    selectedRaceDate: selectedRace.date || null,
    selectedRaceWinner: selectedRace.winner || null,
    cautionCount: Number.isFinite(cautionCount) ? cautionCount : null,
    cautionCountSource: Number.isFinite(cautionCount)
      ? 'simracerhub-race-page-summary'
      : null,
    resultRowsCount: rows.length,
    officialStarterCount: finishRace?.officialStarterCount ?? null,
    provisionalCount: finishRace?.provisionalCount ?? 0,
    totalScoredFieldCount: finishRace?.totalScoredFieldCount ?? rows.length,
    dataSource: rows.length ? 'simracerhub-schedules-api' : 'none',
    alignmentMethod: alignedRace?.alignmentMethod || 'none',
    latestCompletedRaceNumber: latestCompletedRace?.officialPointsRaceNumber ?? null,
    latestCompletedDisplayRaceLabel: latestCompletedRace?.displayRaceLabel ?? null,
    completedRaces: completedRaceOptions,
    rows,
    winnerSummary,
  };
}
