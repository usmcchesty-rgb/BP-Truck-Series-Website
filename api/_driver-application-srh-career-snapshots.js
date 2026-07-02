import { fetchHtml, supabase } from './_lib.js';
import {
  aggregateLeagueCareerStatsFromRaceEntries,
  parseDriverStatsRaceEntries,
} from './_driver-career-history.js';

const SRH_SEARCH_URL = 'https://www.simracerhub.com/search_suggest.php';
const SRH_DRIVER_STATS_BASE = 'https://www.simracerhub.com/scoring/driver_stats.php';

const SRH_CAREER_SNAPSHOT_FIELDS =
  'id, created_at, application_id, source, scrape_status, scrape_error, lookup_name, matched_driver_id, matched_driver_name, match_confidence, match_candidates_json, career_starts, career_wins, career_top5s, career_top10s, career_average_finish, career_poles, career_laps_led, career_incidents, career_incidents_per_race, career_incidents_per_start, career_disconnects, career_disconnect_rate, race_entries_used, source_url, raw_search_json, career_stats_json';

const SRH_CAREER_SNAPSHOT_FIELDS_LEGACY =
  'id, created_at, application_id, source, scrape_status, scrape_error, lookup_name, matched_driver_id, matched_driver_name, match_confidence, match_candidates_json, career_starts, career_wins, career_top5s, career_top10s, career_average_finish, career_poles, career_laps_led, career_incidents, career_incidents_per_race, race_entries_used, source_url, raw_search_json, career_stats_json';

const SRH_DISCONNECT_MIGRATION_HINT =
  'SRH disconnect columns missing. Run migration: driver_application_srh_career_snapshots_disconnects.sql';

function isMissingDisconnectColumnError(error) {
  const message = String(error?.message || '');
  return (
    error?.code === '42703' &&
    /career_disconnect|career_incidents_per_start/i.test(message)
  );
}

function pickSrhMetric(flatValue, jsonValue) {
  const flat = Number(flatValue);
  const json = Number(jsonValue);
  const flatNum = Number.isFinite(flat) ? flat : null;
  const jsonNum = Number.isFinite(json) ? json : null;
  if (jsonNum != null && jsonNum !== 0 && (flatNum == null || flatNum === 0)) return jsonNum;
  if (flatNum != null) return flatNum;
  if (jsonNum != null) return jsonNum;
  return null;
}

function parseCareerStatsJson(snapshot) {
  const raw = snapshot?.career_stats_json;
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

export function normalizeSrhCareerSnapshot(snapshot, meta = {}) {
  if (!snapshot) return null;

  const statsJson = parseCareerStatsJson(snapshot);

  const careerStarts = pickSrhMetric(snapshot.career_starts, statsJson.careerStarts);
  const careerIncidents = pickSrhMetric(snapshot.career_incidents, statsJson.careerIncidents);
  const careerDisconnects = pickSrhMetric(
    snapshot.career_disconnects,
    statsJson.careerDisconnects
  );

  let careerIncidentsPerStart = pickSrhMetric(
    snapshot.career_incidents_per_start,
    statsJson.careerIncidentsPerStart
  );
  if (careerIncidentsPerStart == null || careerIncidentsPerStart === 0) {
    careerIncidentsPerStart = pickSrhMetric(
      snapshot.career_incidents_per_race,
      statsJson.careerIncidentsPerRace
    );
  }
  if (careerIncidentsPerStart == null || careerIncidentsPerStart === 0) {
    if (careerIncidents != null && careerStarts != null && careerStarts > 0) {
      careerIncidentsPerStart = Number((careerIncidents / careerStarts).toFixed(3));
    }
  }

  let careerDisconnectRate = pickSrhMetric(
    snapshot.career_disconnect_rate,
    statsJson.careerDisconnectRate
  );
  if (
    (careerDisconnectRate == null || careerDisconnectRate === 0) &&
    careerDisconnects != null &&
    careerStarts != null &&
    careerStarts > 0
  ) {
    careerDisconnectRate = Number((careerDisconnects / careerStarts).toFixed(3));
  }

  const columnsMissing =
    meta.srh_disconnect_columns_missing === true ||
    snapshot.srh_disconnect_columns_missing === true;

  const hasDisconnectColumns =
    Object.prototype.hasOwnProperty.call(snapshot, 'career_disconnects') ||
    Object.prototype.hasOwnProperty.call(snapshot, 'career_disconnect_rate');

  const disconnectColumnsMissing =
    columnsMissing || (snapshot.scrape_status === 'completed' && !hasDisconnectColumns);

  return {
    ...snapshot,
    career_starts: careerStarts,
    career_incidents: careerIncidents,
    career_disconnects: careerDisconnects,
    career_disconnect_rate: careerDisconnectRate,
    career_incidents_per_start: careerIncidentsPerStart,
    srh_disconnect_columns_missing: disconnectColumnsMissing,
    srh_disconnect_data_ready:
      snapshot.scrape_status === 'completed' &&
      careerStarts != null &&
      careerDisconnects != null &&
      careerDisconnectRate != null,
  };
}

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
  const disconnects = Number(stats?.careerDisconnects);
  const disconnectRate = Number(stats?.careerDisconnectRate);
  const incidentsPerStart = Number(stats?.careerIncidentsPerStart);
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
    career_incidents_per_start:
      Number.isFinite(incidentsPerStart)
        ? incidentsPerStart
        : Number.isFinite(starts) && starts > 0 && Number.isFinite(incidents)
          ? Number((incidents / starts).toFixed(3))
          : null,
    career_disconnects: Number.isFinite(disconnects) ? disconnects : null,
    career_disconnect_rate: Number.isFinite(disconnectRate) ? disconnectRate : null,
    race_entries_used: Number.isFinite(Number(stats?.raceEntriesUsed))
      ? Number(stats.raceEntriesUsed)
      : null,
  };
}

async function insertSrhCareerSnapshot(row) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  let { data, error } = await sb
    .from('driver_application_srh_career_snapshots')
    .insert(row)
    .select(SRH_CAREER_SNAPSHOT_FIELDS)
    .single();

  if (error && isMissingDisconnectColumnError(error)) {
    const {
      career_disconnects: _careerDisconnects,
      career_disconnect_rate: _careerDisconnectRate,
      career_incidents_per_start: _careerIncidentsPerStart,
      ...legacyRow
    } = row;

    const warning = SRH_DISCONNECT_MIGRATION_HINT;
    const mergedError = legacyRow.scrape_error ? `${legacyRow.scrape_error} ${warning}` : warning;

    ({ data, error } = await sb
      .from('driver_application_srh_career_snapshots')
      .insert({ ...legacyRow, scrape_error: mergedError })
      .select(SRH_CAREER_SNAPSHOT_FIELDS_LEGACY)
      .single());

    if (data) {
      data.srh_disconnect_columns_missing = true;
    }
  }

  if (error) throw new Error(error.message);
  return normalizeSrhCareerSnapshot(data);
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
    return { ok: false, snapshot: normalizeSrhCareerSnapshot(snapshot) };
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
      return { ok: false, snapshot: normalizeSrhCareerSnapshot(snapshot) };
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

    return { ok: snapshot.scrape_status === 'completed', snapshot: normalizeSrhCareerSnapshot(snapshot) };
  } catch (error) {
    const snapshot = await insertSrhCareerSnapshot({
      ...snapshotBase(application, lookupName),
      scrape_status: 'failed',
      scrape_error: error?.message || 'Failed to load SimRacerHub career stats.',
    });
    return { ok: false, snapshot: normalizeSrhCareerSnapshot(snapshot) };
  }
}

export async function getLatestSrhCareerSnapshotForApplication(applicationId) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const id = String(applicationId || '').trim();
  if (!id) return null;

  let { data, error } = await sb
    .from('driver_application_srh_career_snapshots')
    .select(SRH_CAREER_SNAPSHOT_FIELDS)
    .eq('application_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && isMissingDisconnectColumnError(error)) {
    ({ data, error } = await sb
      .from('driver_application_srh_career_snapshots')
      .select(SRH_CAREER_SNAPSHOT_FIELDS_LEGACY)
      .eq('application_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle());

    if (data) {
      data.srh_disconnect_columns_missing = true;
    }
  }

  if (error) {
    if (error.code === '42P01' || /does not exist/i.test(error.message || '')) return null;
    throw new Error(error.message);
  }

  return normalizeSrhCareerSnapshot(data);
}
