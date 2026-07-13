import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  buildDriverProfileLookupMaps,
  buildStandingsDriverIdSet,
  enrichSyncInputsWithStandings,
  mergeApprovedSyncInputs,
  resolveExistingProfileFromMaps,
  resolveIncomingDriverId,
} from '../api/_driver-profile-sync-identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(filePath) {
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

loadEnv(join(__dirname, '../tools/recruit-scanner/.env'));
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const [{ data: profiles }, { data: applications }, { data: snapshots }] = await Promise.all([
  sb.from('driver_profiles').select('*'),
  sb.from('driver_applications').select('*').eq('status', 'approved'),
  sb
    .from('driver_application_srh_career_snapshots')
    .select('application_id,matched_driver_id,created_at')
    .order('created_at', { ascending: false }),
]);

const standings = await fetch('https://blazingpedals.vercel.app/api/standings').then((r) => r.json());
const standingsRows = standings.rows || [];
const standingsDriverIds = buildStandingsDriverIdSet(standingsRows);

const snapshotByApp = new Map();
for (const row of snapshots || []) {
  const appId = String(row.application_id || '');
  if (!appId || snapshotByApp.has(appId)) continue;
  snapshotByApp.set(appId, row);
}

let profileMaps = buildDriverProfileLookupMaps(profiles || []);
const merged = mergeApprovedSyncInputs(applications || [], snapshotByApp);
const queue = enrichSyncInputsWithStandings(merged, standingsRows, profileMaps);

const results = [];
for (const app of queue) {
  const match = resolveExistingProfileFromMaps(app, profileMaps, { standingsDriverIds });
  const incomingId = resolveIncomingDriverId(app);
  results.push({
    name: app.iracing_display_name,
    applicationId: app.id,
    customerId: app.iracing_customer_id,
    srhDriverId: app.srh_driver_id,
    incomingDriverId: incomingId,
    matchDriverId: match.profile?.driver_id || null,
    matchMethod: match.matchedBy,
    action: match.profile ? 'UPDATE' : 'INSERT',
    existingSourceApp: match.profile?.source_application_id || null,
  });
}

console.log(JSON.stringify({ total: results.length, insertAttempts: results.filter((r) => r.action === 'INSERT'), all: results }, null, 2));
