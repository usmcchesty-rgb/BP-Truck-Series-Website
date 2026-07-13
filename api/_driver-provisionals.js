import { getDriverProfiles, getSettings, supabase } from './_lib.js';

export const FREE_PROVISIONALS_PER_SEASON = 2;
export const PROVISIONAL_LEDGER_TYPES = ['free', 'purchased', 'admin'];

export function summarizeDriverProvisionalAllowance(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const freeProvisionalsUsed = rows.filter((row) => row.type === 'free').length;
  const purchasedProvisionalsUsed = rows.filter((row) => row.type === 'purchased').length;
  const adminProvisionalsUsed = rows.filter((row) => row.type === 'admin').length;

  return {
    freeProvisionalsUsed,
    freeProvisionalsRemaining: Math.max(0, FREE_PROVISIONALS_PER_SEASON - freeProvisionalsUsed),
    purchasedProvisionalsUsed,
    adminProvisionalsUsed,
    totalProvisionalsUsed: rows.length,
    source: 'bp-ledger',
  };
}

function normalizeLedgerRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    seasonId: row.season_id,
    driverId: String(row.driver_id),
    raceNumber: Number(row.race_number),
    type: row.type,
    notes: row.notes || '',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: row.created_at,
    createdBy: row.created_by || null,
  };
}

export async function listDriverProvisionalsForSeason(seasonId) {
  const sb = supabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('driver_provisionals')
    .select('*')
    .eq('season_id', String(seasonId))
    .order('race_number', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message || 'Failed to load provisional ledger.');
  return (data || []).map(normalizeLedgerRow);
}

export async function getDriverProvisionalsForRace(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return [];

  const { data, error } = await sb
    .from('driver_provisionals')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber));

  if (error) throw new Error(error.message || 'Failed to load race provisional ledger.');
  return (data || []).map(normalizeLedgerRow);
}

export async function addDriverProvisionalEntry({
  seasonId,
  driverId,
  raceNumber,
  type,
  notes = '',
  createdBy = 'admin',
  metadata = null,
}) {
  const sb = supabase();
  if (!sb) throw new Error('Database not configured.');

  const normalizedType = String(type || '').toLowerCase();
  if (!PROVISIONAL_LEDGER_TYPES.includes(normalizedType)) {
    throw new Error('Provisional type must be free, purchased, or admin.');
  }

  const payload = {
    season_id: String(seasonId),
    driver_id: String(driverId),
    race_number: Number(raceNumber),
    type: normalizedType,
    notes: String(notes || '').trim() || null,
    created_by: createdBy || 'admin',
  };
  if (metadata && typeof metadata === 'object') {
    payload.metadata = metadata;
  }

  const { data, error } = await sb
    .from('driver_provisionals')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    if (String(error.code) === '23505') {
      throw new Error('Duplicate provisional ledger entry for this driver and race.');
    }
    throw new Error(error.message || 'Failed to save provisional ledger entry.');
  }

  return normalizeLedgerRow(data);
}

export async function updateDriverProvisionalType({
  seasonId,
  driverId,
  raceNumber,
  type,
  notes = null,
  metadataPatch = null,
  updatedBy = 'admin',
}) {
  const sb = supabase();
  if (!sb) throw new Error('Database not configured.');

  const normalizedType = String(type || '').toLowerCase();
  if (!PROVISIONAL_LEDGER_TYPES.includes(normalizedType)) {
    throw new Error('Provisional type must be free, purchased, or admin.');
  }

  const { data: existing, error: loadError } = await sb
    .from('driver_provisionals')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('driver_id', String(driverId))
    .eq('race_number', Number(raceNumber))
    .maybeSingle();

  if (loadError) throw new Error(loadError.message || 'Failed to load provisional ledger entry.');
  if (!existing) throw new Error('Provisional ledger entry not found.');

  const currentMetadata =
    existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
  const nextMetadata = {
    ...currentMetadata,
    ...(metadataPatch && typeof metadataPatch === 'object' ? metadataPatch : {}),
    lastUpdatedAt: new Date().toISOString(),
    lastUpdatedBy: updatedBy || 'admin',
  };

  if (normalizedType === 'free' || normalizedType === 'purchased') {
    nextMetadata.needsReview = false;
  } else if (updatedBy !== 'auto-sync') {
    nextMetadata.needsReview = false;
  }

  const updatePayload = {
    type: normalizedType,
    metadata: nextMetadata,
  };
  if (notes != null) {
    updatePayload.notes = String(notes || '').trim() || null;
  }

  const { data, error } = await sb
    .from('driver_provisionals')
    .update(updatePayload)
    .eq('season_id', String(seasonId))
    .eq('driver_id', String(driverId))
    .eq('race_number', Number(raceNumber))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to update provisional type.');
  if (!data) throw new Error('Provisional ledger entry not found.');
  return normalizeLedgerRow(data);
}

export async function updateDriverProvisionalNotes({
  seasonId,
  driverId,
  raceNumber,
  notes = '',
}) {
  const sb = supabase();
  if (!sb) throw new Error('Database not configured.');

  const { data, error } = await sb
    .from('driver_provisionals')
    .update({ notes: String(notes || '').trim() || null })
    .eq('season_id', String(seasonId))
    .eq('driver_id', String(driverId))
    .eq('race_number', Number(raceNumber))
    .select('*')
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to update provisional notes.');
  if (!data) throw new Error('Provisional ledger entry not found.');
  return normalizeLedgerRow(data);
}

export async function removeDriverProvisionalEntry({ seasonId, driverId, raceNumber }) {
  const sb = supabase();
  if (!sb) throw new Error('Database not configured.');

  const { error } = await sb
    .from('driver_provisionals')
    .delete()
    .eq('season_id', String(seasonId))
    .eq('driver_id', String(driverId))
    .eq('race_number', Number(raceNumber));

  if (error) throw new Error(error.message || 'Failed to remove provisional ledger entry.');
  return { ok: true };
}

async function loadOfficialProvisionalContextForRace(seasonId, raceNumber, options = {}) {
  const settings = options.settings || (await getSettings());
  const { loadOfficialRaceResultsContext } = await import('./_fantasy-race-scoring.js');
  const context = await loadOfficialRaceResultsContext({
    seasonId,
    raceNumber: Number(raceNumber),
    settings,
    scheduleRaces: options.scheduleRaces,
  });

  const officialIds = new Set();
  for (const [driverId, result] of Object.entries(context.driverResults || {})) {
    if (result?.isProvisional) officialIds.add(String(driverId));
  }
  return {
    officialProvisionalDriverIds: [...officialIds],
    resultsReady: context.ready,
    driverResults: context.driverResults || {},
    registeredDriverIds: context.registeredDriverIds || new Set(),
    driverLookup: context.driverLookup || new Map(),
    profileByDriverId: context.profileByDriverId || new Map(),
  };
}

async function loadOfficialProvisionalDriverIdsForRace(seasonId, raceNumber, options = {}) {
  const context = await loadOfficialProvisionalContextForRace(seasonId, raceNumber, options);
  return {
    officialProvisionalDriverIds: context.officialProvisionalDriverIds,
    resultsReady: context.resultsReady,
    driverResults: context.driverResults,
  };
}

export function buildLedgerValidationWarnings({
  ledgerEntries = [],
  officialProvisionalDriverIds = [],
  raceNumber = null,
  driverLookup = new Map(),
}) {
  const warnings = [];
  const officialSet = new Set((officialProvisionalDriverIds || []).map(String));
  const entries = Array.isArray(ledgerEntries) ? ledgerEntries : [];
  const raceScoped = raceNumber != null
    ? entries.filter((row) => Number(row.raceNumber) === Number(raceNumber))
    : entries;

  const byDriver = new Map();
  for (const row of entries) {
    const key = String(row.driverId);
    if (!byDriver.has(key)) byDriver.set(key, []);
    byDriver.get(key).push(row);
  }

  for (const [driverId, rows] of byDriver.entries()) {
    const summary = summarizeDriverProvisionalAllowance(rows);
    if (summary.freeProvisionalsUsed > FREE_PROVISIONALS_PER_SEASON) {
      const name = driverLookup.get(driverId)?.driverName || `Driver ${driverId}`;
      warnings.push({
        code: 'free_limit_exceeded',
        severity: 'warning',
        driverId,
        driverName: name,
        message: `${name} has more than two free provisionals recorded in the BP ledger.`,
      });
    }
  }

  for (const row of raceScoped) {
    const name = driverLookup.get(String(row.driverId))?.driverName || `Driver ${row.driverId}`;
    if (!officialSet.has(String(row.driverId))) {
      warnings.push({
        code: 'missing_official_provisional',
        severity: 'warning',
        driverId: row.driverId,
        driverName: name,
        raceNumber: row.raceNumber,
        message: `${name} has a BP ledger entry for Race ${row.raceNumber} but no official SimRacerHub provisional result.`,
      });
    }
  }

  for (const driverId of officialSet) {
    const hasLedger = raceScoped.some((row) => String(row.driverId) === String(driverId));
    if (!hasLedger) {
      const name = driverLookup.get(String(driverId))?.driverName || `Driver ${driverId}`;
      warnings.push({
        code: 'missing_ledger_entry',
        severity: 'warning',
        driverId,
        driverName: name,
        raceNumber,
        message: 'Official provisional detected with no BP ledger entry.',
      });
    }
  }

  return warnings;
}

export async function buildDriverProvisionalLedgerBoard(seasonId, options = {}) {
  const settings = options.settings || (await getSettings());
  const resolvedSeasonId = String(seasonId || settings.seasonId || '27987');
  const raceNumber =
    options.raceNumber != null ? Number(options.raceNumber) : options.focusRaceNumber ?? null;
  const shouldAutoSync = options.autoSync !== false;

  const [profiles, entries] = await Promise.all([
    getDriverProfiles(),
    listDriverProvisionalsForSeason(resolvedSeasonId),
  ]);

  const entriesByDriver = new Map();
  for (const entry of entries) {
    const key = String(entry.driverId);
    if (!entriesByDriver.has(key)) entriesByDriver.set(key, []);
    entriesByDriver.get(key).push(entry);
  }

  const driverLookup = new Map(
    profiles.map((profile) => [
      String(profile.driver_id),
      {
        driverId: String(profile.driver_id),
        driverName: profile.display_name || profile.iracing_name || `Driver ${profile.driver_id}`,
        carNumber: profile.car_number || '',
      },
    ]),
  );
  const knownDriverIds = new Set(profiles.map((profile) => String(profile.driver_id)));

  const drivers = profiles
    .map((profile) => {
      const driverId = String(profile.driver_id);
      const driverEntries = entriesByDriver.get(driverId) || [];
      return {
        driverId,
        driverName: profile.display_name || profile.iracing_name || `Driver ${driverId}`,
        carNumber: profile.car_number || '',
        allowance: summarizeDriverProvisionalAllowance(driverEntries),
        entries: driverEntries,
      };
    })
    .sort((a, b) => a.driverName.localeCompare(b.driverName));

  let official = {
    officialProvisionalDriverIds: [],
    resultsReady: false,
    driverResults: {},
    registeredDriverIds: new Set(),
    driverLookup,
  };
  let syncResult = null;

  if (raceNumber != null) {
    official = await loadOfficialProvisionalContextForRace(resolvedSeasonId, raceNumber, {
      settings,
      scheduleRaces: options.scheduleRaces,
    });

    if (shouldAutoSync && official.resultsReady) {
      const {
        buildOfficialProvisionalRows,
        syncOfficialProvisionalsToLedger,
        clearProvisionalSyncCache,
      } = await import('./_driver-provisional-sync.js');
      const officialRows = buildOfficialProvisionalRows(
        official.driverResults,
        official.driverLookup.size ? official.driverLookup : driverLookup,
      );

      syncResult = await syncOfficialProvisionalsToLedger({
        seasonId: resolvedSeasonId,
        raceNumber,
        officialProvisionalRows: officialRows,
        existingEntries: entries,
        knownDriverIds,
        driverLookup: official.driverLookup.size ? official.driverLookup : driverLookup,
        resultsReady: official.resultsReady,
        createdBy: options.createdBy || 'auto-sync',
        useCache: options.useSyncCache !== false,
      });

      if ((syncResult.created || []).length > 0) {
        clearProvisionalSyncCache(resolvedSeasonId, raceNumber);
        const refreshedEntries = await listDriverProvisionalsForSeason(resolvedSeasonId);
        entries.length = 0;
        entries.push(...refreshedEntries);
        entriesByDriver.clear();
        for (const entry of entries) {
          const key = String(entry.driverId);
          if (!entriesByDriver.has(key)) entriesByDriver.set(key, []);
          entriesByDriver.get(key).push(entry);
        }
        for (const driver of drivers) {
          driver.entries = entriesByDriver.get(driver.driverId) || [];
          driver.allowance = summarizeDriverProvisionalAllowance(driver.entries);
        }
      }
    }
  }

  const raceEntries = raceNumber != null
    ? entries.filter((row) => Number(row.raceNumber) === Number(raceNumber))
    : [];

  const warnings = buildLedgerValidationWarnings({
    ledgerEntries: entries,
    officialProvisionalDriverIds: official.officialProvisionalDriverIds,
    raceNumber,
    driverLookup,
  });

  if (syncResult?.warnings?.length) {
    warnings.push(...syncResult.warnings);
  }

  const autoSyncedRaceEntries = raceEntries
    .filter((entry) => entry.metadata?.autoCreated)
    .map((entry) => {
      const driver = driverLookup.get(String(entry.driverId));
      return {
        driverId: entry.driverId,
        driverName: driver?.driverName || `Driver ${entry.driverId}`,
        type: entry.type,
        finishPosition: entry.metadata?.officialFinishPosition ?? null,
        needsReview: Boolean(entry.metadata?.needsReview),
        metadata: entry.metadata,
      };
    });

  return {
    seasonId: resolvedSeasonId,
    raceNumber,
    freeProvisionalsPerSeason: FREE_PROVISIONALS_PER_SEASON,
    drivers,
    entries,
    raceEntries,
    autoSyncedRaceEntries,
    officialProvisionalDriverIds: official.officialProvisionalDriverIds,
    officialResultsReady: official.resultsReady,
    syncResult,
    warnings,
  };
}

export async function syncOfficialProvisionalsForRace(seasonId, raceNumber, options = {}) {
  const settings = options.settings || (await getSettings());
  const resolvedSeasonId = String(seasonId || settings.seasonId || '27987');
  const profiles = await getDriverProfiles();
  const knownDriverIds = new Set(profiles.map((profile) => String(profile.driver_id)));
  const driverLookup = new Map(
    profiles.map((profile) => [
      String(profile.driver_id),
      {
        driverId: String(profile.driver_id),
        driverName: profile.display_name || profile.iracing_name || `Driver ${profile.driver_id}`,
        carNumber: profile.car_number || '',
      },
    ]),
  );

  const [entries, official] = await Promise.all([
    listDriverProvisionalsForSeason(resolvedSeasonId),
    loadOfficialProvisionalContextForRace(resolvedSeasonId, raceNumber, {
      settings,
      scheduleRaces: options.scheduleRaces,
    }),
  ]);

  const {
    buildOfficialProvisionalRows,
    syncOfficialProvisionalsToLedger,
  } = await import('./_driver-provisional-sync.js');

  const officialRows = buildOfficialProvisionalRows(
    official.driverResults,
    official.driverLookup.size ? official.driverLookup : driverLookup,
  );

  return syncOfficialProvisionalsToLedger({
    seasonId: resolvedSeasonId,
    raceNumber,
    officialProvisionalRows: officialRows,
    existingEntries: entries,
    knownDriverIds,
    driverLookup: official.driverLookup.size ? official.driverLookup : driverLookup,
    resultsReady: official.resultsReady,
    createdBy: options.createdBy || 'auto-sync',
    useCache: options.useSyncCache !== false,
  });
}

export async function getProvisionalLedgerWarningsForRace(seasonId, raceNumber, options = {}) {
  const board = await buildDriverProvisionalLedgerBoard(seasonId, {
    ...options,
    raceNumber: Number(raceNumber),
  });
  return board.warnings || [];
}
