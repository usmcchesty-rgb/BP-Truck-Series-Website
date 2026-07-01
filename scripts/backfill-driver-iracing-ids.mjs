/**
 * Backfill driver_profiles.iracing_customer_id from scripts/data/driver-iracing-customer-ids.json
 *
 * Dry run (default):
 *   node scripts/backfill-driver-iracing-ids.mjs
 *
 * Apply updates (requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   node scripts/backfill-driver-iracing-ids.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDriverProfiles, supabase } from '../api/_lib.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingDigits(value) {
  return normalizeName(value).replace(/\d+$/, '').trim();
}

function profileNames(profile) {
  return [profile.display_name, profile.iracing_name, profile.driver_name]
    .filter(Boolean)
    .map(normalizeName);
}

function matchProfile(entryName, profiles) {
  const entryNorm = normalizeName(entryName);
  const entryStripped = stripTrailingDigits(entryName);

  let match = profiles.find((profile) => profileNames(profile).includes(entryNorm));
  if (match) return { profile: match, method: 'name_exact' };

  match = profiles.find((profile) => {
    const names = profileNames(profile);
    return names.some(
      (name) =>
        (name.includes(entryNorm) || entryNorm.includes(name)) &&
        name.split(' ').filter((token) => token.length > 2).length >= 2
    );
  });
  if (match) return { profile: match, method: 'name_fuzzy' };

  match = profiles.find((profile) => {
    const names = profileNames(profile).map(stripTrailingDigits);
    return names.some(
      (name) =>
        name &&
        entryStripped &&
        (name === entryStripped || name.includes(entryStripped) || entryStripped.includes(name))
    );
  });
  if (match) return { profile: match, method: 'name_stripped_digits' };

  return { profile: null, method: null };
}

function loadMapping() {
  const raw = readFileSync(
    join(__dirname, 'data', 'driver-iracing-customer-ids.json'),
    'utf8'
  );
  return JSON.parse(raw);
}

async function main() {
  const mapping = loadMapping();
  const sb = supabase();
  if (!sb) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const profiles = await getDriverProfiles();
  const usedCustomerIds = new Map(
    profiles
      .filter((profile) => String(profile.iracing_customer_id || '').trim())
      .map((profile) => [String(profile.iracing_customer_id).trim(), profile])
  );

  const matched = [];
  const unmatched = [];
  const skipped = [];
  const conflicts = [];

  for (const entry of mapping) {
    const customerId = String(entry.iracingCustomerId || '').trim();
    const { profile, method } = matchProfile(entry.iracingName, profiles);

    if (!profile) {
      unmatched.push(entry);
      continue;
    }

    const currentId = String(profile.iracing_customer_id || '').trim();
    const owner = usedCustomerIds.get(customerId);
    if (owner && owner.driver_id !== profile.driver_id) {
      conflicts.push({
        entry,
        profile,
        method,
        reason: `Customer ID ${customerId} already assigned to ${owner.display_name || owner.iracing_name} (${owner.driver_id})`,
      });
      continue;
    }

    if (currentId && currentId !== customerId) {
      skipped.push({
        entry,
        profile,
        method,
        reason: `Profile already has iracing_customer_id ${currentId}`,
      });
      continue;
    }

    if (currentId === customerId) {
      skipped.push({
        entry,
        profile,
        method,
        reason: 'Already set',
      });
      continue;
    }

    matched.push({ entry, profile, method });
  }

  console.log(`Mapping entries: ${mapping.length}`);
  console.log(`Driver profiles loaded: ${profiles.length}`);
  console.log(`Matched: ${matched.length}`);
  console.log(`Unmatched: ${unmatched.length}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`Conflicts: ${conflicts.length}`);
  console.log('');

  if (matched.length) {
    console.log('Matched updates:');
    for (const row of matched) {
      console.log(
        `  ${row.entry.iracingName} -> ${row.entry.iracingCustomerId} | ${row.profile.display_name || row.profile.iracing_name} (${row.profile.driver_id}) [${row.method}]`
      );
    }
    console.log('');
  }

  if (unmatched.length) {
    console.log('Unmatched sheet names:');
    for (const row of unmatched) {
      console.log(`  ${row.iracingName} (${row.iracingCustomerId})`);
    }
    console.log('');
  }

  if (conflicts.length) {
    console.log('Conflicts:');
    for (const row of conflicts) {
      console.log(`  ${row.entry.iracingName}: ${row.reason}`);
    }
    console.log('');
  }

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write updates.');
    return;
  }

  let updated = 0;
  for (const row of matched) {
    const { error } = await sb
      .from('driver_profiles')
      .update({
        iracing_customer_id: row.entry.iracingCustomerId,
        updated_at: new Date().toISOString(),
      })
      .eq('driver_id', row.profile.driver_id);

    if (error) {
      console.error(
        `Failed ${row.entry.iracingName} (${row.profile.driver_id}): ${error.message}`
      );
      continue;
    }
    updated += 1;
  }

  console.log(`Applied ${updated} update(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
