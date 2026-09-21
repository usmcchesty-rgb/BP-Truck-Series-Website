import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import {
  easternLocalDateTimeToUtcIso,
  formatPublicFantasyLockDisplay,
  formatPublicLockDateLabel,
  formatPublicLockTimeEt,
  resolvePublicLockRaceDate,
} from '../api/_fantasy-lock-time.js';
import { parseLockState } from '../api/_fantasy-lineups.js';

function loadClientHelper() {
  return readFile(new URL('../public/fantasy-lock-display.js', import.meta.url), 'utf8').then((source) => {
    const sandbox = { window: {}, console };
    runInContext(source, createContext(sandbox));
    return sandbox.window.BPFantasyLockDisplay;
  });
}

const RACE_23_DATE = 'September 27, 2026';
const RACE_23_LOCK_TIME = '6:30pm EST';
const RACE_23_LOCK_AT = easternLocalDateTimeToUtcIso({
  year: 2026,
  month: 9,
  day: 27,
  hour: 18,
  minute: 30,
});
const RACE_23_DISPLAY = 'Sunday, Sep 27 · 6:30 PM ET';

const RACE_15_DATE = 'Jul 12, 2026';
const RACE_15_LOCK_AT = easternLocalDateTimeToUtcIso({
  year: 2026,
  month: 7,
  day: 12,
  hour: 18,
  minute: 30,
});
const RACE_15_DISPLAY = 'Sunday, Jul 12 · 6:30 PM ET';

const race23 = formatPublicFantasyLockDisplay({
  lockTime: RACE_23_LOCK_TIME,
  lockAt: RACE_23_LOCK_AT,
  raceDate: RACE_23_DATE,
});
assert.equal(race23, RACE_23_DISPLAY, `Race 23 Milwaukee should format as ${RACE_23_DISPLAY}`);
assert.equal(
  formatPublicFantasyLockDisplay({
    lockTime: RACE_23_LOCK_TIME,
    lockAt: RACE_23_LOCK_AT,
  }),
  RACE_23_DISPLAY,
  'Race 23 lock_at in Eastern time is enough to recover the race date',
);
assert.equal(
  formatPublicLockDateLabel({ raceDate: RACE_23_DATE }),
  'Sunday, Sep 27',
);
assert.equal(formatPublicLockTimeEt(RACE_23_LOCK_TIME), '6:30 PM ET');
assert.doesNotMatch(race23, /\bEST\b/);
assert.doesNotMatch(race23, /\bEDT\b/);

const historical = formatPublicFantasyLockDisplay({
  lockTime: RACE_23_LOCK_TIME,
  lockAt: RACE_15_LOCK_AT,
  raceDate: RACE_15_DATE,
});
assert.equal(historical, RACE_15_DISPLAY, 'Historical slate must keep its own race date');
assert.notEqual(historical, race23);

assert.equal(
  formatPublicLockDateLabel({
    raceDate: RACE_15_DATE,
    lockAt: RACE_23_LOCK_AT,
  }),
  'Sunday, Jul 12',
  'This slate raceDate wins over a different lock_at so archives stay historically correct',
);

assert.equal(
  formatPublicFantasyLockDisplay({ lockTime: RACE_23_LOCK_TIME }),
  '6:30 PM ET',
  'Missing date falls back to existing lock-time presentation',
);
assert.equal(
  formatPublicFantasyLockDisplay({
    lockTime: RACE_23_LOCK_TIME,
    lockAt: 'not-a-date',
    raceDate: 'bogus',
  }),
  '6:30 PM ET',
);
const invalid = formatPublicFantasyLockDisplay({
  lockTime: RACE_23_LOCK_TIME,
  lockAt: 'Invalid Date',
  raceDate: undefined,
});
assert.doesNotMatch(invalid, /Invalid Date/i);
assert.doesNotMatch(invalid, /undefined/);
assert.equal(formatPublicFantasyLockDisplay({}), '');
assert.equal(formatPublicLockTimeEt(''), '');

const scheduleRaces = [
  { officialPointsRaceNumber: 15, date: RACE_15_DATE, track: 'Pocono Raceway', nonPoints: false },
  { officialPointsRaceNumber: 23, date: RACE_23_DATE, track: 'Milwaukee Mile', nonPoints: false },
];
assert.equal(resolvePublicLockRaceDate(scheduleRaces, 23), RACE_23_DATE);
assert.equal(resolvePublicLockRaceDate(scheduleRaces, 15), RACE_15_DATE);
assert.equal(resolvePublicLockRaceDate(scheduleRaces, 99), null);

const unlocked = parseLockState(
  { lock_time: RACE_23_LOCK_TIME, lock_at: RACE_23_LOCK_AT },
  { raceDate: RACE_23_DATE, now: new Date('2026-09-27T16:00:00.000Z') },
);
assert.equal(unlocked.lockTime, RACE_23_LOCK_TIME);
assert.equal(unlocked.lockAt, new Date(RACE_23_LOCK_AT).toISOString());
assert.equal(unlocked.isLocked, false);
assert.equal(unlocked.lockDisplay, RACE_23_DISPLAY);

const locked = parseLockState(
  { lock_time: RACE_23_LOCK_TIME, lock_at: RACE_23_LOCK_AT },
  { raceDate: RACE_23_DATE, now: new Date('2026-09-27T23:00:00.000Z') },
);
assert.equal(locked.isLocked, true);
assert.equal(locked.lockTime, RACE_23_LOCK_TIME);
assert.equal(locked.lockAt, unlocked.lockAt);
assert.equal(locked.lockDisplay, RACE_23_DISPLAY);

const client = await loadClientHelper();
assert.equal(
  client.formatPublicFantasyLockDisplay({
    lockTime: RACE_23_LOCK_TIME,
    lockAt: RACE_23_LOCK_AT,
    raceDate: RACE_23_DATE,
  }),
  RACE_23_DISPLAY,
);
assert.equal(
  client.formatLockField({
    lockTime: RACE_23_LOCK_TIME,
    lockAt: RACE_23_LOCK_AT,
    raceDate: RACE_23_DATE,
  }),
  RACE_23_DISPLAY,
);
assert.equal(client.lockLabel({ isLocked: false }), 'Lock');
assert.equal(
  client.lockLabel({ lockTime: RACE_23_LOCK_TIME, lockAt: RACE_23_LOCK_AT, isLocked: true }),
  'Locked',
);
assert.equal(
  client.formatLockField({ lockTime: RACE_23_LOCK_TIME }),
  '6:30 PM ET',
);
assert.doesNotMatch(client.formatLockField({ lockAt: 'nope', lockTime: '6:30pm EST' }), /Invalid Date/i);

const publicFiles = [
  '../public/fantasy-dashboard-app.js',
  '../public/fantasy-slate-app.js',
  '../public/fantasy-lineup-app.js',
  '../public/fantasy-standings-app.js',
  '../public/fantasy-preview-app.js',
];
for (const file of publicFiles) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /BPFantasyLockDisplay|formatLockField|lockDisplay/, `${file} should use the shared lock display helper`);
  assert.doesNotMatch(
    source,
    /<span>Lock<\/span><strong>\$\{escapeHtml\(slate[^}]*lockTime/,
    `${file} should not render lock time alone as the primary Lock cell`,
  );
}

const htmlFiles = [
  '../public/fantasy/dashboard.html',
  '../public/fantasy/slate.html',
  '../public/fantasy/lineup.html',
  '../public/fantasy/standings.html',
  '../public/fantasy/preview.html',
];
for (const file of htmlFiles) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /fantasy-lock-display\.js/, `${file} should load the shared lock display helper`);
}

const apiDir = new URL('../api/', import.meta.url);
const apiFiles = (await readdir(apiDir)).filter((name) => name.endsWith('.js') && !name.startsWith('_'));
assert.ok(apiFiles.length <= 12, `Routable API count is ${apiFiles.length}, Hobby limit is 12`);
assert.ok(!apiFiles.includes('cron-fantasy-monday.js'));

console.log(`test-fantasy-lock-display.mjs: Race 23 => ${race23}`);
console.log(`test-fantasy-lock-display.mjs: historical Race 15 => ${historical}`);
console.log(`test-fantasy-lock-display.mjs: routable API count ${apiFiles.length}`);
console.log('test-fantasy-lock-display.mjs: all lock display checks passed');
