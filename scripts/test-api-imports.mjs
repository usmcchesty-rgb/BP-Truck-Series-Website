import assert from 'node:assert/strict';

const REQUIRED_EXPORTS = {
  '../api/_simracerhub-schedule-results.js': [
    'extractOfficialRaceField',
    'extractOfficialRaceFinishes',
    'buildCanonicalOfficialRaceResult',
    'isProvisionalRawResult',
  ],
  '../api/_fantasy-race-scoring.js': [
    'getFantasyRaceScoringStatus',
    'scoreFantasySlate',
    'matchFantasyDriverToResult',
    'loadOfficialRaceResultsContext',
  ],
};

async function assertModuleExports(modulePath, exportNames) {
  const mod = await import(modulePath);
  const missing = exportNames.filter((name) => mod[name] == null);
  assert.equal(
    missing.length,
    0,
    `${modulePath} missing exports: ${missing.join(', ')}`,
  );
}

async function assertFantasyRaceScoringImports() {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../api/_fantasy-race-scoring.js', import.meta.url), 'utf8'),
  );
  assert.match(
    source,
    /from '\.\/_simracerhub-schedule-results\.js'/,
    '_fantasy-race-scoring.js must import from ./_simracerhub-schedule-results.js',
  );
  assert.doesNotMatch(
    source,
    /import\s*\{[^}]*extractOfficialRaceField[^}]*\}\s*from\s*'\.\/_simracerhub-schedule-results\.js'/,
    '_fantasy-race-scoring.js must not statically import extractOfficialRaceField',
  );
}

for (const [modulePath, exportNames] of Object.entries(REQUIRED_EXPORTS)) {
  await assertModuleExports(modulePath, exportNames);
}

await assertFantasyRaceScoringImports();

const settings = await import('../api/settings.js');
assert.equal(typeof settings.default, 'function', 'api/settings.js must default-export a handler');

console.log('test-api-imports.mjs: all API import smoke checks passed');
