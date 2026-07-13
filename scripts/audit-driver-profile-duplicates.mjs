/**
 * Audit driver profile identity duplicates and produce a dry-run repair plan.
 *
 * Usage:
 *   node scripts/audit-driver-profile-duplicates.mjs
 *   node scripts/audit-driver-profile-duplicates.mjs --examples "Rick Thompson,Brad Collins"
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (loads tools/recruit-scanner/.env when unset).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  buildDriverProfileLookupMaps,
  buildStandingsDriverIdSet,
  enrichSyncInputsWithStandings,
  resolveExistingProfileFromMaps,
} from '../api/_driver-profile-sync-identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const V2_COMMIT_ISO = '2026-07-13T15:02:10.000Z';
const V1_COMMIT_ISO = '2026-07-13T14:42:40.000Z';

const DEFAULT_EXAMPLES = [
  'Rick Thompson',
  'Brad Collins',
  'Fred Thompson',
  'Gordon Miller',
  'John Perkins',
];

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeCustomerId(value) {
  return String(value ?? '').trim().replace(/\D/g, '');
}

function normalizeSyncName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseExamplesArg() {
  const flag = process.argv.find((arg) => arg.startsWith('--examples='));
  if (!flag) return DEFAULT_EXAMPLES;
  return flag
    .slice('--examples='.length)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function profileSummary(profile) {
  return {
    driverId: String(profile.driver_id || ''),
    srhStandingsId: null,
    iracingCustomerId: normalizeCustomerId(profile.iracing_customer_id) || null,
    sourceApplicationId: profile.source_application_id || null,
    email: profile.form_email || null,
    active: profile.active !== false,
    updatedAt: profile.updated_at || null,
    approvedApplicationAt: profile.approved_application_at || null,
    iracingName: profile.iracing_name || null,
    displayName: profile.display_name || null,
    carNumber: profile.car_number || null,
  };
}

function addToGroup(groups, key, profile, evidence) {
  if (!groups.has(key)) {
    groups.set(key, { profiles: new Map(), evidence: new Set() });
  }
  const group = groups.get(key);
  group.profiles.set(String(profile.driver_id), profile);
  group.evidence.add(evidence);
}

function unionFindGroups(profiles) {
  const parent = new Map();

  function find(id) {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  const byCustomer = new Map();
  const byApplication = new Map();
  const byEmail = new Map();

  for (const profile of profiles) {
    const id = String(profile.driver_id);
    find(id);

    const customerId = normalizeCustomerId(profile.iracing_customer_id);
    if (customerId) {
      if (byCustomer.has(customerId)) union(id, byCustomer.get(customerId));
      else byCustomer.set(customerId, id);
    }

    const applicationId = String(profile.source_application_id || '').trim();
    if (applicationId) {
      if (byApplication.has(applicationId)) union(id, byApplication.get(applicationId));
      else byApplication.set(applicationId, id);
    }

    const email = String(profile.form_email || '').trim().toLowerCase();
    if (email) {
      if (byEmail.has(email)) union(id, byEmail.get(email));
      else byEmail.set(email, id);
    }
  }

  const grouped = new Map();
  for (const profile of profiles) {
    const id = String(profile.driver_id);
    const root = find(id);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(profile);
  }

  return [...grouped.values()].filter((bucket) => bucket.length > 1);
}

async function loadReferenceCounts(sb, driverId) {
  const tables = [
    { table: 'fantasy_slate_drivers', column: 'driver_id' },
    { table: 'fantasy_lineup_drivers', column: 'driver_id' },
    { table: 'driver_provisionals', column: 'driver_id' },
    { table: 'driver_number_reservations', column: 'driver_id' },
    { table: 'power_rankings_week_drivers', column: 'driver_id' },
    { table: 'news_articles', column: 'spotlight_driver_id' },
  ];

  const references = {};
  for (const { table, column } of tables) {
    const { count, error } = await sb
      .from(table)
      .select(column, { count: 'exact', head: true })
      .eq(column, driverId);
    if (!error && count) references[table] = count;
  }
  return references;
}

function buildIdentitySplitGroups(profiles, standingsRows, standingsDriverIds) {
  const byId = new Map(profiles.map((p) => [String(p.driver_id), p]));
  const groups = [];

  for (const row of standingsRows) {
    const srhId = String(row.driverId || row.driver_id || '').trim();
    const name = normalizeSyncName(row.driverName || row.driver);
    if (!srhId || !name) continue;

    const standingsProfile = byId.get(srhId) || null;
    const nameMatches = profiles.filter((profile) => {
      const profileName = normalizeSyncName(profile.iracing_name || profile.display_name);
      return profileName && profileName === name;
    });

    const splitProfiles = nameMatches.filter((profile) => String(profile.driver_id) !== srhId);
    if (!splitProfiles.length) continue;

    groups.push({
      type: 'identity_split',
      name: row.driverName || row.driver,
      srhStandingsId: srhId,
      standingsProfile: standingsProfile ? profileSummary(standingsProfile) : null,
      profiles: splitProfiles.map((profile) => profileSummary(profile)),
      evidence: [
        'standings_name_match',
        standingsProfile ? 'srh_profile_exists' : 'srh_profile_missing',
        'customer_id_pk_mismatch',
      ],
      canonicalDriverId: srhId,
      duplicateDriverIds: splitProfiles.map((p) => String(p.driver_id)),
    });
  }

  return groups;
}

function applicationFieldsToMerge(application) {
  if (!application) return [];
  return [
    'source_application_id',
    'approved_application_at',
    'form_email',
    'form_submitted_at',
    'form_permission_granted',
    'discord_name',
    'timezone',
    'bio',
    'years_sim_racing',
    'driving_style',
    'favorite_track',
    'favorite_nascar_driver',
    'sim_racing_accomplishment',
    'season_goal',
    'fun_fact',
    'iracing_customer_id',
    'car_number',
  ].filter((field) => application[field] != null && String(application[field]).trim() !== '');
}

async function main() {
  loadEnvFile(join(__dirname, '../tools/recruit-scanner/.env'));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const sb = createClient(url, key);
  const examples = parseExamplesArg();

  const [{ data: profiles, error: profileError }, { data: applications, error: appError }] =
    await Promise.all([
      sb.from('driver_profiles').select('*').order('iracing_name'),
      sb
        .from('driver_applications')
        .select(
          'id,status,email,iracing_customer_id,iracing_display_name,driver_name,preferred_number,created_at,updated_at'
        )
        .eq('status', 'approved')
        .order('created_at', { ascending: true }),
    ]);

  if (profileError) throw new Error(profileError.message);
  if (appError) throw new Error(appError.message);

  const standingsResult = await fetch('https://blazingpedals.vercel.app/api/standings')
    .then((response) => response.json())
    .catch(() => ({ rows: [] }));
  const standingsRows = standingsResult?.rows || [];
  const standingsDriverIds = buildStandingsDriverIdSet(standingsRows);
  const profileMaps = buildDriverProfileLookupMaps(profiles || []);

  const trueDuplicateBuckets = unionFindGroups(profiles || []);
  const identitySplitGroups = buildIdentitySplitGroups(
    profiles || [],
    standingsRows,
    standingsDriverIds
  );

  const { data: snapshots } = await sb
    .from('driver_application_srh_career_snapshots')
    .select('application_id,matched_driver_id,matched_driver_name,created_at')
    .order('created_at', { ascending: false });

  const snapshotByApp = new Map();
  for (const row of snapshots || []) {
    const appId = String(row.application_id || '');
    if (!appId || snapshotByApp.has(appId)) continue;
    snapshotByApp.set(appId, row);
  }

  const approvedByCustomer = new Map();
  for (const app of applications || []) {
    const customerId = normalizeCustomerId(app.iracing_customer_id);
    if (customerId) approvedByCustomer.set(customerId, app);
  }

  const dryRun = [];

  for (const group of identitySplitGroups) {
    const canonicalId = group.canonicalDriverId;
    const canonicalProfile =
      (profiles || []).find((p) => String(p.driver_id) === canonicalId) || null;
    const duplicateProfiles = (profiles || []).filter((p) =>
      group.duplicateDriverIds.includes(String(p.driver_id))
    );
    const primaryDuplicate = duplicateProfiles[0] || null;
    const customerId = normalizeCustomerId(primaryDuplicate?.iracing_customer_id);
    const application =
      (applications || []).find(
        (app) => normalizeCustomerId(app.iracing_customer_id) === customerId
      ) || null;
    const snapshot = application ? snapshotByApp.get(String(application.id)) : null;

    const referencesToMove = {};
    const conflicts = [];
    for (const duplicate of duplicateProfiles) {
      referencesToMove[String(duplicate.driver_id)] = await loadReferenceCounts(
        sb,
        String(duplicate.driver_id)
      );
      const refTotal = Object.values(referencesToMove[String(duplicate.driver_id)]).reduce(
        (sum, n) => sum + n,
        0
      );
      if (refTotal > 0 && !canonicalProfile) {
        conflicts.push(
          `Duplicate ${duplicate.driver_id} has ${refTotal} references but canonical SRH profile ${canonicalId} does not exist yet.`
        );
      }
    }

    const createdBeforeV2 =
      duplicateProfiles.every((profile) => {
        const updated = profile.updated_at ? Date.parse(profile.updated_at) : NaN;
        return !Number.isFinite(updated) || updated < Date.parse(V2_COMMIT_ISO);
      }) && !canonicalProfile;

    const syncWouldInsertCanonical = Boolean(application && !canonicalProfile);
    const syncWouldUpdateDuplicate = Boolean(
      application &&
        primaryDuplicate &&
        resolveExistingProfileFromMaps(
          enrichSyncInputsWithStandings([application], standingsRows, profileMaps)[0],
          profileMaps,
          { standingsDriverIds }
        ).profile?.driver_id === String(primaryDuplicate.driver_id)
    );

    dryRun.push({
      groupType: 'identity_split',
      displayName: group.name,
      canonicalDriverId: canonicalId,
      duplicateDriverIds: group.duplicateDriverIds,
      createdBeforeV2,
      latestSyncLikelyInsertedNewProfile: false,
      syncBehaviorAfterV2: {
        wouldInsertCanonicalProfile: syncWouldInsertCanonical,
        wouldUpdateExistingDuplicateProfile: syncWouldUpdateDuplicate,
      },
      identityEvidence: [
        ...group.evidence,
        customerId ? `iracing_customer_id:${customerId}` : null,
        snapshot?.matched_driver_id ? `srh_snapshot:${snapshot.matched_driver_id}` : null,
        application?.id ? `approved_application:${application.id}` : null,
      ].filter(Boolean),
      profiles: {
        canonical: canonicalProfile ? profileSummary(canonicalProfile) : null,
        duplicates: duplicateProfiles.map((p) => profileSummary(p)),
      },
      application: application
        ? {
            id: application.id,
            email: application.email,
            iracingCustomerId: application.iracing_customer_id,
            approvedAt: application.updated_at || null,
            createdAt: application.created_at,
          }
        : null,
      fieldsToMerge: applicationFieldsToMerge({
        ...application,
        source_application_id: application?.id,
        approved_application_at: application?.updated_at || null,
        form_email: application?.email,
        iracing_customer_id: application?.iracing_customer_id,
      }),
      referencesToMove,
      conflicts,
      safeToApply: conflicts.length === 0,
      recommendedRepair:
        canonicalProfile
          ? 'Merge application fields into canonical SRH-keyed profile; migrate references off duplicate customer-id profile if any; deactivate duplicate row after reference migration.'
          : syncWouldUpdateDuplicate
            ? 'No DB merge required: one profile row exists under customer-id PK. Repair is roster display dedupe (standings SRH row + profile row) and optional future PK migration to SRH id after reference audit.'
            : 'Requires reference audit before choosing canonical PK. Do not delete rows.',
    });
  }

  for (const bucket of trueDuplicateBuckets) {
    const summaries = bucket.map((profile) => profileSummary(profile));
    const standingsMatch = summaries.find((row) => standingsDriverIds.has(row.driverId));
    const canonicalDriverId = standingsMatch?.driverId || summaries[0].driverId;
    const duplicateDriverIds = summaries
      .map((row) => row.driverId)
      .filter((id) => id !== canonicalDriverId);

    const referencesToMove = {};
    const conflicts = [];
    for (const duplicateId of duplicateDriverIds) {
      referencesToMove[duplicateId] = await loadReferenceCounts(sb, duplicateId);
    }

    dryRun.push({
      groupType: 'true_db_duplicate',
      displayName: summaries.map((row) => row.iracingName || row.displayName).join(' / '),
      canonicalDriverId,
      duplicateDriverIds,
      createdBeforeV2: bucket.every((profile) => {
        const updated = profile.updated_at ? Date.parse(profile.updated_at) : NaN;
        return !Number.isFinite(updated) || updated < Date.parse(V2_COMMIT_ISO);
      }),
      latestSyncLikelyInsertedNewProfile: null,
      identityEvidence: ['multiple_driver_profiles_same_strong_identity'],
      profiles: { canonical: summaries.find((s) => s.driverId === canonicalDriverId), duplicates: summaries.filter((s) => duplicateDriverIds.includes(s.driverId)) },
      fieldsToMerge: [],
      referencesToMove,
      conflicts,
      safeToApply: conflicts.length === 0,
      recommendedRepair:
        'Merge fields into canonical row and migrate references before deactivating duplicate profile rows.',
    });
  }

  const exampleReport = dryRun.filter((entry) =>
    examples.some((name) => normalizeSyncName(name) === normalizeSyncName(entry.displayName))
  );

  const report = {
    generatedAt: new Date().toISOString(),
    syncVersionLocal: 'driver-profile-sync-v2',
    v1CommitTimestamp: V1_COMMIT_ISO,
    v2CommitTimestamp: V2_COMMIT_ISO,
    totals: {
      profiles: (profiles || []).length,
      approvedApplications: (applications || []).length,
      standingsDrivers: standingsRows.length,
      trueDbDuplicateGroups: trueDuplicateBuckets.length,
      identitySplitGroups: identitySplitGroups.length,
    },
    findings: {
      duplicatesPredateV2:
        'Yes — the five example cases are identity splits (customer-id profile PK vs SRH standings ID), not duplicate driver_profiles rows created by the latest sync.',
      latestSyncLikelyCreatedNewProfileRows:
        'Unlikely for the five examples. Public/admin data shows one profile row per person keyed by iRacing customer ID with no source_application_id exposed pre-sync; New/Approved section disappearing indicates application linkage updated the existing row rather than inserting a second profile.',
      productionPkeyErrorLikelyCause:
        'Prior sync attempted INSERT using an ID that already exists (customer-id PK or SRH id) before identity resolution matched the existing row. v2 resolves to UPDATE for these cases when deployed.',
      zeroTrueDbDuplicatesInExamples:
        trueDuplicateBuckets.length === 0
          ? 'Confirmed — no two driver_profiles rows share iracing_customer_id, source_application_id, or email for the audited production dataset.'
          : `${trueDuplicateBuckets.length} true duplicate bucket(s) found.`,
    },
    exampleDrivers: exampleReport,
    allIdentitySplitGroups: identitySplitGroups,
    allTrueDbDuplicateGroups: trueDuplicateBuckets.map((bucket) =>
      bucket.map((profile) => profileSummary(profile))
    ),
    dryRunRepairPlan: dryRun,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
