import {
  FREE_PROVISIONALS_PER_SEASON,
  summarizeDriverProvisionalAllowance,
  listDriverProvisionalsForSeason,
  addDriverProvisionalEntry,
} from './_driver-provisionals.js';

const SYNC_CACHE_TTL_MS = 60_000;
const syncResultCache = new Map();

function readSyncCache(cacheKey) {
  const cached = syncResultCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > SYNC_CACHE_TTL_MS) {
    syncResultCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function writeSyncCache(cacheKey, value) {
  syncResultCache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}

export function buildOfficialProvisionalRows(driverResults = {}, driverLookup = new Map()) {
  const rows = [];

  for (const [driverId, result] of Object.entries(driverResults || {})) {
    if (!result?.isProvisional) continue;
    const finishPosition = Number(result.finishPosition ?? result.finish);
    rows.push({
      driverId: String(driverId),
      driverName:
        driverLookup.get(String(driverId))?.driverName ||
        result.driverName ||
        `Driver ${driverId}`,
      finishPosition: Number.isFinite(finishPosition) ? finishPosition : null,
      status: result.status || 'Provisional',
      participationStatus: result.participationStatus || 'provisional',
    });
  }

  return rows.sort((a, b) => {
    const left = Number.isFinite(a.finishPosition) ? a.finishPosition : 999;
    const right = Number.isFinite(b.finishPosition) ? b.finishPosition : 999;
    return left - right;
  });
}

export function resolveAutoProvisionalType(driverSeasonEntries = [], raceNumber) {
  const priorEntries = (driverSeasonEntries || []).filter(
    (entry) => Number(entry.raceNumber) !== Number(raceNumber),
  );
  const allowance = summarizeDriverProvisionalAllowance(priorEntries);

  if (allowance.freeProvisionalsUsed < FREE_PROVISIONALS_PER_SEASON) {
    return {
      type: 'free',
      needsReview: false,
      notes: null,
    };
  }

  return {
    type: 'admin',
    needsReview: true,
    notes:
      'Official provisional detected after free allowance exhausted. Purchased/admin review required.',
  };
}

export function buildAutoSyncMetadata({ finishPosition, status, needsReview }) {
  return {
    source: 'simracerhub',
    autoCreated: true,
    officialDetectedAt: new Date().toISOString(),
    officialFinishPosition: Number.isFinite(Number(finishPosition)) ? Number(finishPosition) : null,
    officialStatus: status || 'Provisional',
    needsReview: Boolean(needsReview),
  };
}

export function buildProvisionalSyncMessage({ created = [], needsReview = [] } = {}) {
  const createdCount = created.length;
  const reviewCount = needsReview.length;

  if (!createdCount && !reviewCount) {
    return 'Provisional ledger is in sync with official SimRacerHub results.';
  }

  const parts = [];
  if (createdCount) {
    parts.push(
      `${createdCount} official provisional${createdCount === 1 ? '' : 's'} auto-added`,
    );
  }
  if (reviewCount) {
    parts.push(
      `${reviewCount} require${reviewCount === 1 ? 's' : ''} purchased/admin classification`,
    );
  }
  return `${parts.join('. ')}.`;
}

export function summarizeProvisionalLedgerSyncStatus({
  officialProvisionalRows = [],
  raceEntries = [],
  syncWarnings = [],
  needsReview = [],
} = {}) {
  const officialIds = new Set(officialProvisionalRows.map((row) => String(row.driverId)));
  const raceEntryIds = new Set((raceEntries || []).map((entry) => String(entry.driverId)));
  const unmatchedWarnings = (syncWarnings || []).filter((warning) => warning.code === 'unmatched_driver');
  const ledgerOnlyCount = (raceEntries || []).filter(
    (entry) => !officialIds.has(String(entry.driverId)),
  ).length;
  const missingLedgerCount = [...officialIds].filter((driverId) => !raceEntryIds.has(driverId)).length;
  const reviewCount = (needsReview || []).length;

  const complete =
    missingLedgerCount === 0 &&
    unmatchedWarnings.length === 0 &&
    reviewCount === 0;

  return {
    complete,
    needsReview: !complete,
    officialCount: officialProvisionalRows.length,
    ledgerCount: raceEntries.length,
    autoCreatedCount: (raceEntries || []).filter((entry) => entry.metadata?.autoCreated).length,
    reviewCount,
    unmatchedCount: unmatchedWarnings.length,
    ledgerOnlyCount,
    missingLedgerCount,
    message: complete
      ? 'All official provisionals have valid ledger entries.'
      : buildProvisionalSyncMessage({
          created: [],
          needsReview,
        }) ||
        'Provisional ledger review required.',
  };
}

export async function syncOfficialProvisionalsToLedger({
  seasonId,
  raceNumber,
  officialProvisionalRows = [],
  existingEntries = null,
  knownDriverIds = null,
  driverLookup = new Map(),
  createdBy = 'auto-sync',
  resultsReady = true,
  skipIfNoResults = true,
  useCache = true,
  insertEntry = addDriverProvisionalEntry,
}) {
  const resolvedSeasonId = String(seasonId);
  const resolvedRaceNumber = Number(raceNumber);

  if (!Number.isFinite(resolvedRaceNumber) || resolvedRaceNumber < 1) {
    return {
      skipped: true,
      reason: 'invalid_race_number',
      created: [],
      warnings: [],
      needsReview: [],
    };
  }

  if (!resultsReady && skipIfNoResults) {
    return {
      skipped: true,
      reason: 'results_not_ready',
      created: [],
      warnings: [],
      needsReview: [],
    };
  }

  const cacheKey = `${resolvedSeasonId}:${resolvedRaceNumber}`;
  if (useCache) {
    const cached = readSyncCache(cacheKey);
    if (cached) return cached;
  }

  const entries = Array.isArray(existingEntries)
    ? [...existingEntries]
    : await listDriverProvisionalsForSeason(resolvedSeasonId);

  const entriesByDriver = new Map();
  for (const entry of entries) {
    const key = String(entry.driverId);
    if (!entriesByDriver.has(key)) entriesByDriver.set(key, []);
    entriesByDriver.get(key).push(entry);
  }

  const raceScoped = entries.filter((entry) => Number(entry.raceNumber) === resolvedRaceNumber);
  const raceScopedByDriver = new Map(
    raceScoped.map((entry) => [String(entry.driverId), entry]),
  );

  const created = [];
  const warnings = [];
  const needsReview = [];
  const preserved = [];

  for (const row of officialProvisionalRows) {
    const driverId = String(row.driverId);
    const driverName = row.driverName || driverLookup.get(driverId)?.driverName || `Driver ${driverId}`;

    if (knownDriverIds && !knownDriverIds.has(driverId)) {
      warnings.push({
        code: 'unmatched_driver',
        severity: 'warning',
        driverId,
        driverName,
        raceNumber: resolvedRaceNumber,
        message: `Official provisional for ${driverName} could not be matched to a BP driver profile.`,
      });
      continue;
    }

    const existing = raceScopedByDriver.get(driverId);
    if (existing) {
      preserved.push(existing);
      if (existing.metadata?.needsReview) {
        needsReview.push({
          driverId,
          driverName,
          entry: existing,
          reason: 'needs_review',
        });
      }
      continue;
    }

    const driverEntries = entriesByDriver.get(driverId) || [];
    const typeDecision = resolveAutoProvisionalType(driverEntries, resolvedRaceNumber);
    const metadata = buildAutoSyncMetadata({
      finishPosition: row.finishPosition,
      status: row.status,
      needsReview: typeDecision.needsReview,
    });

    try {
      const entry = await insertEntry({
        seasonId: resolvedSeasonId,
        driverId,
        raceNumber: resolvedRaceNumber,
        type: typeDecision.type,
        notes: typeDecision.notes,
        createdBy,
        metadata,
      });
      created.push(entry);
      entries.push(entry);
      raceScoped.push(entry);
      raceScopedByDriver.set(driverId, entry);
      if (!entriesByDriver.has(driverId)) entriesByDriver.set(driverId, []);
      entriesByDriver.get(driverId).push(entry);

      if (typeDecision.needsReview) {
        needsReview.push({
          driverId,
          driverName,
          entry,
          reason: 'free_allowance_exhausted',
        });
      }
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('duplicate')) {
        preserved.push({ driverId, raceNumber: resolvedRaceNumber });
        continue;
      }
      warnings.push({
        code: 'sync_insert_failed',
        severity: 'error',
        driverId,
        driverName,
        raceNumber: resolvedRaceNumber,
        message: error.message || 'Failed to auto-create provisional ledger entry.',
      });
    }
  }

  const result = {
    skipped: false,
    seasonId: resolvedSeasonId,
    raceNumber: resolvedRaceNumber,
    created,
    preserved: preserved.length,
    needsReview,
    warnings,
    officialCount: officialProvisionalRows.length,
    message: buildProvisionalSyncMessage({ created, needsReview }),
    status: summarizeProvisionalLedgerSyncStatus({
      officialProvisionalRows,
      raceEntries: [...raceScoped, ...created],
      syncWarnings: warnings,
      needsReview,
    }),
  };

  if (useCache) {
    writeSyncCache(cacheKey, result);
  }

  return result;
}

export function clearProvisionalSyncCache(seasonId = null, raceNumber = null) {
  if (seasonId == null && raceNumber == null) {
    syncResultCache.clear();
    return;
  }
  if (raceNumber != null) {
    syncResultCache.delete(`${String(seasonId)}:${Number(raceNumber)}`);
    return;
  }
  for (const key of syncResultCache.keys()) {
    if (key.startsWith(`${String(seasonId)}:`)) syncResultCache.delete(key);
  }
}
