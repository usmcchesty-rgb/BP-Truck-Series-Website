import { fetchHtml, getSettings, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces, getPointsRaceByNumber } from './_schedule-points-races.js';
import { findEffectiveNextPointsRace, hasRaceResults } from './_race-date-status.js';

function isBackfilledSlate(row) {
  const meta = row?.meta;
  if (!meta) return false;
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta)?.backfilled === true;
    } catch {
      return false;
    }
  }
  return meta.backfilled === true;
}

async function loadPublishedSlateForRace(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return null;

  const { data, error } = await sb
    .from('fantasy_slates')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .eq('status', 'published')
    .maybeSingle();

  if (error || !data || isBackfilledSlate(data)) return null;
  return data;
}

async function loadPublishedSlatesForSeason(seasonId) {
  const sb = supabase();
  if (!sb) return [];

  const { data: rows, error } = await sb
    .from('fantasy_slates')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('status', 'published')
    .order('race_number', { ascending: false });

  if (error || !rows?.length) return [];
  return rows.filter((row) => !isBackfilledSlate(row));
}

export async function loadFantasyScheduleContext(options = {}) {
  const settings = options.settings || (await getSettings());
  const now = options.now || new Date();
  const scheduleHtml = await fetchHtml(settings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
  const upcomingRace =
    findEffectiveNextPointsRace(scheduleRaces, { now, settings })?.race || null;

  return {
    settings,
    now,
    scheduleRaces,
    upcomingRace,
  };
}

export function isFantasyRaceComplete(scheduleRaces, raceNumber) {
  const race = getPointsRaceByNumber(scheduleRaces, Number(raceNumber));
  if (!race) return false;
  return hasRaceResults(race);
}

export async function resolveFantasySlateProgression(seasonId, options = {}) {
  const ctx = await loadFantasyScheduleContext(options);
  const { scheduleRaces, upcomingRace } = ctx;

  let activeSlateRow = null;
  if (upcomingRace?.officialPointsRaceNumber != null && !hasRaceResults(upcomingRace)) {
    activeSlateRow = await loadPublishedSlateForRace(
      seasonId,
      upcomingRace.officialPointsRaceNumber
    );
  }

  const publishedRows = await loadPublishedSlatesForSeason(seasonId);
  let archivedSlateRow = null;
  for (const row of publishedRows) {
    if (isFantasyRaceComplete(scheduleRaces, row.race_number)) {
      archivedSlateRow = row;
      break;
    }
  }

  const isPlayable = Boolean(activeSlateRow);
  let slatePhase = 'coming-soon';
  if (isPlayable) {
    slatePhase = 'active';
  } else if (archivedSlateRow) {
    slatePhase = 'race-complete';
  }

  const nextRaceNumber = upcomingRace?.officialPointsRaceNumber ?? null;
  const nextRaceHasResults = upcomingRace ? hasRaceResults(upcomingRace) : false;

  return {
    ...ctx,
    seasonId: String(seasonId),
    activeSlateRow,
    archivedSlateRow,
    displaySlateRow: activeSlateRow || archivedSlateRow || null,
    isPlayable,
    slatePhase,
    nextRaceNumber,
    nextRaceTrack: upcomingRace?.track || null,
    nextRaceDate: upcomingRace?.date || null,
    nextRaceHasResults,
    hasUpcomingRaceWithoutSlate: Boolean(
      upcomingRace && !nextRaceHasResults && !activeSlateRow
    ),
  };
}

export function buildFantasyProgressionMeta(progression = {}) {
  return {
    isPlayable: Boolean(progression.isPlayable),
    slatePhase: progression.slatePhase || 'coming-soon',
    playable: Boolean(progression.isPlayable),
    isArchived: Boolean(!progression.isPlayable && progression.archivedSlateRow),
    nextRaceNumber: progression.nextRaceNumber ?? null,
    nextRaceTrack: progression.nextRaceTrack ?? null,
    nextRaceDate: progression.nextRaceDate ?? null,
    hasUpcomingRaceWithoutSlate: Boolean(progression.hasUpcomingRaceWithoutSlate),
  };
}
