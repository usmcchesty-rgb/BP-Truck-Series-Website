import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../.env.local');
try {
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  console.warn('No .env.local found; audit requires Supabase credentials.');
}

const { auditFantasyDriverPoolHealth } = await import('../api/_fantasy-driver-pool.js');
const { getSettings, supabase } = await import('../api/_lib.js');
const { resolveFantasySlateProgression } = await import('../api/_fantasy-slate-progression.js');

const settings = await getSettings();
const seasonId = String(settings.seasonId || '27987');
const progression = await resolveFantasySlateProgression(seasonId, { settings });
const sb = supabase();
if (sb) {
  const { data: slates } = await sb
  .from('fantasy_slates')
  .select('id,race_number,status,generated_at,published_at')
  .eq('season_id', seasonId)
  .order('race_number', { ascending: false })
  .limit(6);
  console.log('Recent slates:', JSON.stringify(slates, null, 2));
}
console.log('Progression:', {
  activeRace: progression.activeSlateRow?.race_number,
  nextRace: progression.nextRaceNumber,
  archivedRace: progression.archivedSlateRow?.race_number,
});

const auditRace =
  progression.activeSlateRow?.race_number ??
  progression.nextRaceNumber ??
  null;
const audit = await auditFantasyDriverPoolHealth(seasonId, { settings, raceNumber: auditRace });

const focusNames = [
  'Brad Collins',
  'Rick Thompson',
  'Gordon Miller',
  'Fred Thompson',
  'John Perkins',
];
console.log('\nFocused driver audit (race', auditRace, '):');
for (const name of focusNames) {
  const driver = audit.drivers.find((row) => row.driverName === name);
  console.log(JSON.stringify(driver, null, 2));
}

console.log('\nSummary:', {
  driverPoolStatus: audit.driverPoolStatus,
  eligibleRosterDrivers: audit.counts.eligibleRosterDrivers,
  driversInDraft: audit.counts.driversInDraft,
  driversInPublishedSlate: audit.counts.driversInPublishedSlate,
  missingEligibleDrivers: audit.counts.missingEligibleDrivers,
  recommendation: audit.recommendation,
});
