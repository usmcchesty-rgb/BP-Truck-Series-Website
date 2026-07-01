import { fetchHtml, supabase } from './_lib.js';
import {
  aggregateLeagueCareerStatsFromRaceEntries,
  parseDriverStatsRaceEntries,
} from './_driver-career-history.js';

const SRH_SEARCH_URL = 'https://www.simracerhub.com/search_suggest.php';
const SRH_DRIVER_STATS_BASE = 'https://www.simracerhub.com/scoring/driver_stats.php';

const SRH_CAREER_SNAPSHOT_FIELDS =
  'id, created_at, application_id, source, scrape_status, scrape_error, lookup_name, matched_driver_id, matched_driver_name, match_confidence, match_candidates_json, career_starts, career_wins, career_top5s, career_top10s, career_average_finish, career_poles, career_laps_led, career_incidents, career_incidents_per_race, race_entries_used, source_url, raw_search_json, career_stats_json';

function normalizeLookupName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function snapshotBase(application, lookupName) {
  return {
    application_id: application.id,
    source: 'simracerhub_driver_stats_all_leagues',
    lookup_name: lookupName,
  };
}

function careerStatsToColumns(stats) {
  const starts = Number(stats?.careerStarts);
  const incidents = Number(stats?.careerIncidents);
  return {
    career_starts: Number.isFinite(starts) ? starts : null,
    career_wins: Number.isFinite(Number(stats?.careerWins)) ? Number(stats.careerWins) : null,
    career_top5s: Number.isFinite(Number(stats?.careerTop5s)) ? Number(stats.careerTop5s) : null,
    career_top10s: Number.isFinite(Number(stats?.careerTop10s)) ? Number(stats.careerTop10s) : null,
    career_average_finish: Number.isFinite(Number(stats?.careerAverageFinish))
      ? Number(stats.careerAverageFinish)
      : null,
    career_poles: Number.isFinite(Number(stats?.careerPoles)) ? Number(stats.careerPoles) : null,
    career_laps_led: Number.isFinite(Number(stats?.careerLapsLed))
      ? Number(stats.careerLapsLed)
      : null,
    career_incidents: Number.isFinite(incidents) ? incidents : null,
    career_incidents_per_race:
      Number.isFinite(starts) && starts > 0 && Number.isFinite(incidents)
        ? Number((incidents / starts).toFixed(3))
        : null,
    race_entries_used: Number.isFinite(Number(stats?.raceEntriesUsed))
      ? Number(stats.raceEntriesUsed)
      : null,
  };
}

async function insertSrhCareerSnapshot(row) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const { data, error } = await sb
    .from('driver_application_srh_career_snapshots')
    .insert(row)
    .select(SRH_CAREER_SNAPSHOT_FIELDS)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function searchSimRacerHubDrivers(lookupName) {
  const url = `${SRH_SEARCH_URL}?q=${encodeURIComponent(lookupName)}`;
  const response = await fetch(url, { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } });
  if (!response.ok) throw new Error(`SimRacerHub search failed (${response.status})`);
  return response.json();
}

function pickDriverMatch(searchData, lookupName) {
  const drivers = Array.isArray(searchData?.drivers) ? searchData.drivers : [];
  const normalizedLookup = normalizeLookupName(lookupName);
  const exact = drivers.filter((driver) => normalizeLookupName(driver.name) === normalizedLookup);

  if (exact.length === 1) {
    return {
      status: 'matched',
      confidence: 'exact_name',
      driver: exact[0],
      candidates: drivers,
    };
  }

  if (exact.length > 1) {
    return {
      status: 'ambiguous',
      confidence: 'multiple_exact_name',
      driver: null,
      candidates: exact,
    };
  }

  return {
    status: drivers.length ? 'ambiguous' : 'not_found',
    confidence: drivers.length ? 'name_candidates' : 'no_driver_candidates',
    driver: null,
    candidates: drivers,
  };
}

export async function createSrhCareerSnapshotForApplication(application) {
  if (!application?.id) {
    return { ok: false, error: 'Application is required.' };
  }

  const lookupName = String(
    application.iracing_display_name || application.driver_name || ''
  ).trim();

  if (!lookupName) {
    const snapshot = await insertSrhCareerSnapshot({
      ...snapshotBase(application, null),
      scrape_status: 'not_found',
      scrape_error: 'No applicant name available for SimRacerHub lookup.',
      match_confidence: 'missing_lookup_name',
    });
    return { ok: false, snapshot };
  }

  try {
    const searchData = await searchSimRacerHubDrivers(lookupName);
    const match = pickDriverMatch(searchData, lookupName);
    const candidates = match.candidates.map((driver) => ({
      id: driver.id != null ? String(driver.id) : null,
      name: driver.name || null,
      is_ai: driver.is_ai === true,
    }));

    if (!match.driver) {
      const snapshot = await insertSrhCareerSnapshot({
        ...snapshotBase(application, lookupName),
        scrape_status: match.status,
        scrape_error:
          match.status === 'not_found'
            ? 'No SimRacerHub driver match found by name.'
            : 'Multiple or inexact SimRacerHub driver matches need manual review.',
        match_confidence: match.confidence,
        match_candidates_json: candidates,
        raw_search_json: searchData,
      });
      return { ok: false, snapshot };
    }

    const driverId = String(match.driver.id);
    const sourceUrl = `${SRH_DRIVER_STATS_BASE}?driver_id=${encodeURIComponent(driverId)}`;
    const html = await fetchHtml(sourceUrl);
    const entries = parseDriverStatsRaceEntries(html);
    const careerStats = aggregateLeagueCareerStatsFromRaceEntries(entries, {
      driverId,
      scope: 'all_leagues',
    });

    const snapshot = await insertSrhCareerSnapshot({
      ...snapshotBase(application, lookupName),
      scrape_status: careerStats.verified ? 'completed' : 'not_found',
      scrape_error: careerStats.verified ? null : careerStats.reason,
      matched_driver_id: driverId,
      matched_driver_name: match.driver.name || null,
      match_confidence: match.confidence,
      match_candidates_json: candidates,
      source_url: sourceUrl,
      raw_search_json: searchData,
      career_stats_json: {
        scope: 'all_leagues',
        driverId,
        driverName: match.driver.name || null,
        ...careerStats,
      },
      ...careerStatsToColumns(careerStats),
    });

    return { ok: snapshot.scrape_status === 'completed', snapshot };
  } catch (error) {
    const snapshot = await insertSrhCareerSnapshot({
      ...snapshotBase(application, lookupName),
      scrape_status: 'failed',
      scrape_error: error?.message || 'Failed to load SimRacerHub career stats.',
    });
    return { ok: false, snapshot };
  }
}

export async function getLatestSrhCareerSnapshotForApplication(applicationId) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const id = String(applicationId || '').trim();
  if (!id) return null;

  const { data, error } = await sb
    .from('driver_application_srh_career_snapshots')
    .select(SRH_CAREER_SNAPSHOT_FIELDS)
    .eq('application_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01' || /does not exist/i.test(error.message || '')) return null;
    throw new Error(error.message);
  }
  return data;
}
