import assert from 'node:assert/strict';
import {
  LIFECYCLE_STATES,
  LIFECYCLE_TRIGGERS,
  FAILURE_CODES,
  MONDAY_FANTASY_CRON,
  authorizeVercelCron,
  buildLastAutomationRecord,
  cheapLifecycleDecision,
  ensureFantasyLifecycleCurrent,
  getNextEligibleChampionshipRace,
  isChampionshipFantasyRace,
  isFantasyAutomationEnabled,
  isMondayFantasyCronRequest,
  isOpeningDuelLabel,
  isSlateFinalized,
  notifyFantasyAfterOfficialResultsUpdate,
  readLockClaimResult,
  runFantasyLifecycleWithLock,
  runMondayFantasySafetyCheck,
  resolveCurrentFantasyProgression,
  selectCurrentPublishedSlate,
  shouldFetchOfficialResults,
  triggerDisplayLabel,
  __resetFantasyLifecycleInflightForTests,
} from '../api/_fantasy-lifecycle.js';
import { isScoreReady, isCleanlyScored } from '../api/_fantasy-post-race-automation.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeSchedule(completedThrough = 0) {
  const duels = [
    {
      track: 'Daytona Duel',
      officialPointsRaceNumber: null,
      nonPoints: true,
      isOpeningDuel: true,
      displayRaceLabel: '1A',
      scheduleId: 'duel-1a',
      winner: 'Driver A',
    },
    {
      track: 'Daytona Duel',
      officialPointsRaceNumber: null,
      nonPoints: true,
      isOpeningDuel: true,
      displayRaceLabel: '1B',
      scheduleId: 'duel-1b',
      winner: 'Driver B',
    },
  ];
  const races = [];
  for (let i = 1; i <= 30; i += 1) {
    const track =
      i === 1
        ? 'Daytona International Speedway'
        : i === 20
          ? 'Martinsville Speedway'
          : i === 21
            ? 'Chicagoland Speedway Night'
            : `Track ${i}`;
    races.push({
      officialPointsRaceNumber: i,
      nonPoints: false,
      isOpeningDuel: false,
      countsAsNormalChampionshipRace: true,
      displayRaceLabel: String(i),
      scheduleId: `sched-${i}`,
      track,
      date: `2026-06-${String(Math.min(i, 28)).padStart(2, '0')}`,
      winner: i <= completedThrough ? `Winner ${i}` : '',
    });
  }
  return [...duels, ...races];
}

function makeSlate({
  id = 1,
  raceNumber = 20,
  finalized = false,
  lockAt,
  track = 'Martinsville Speedway',
  scheduleId = `sched-${raceNumber}`,
  lineupCount = 2,
} = {}) {
  return {
    id,
    season_id: '27987',
    race_number: raceNumber,
    status: 'published',
    track,
    schedule_id: scheduleId,
    lock_at: lockAt || null,
    lock_time: '6:30pm EST',
    meta: finalized
      ? { scoring: { status: 'scored', unresolvedDrivers: [], lineupCount } }
      : {},
  };
}

function futureLock() {
  return new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
}

function pastLock() {
  return new Date(Date.now() - 2 * 3600 * 1000).toISOString();
}

function createHarness(initial = {}) {
  const historicalEntries = initial.entries ? clone(initial.entries) : { 20: [{ userId: 'u1', drivers: ['d1'] }] };
  const state = {
    settings: {
      seasonId: '27987',
      fantasyLifecycle: { automationEnabled: initial.automationEnabled !== false },
    },
    slates: initial.slates ? clone(initial.slates) : [],
    schedule: initial.schedule || makeSchedule(initial.completedThrough ?? 0),
    officialReady: new Set(initial.officialReady || []),
    generateShouldFail: initial.generateShouldFail === true,
    scoreShouldFail: initial.scoreShouldFail === true,
    emptyPool: initial.emptyPool === true,
    entries: clone(historicalEntries),
    scoreCalls: 0,
    generateCalls: 0,
    publishCalls: 0,
    officialResultsFetches: 0,
    scheduleFetches: 0,
    persistCalls: 0,
    writes: 0,
    refreshCalls: 0,
    invalidateCalls: 0,
  };

  const deps = {
    now: () => initial.now || new Date(),
    getSettings: async () => state.settings,
    supabase: () => null,
    loadSchedule: async () => {
      state.scheduleFetches += 1;
      return state.schedule;
    },
    listPublishedSlates: async () => state.slates.filter((row) => row.status === 'published'),
    countLineups: async (slateId) => {
      const slate = state.slates.find((row) => row.id === slateId);
      const raceNumber = slate?.race_number;
      return (state.entries[raceNumber] || []).length;
    },
    getScoringStatus: async ({ raceNumber }) => {
      state.officialResultsFetches += 1;
      const slate = state.slates.find((row) => Number(row.race_number) === Number(raceNumber));
      const finalized = isSlateFinalized(slate);
      const ready = state.officialReady.has(Number(raceNumber));
      return {
        status: finalized ? 'scored' : ready ? 'ready' : 'not_ready',
        raceComplete: Boolean(state.schedule.find((race) => race.officialPointsRaceNumber === Number(raceNumber))?.winner),
        resultsReady: ready,
        resultsReason: ready ? null : 'Official race results are not available yet.',
        lineupCount: (state.entries[raceNumber] || []).length,
        unresolvedDrivers: [],
        scoringMeta: slate?.meta?.scoring || null,
        slate: slate ? { id: slate.id, raceNumber: slate.race_number, track: slate.track } : null,
      };
    },
    scoreSlate: async ({ raceNumber }) => {
      state.scoreCalls += 1;
      if (state.scoreShouldFail) throw new Error('simulated scoring failure');
      const slate = state.slates.find((row) => Number(row.race_number) === Number(raceNumber));
      if (!slate) throw new Error('Published fantasy slate not found for scoring.');
      if (isSlateFinalized(slate)) {
        return { status: 'scored', scoredLineups: (state.entries[raceNumber] || []).length, unresolvedDrivers: [] };
      }
      slate.meta = {
        ...(slate.meta || {}),
        scoring: {
          status: 'scored',
          unresolvedDrivers: [],
          lineupCount: (state.entries[raceNumber] || []).length,
        },
      };
      state.writes += 1;
      return {
        status: 'scored',
        scoredLineups: (state.entries[raceNumber] || []).length,
        unresolvedDrivers: [],
      };
    },
    generateDraft: async ({ raceNumber }) => {
      state.generateCalls += 1;
      if (state.generateShouldFail) throw new Error('simulated driver pool failure');
      const existing = state.slates.find((row) => Number(row.race_number) === Number(raceNumber));
      if (existing?.status === 'published') {
        return { slate: existing, drivers: [{ driverId: '1' }, { driverId: '2' }] };
      }
      if (state.emptyPool) {
        const draft = {
          id: 900 + Number(raceNumber),
          season_id: '27987',
          race_number: raceNumber,
          status: 'draft',
          track: `Track ${raceNumber}`,
          schedule_id: `sched-${raceNumber}`,
        };
        return { slate: draft, drivers: [] };
      }
      const draft = existing || {
        id: 800 + Number(raceNumber),
        season_id: '27987',
        race_number: raceNumber,
        status: 'draft',
        track:
          Number(raceNumber) === 21 ? 'Chicagoland Speedway Night' : `Track ${raceNumber}`,
        schedule_id: `sched-${raceNumber}`,
        lock_time: '6:30pm EST',
        meta: {},
      };
      if (!existing) state.slates.push(draft);
      state.writes += 1;
      return { slate: draft, drivers: [{ driverId: '1' }, { driverId: '2' }] };
    },
    publishSlate: async ({ raceNumber, slateId }) => {
      state.publishCalls += 1;
      const slate =
        state.slates.find((row) => row.id === slateId) ||
        state.slates.find((row) => Number(row.race_number) === Number(raceNumber));
      if (!slate) throw new Error('No draft fantasy slate found to publish.');
      slate.status = 'published';
      slate.lock_at = futureLock();
      slate.lock_time = '6:30pm EST';
      state.writes += 1;
      return { slate };
    },
    loadDraft: async (_seasonId, raceNumber) => {
      const slate = state.slates.find((row) => Number(row.race_number) === Number(raceNumber));
      return slate ? { slate, drivers: [{ driverId: '1' }] } : null;
    },
    persistLifecycle: async (patch) => {
      state.persistCalls += 1;
      state.settings.fantasyLifecycle = {
        ...(state.settings.fantasyLifecycle || {}),
        ...patch,
      };
      state.writes += 1;
      return state.settings.fantasyLifecycle;
    },
    invalidateCaches: async () => {
      state.invalidateCalls += 1;
    },
    loadOfficialResults: async ({ raceNumber }) => {
      state.refreshCalls += 1;
      const ready = state.officialReady.has(Number(raceNumber));
      return {
        ready,
        reason: ready ? null : 'Official race results are not available yet.',
        raceNumber,
      };
    },
  };

  const withLifecycleOptions = (opts = {}) => ({
    seasonId: '27987',
    settings: state.settings,
    ...opts,
  });

  return {
    state,
    deps,
    historicalEntries,
    async ensure(opts = {}) {
      __resetFantasyLifecycleInflightForTests();
      return ensureFantasyLifecycleCurrent(withLifecycleOptions(opts), deps);
    },
    async ensureRaw(opts = {}) {
      return ensureFantasyLifecycleCurrent(withLifecycleOptions(opts), deps);
    },
    async notifyResults(opts = {}) {
      __resetFantasyLifecycleInflightForTests();
      return notifyFantasyAfterOfficialResultsUpdate(
        withLifecycleOptions({ trigger: LIFECYCLE_TRIGGERS.RESULTS_UPDATE, ...opts }),
        deps,
      );
    },
    async mondaySafety(opts = {}) {
      __resetFantasyLifecycleInflightForTests();
      return runMondayFantasySafetyCheck(
        withLifecycleOptions({ trigger: LIFECYCLE_TRIGGERS.MONDAY_SAFETY, ...opts }),
        deps,
      );
    },
    async processManual(opts = {}) {
      __resetFantasyLifecycleInflightForTests();
      return runFantasyLifecycleWithLock(
        withLifecycleOptions({
          forcedByAdmin: true,
          trigger: LIFECYCLE_TRIGGERS.MANUAL,
          ...opts,
        }),
        deps,
      );
    },
  };
}

// Pure helpers — duels vs Daytona vs playoffs
{
  const schedule = makeSchedule(0);
  assert.equal(isOpeningDuelLabel('1A'), true);
  assert.equal(isOpeningDuelLabel('1B'), true);
  assert.equal(isOpeningDuelLabel('1'), false);
  assert.equal(isChampionshipFantasyRace(schedule[0]), false);
  assert.equal(isChampionshipFantasyRace(schedule[2]), true);
  assert.equal(schedule[2].officialPointsRaceNumber, 1);
  assert.equal(schedule[2].track, 'Daytona International Speedway');

  const afterDuels = getNextEligibleChampionshipRace(schedule, 0);
  assert.equal(afterDuels.officialPointsRaceNumber, 1);
  assert.equal(afterDuels.displayRaceLabel, '1');
  assert.notEqual(afterDuels.displayRaceLabel, '1A');

  assert.equal(getNextEligibleChampionshipRace(schedule, 20).officialPointsRaceNumber, 21);
  assert.equal(getNextEligibleChampionshipRace(schedule, 23).officialPointsRaceNumber, 24);
  assert.equal(getNextEligibleChampionshipRace(schedule, 26).officialPointsRaceNumber, 27);
  assert.equal(getNextEligibleChampionshipRace(schedule, 30), null);
}

{
  assert.equal(isFantasyAutomationEnabled({}), true);
  assert.equal(isFantasyAutomationEnabled({ fantasyLifecycle: { automationEnabled: true } }), true);
  assert.equal(isFantasyAutomationEnabled({ fantasyLifecycle: { automationEnabled: false } }), false);
}

{
  assert.equal(
    isScoreReady({ raceComplete: true, resultsReady: true, lineupCount: 0, status: 'ready' }),
    true,
  );
  assert.equal(isCleanlyScored({ status: 'scored', lineupCount: 0, unresolvedDrivers: [] }), true);
}

{
  const open = makeSlate({ raceNumber: 21, lockAt: futureLock() });
  const cheap = cheapLifecycleDecision({
    automationEnabled: true,
    publishedSlates: [makeSlate({ raceNumber: 20, finalized: true }), open],
    now: new Date(),
  });
  assert.equal(cheap.mayNeedWork, false);
  assert.equal(cheap.mayFetchAuthoritativeResults, false);
  assert.equal(cheap.reason, 'current_week_open');
}

{
  assert.equal(shouldFetchOfficialResults({ winner: '' }), false);
  assert.equal(shouldFetchOfficialResults({ winner: 'Jane Doe' }), true);
}

// 1. Automatic enabled + race not complete → no mutation
{
  const harness = createHarness({
    completedThrough: 19,
    slates: [makeSlate({ raceNumber: 20, lockAt: futureLock() })],
    officialReady: [],
  });
  const first = await harness.ensure();
  assert.equal(first.mutated, false);
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(harness.state.generateCalls, 0);
  assert.equal(harness.state.publishCalls, 0);
  assert.equal(first.state, LIFECYCLE_STATES.OPEN);
}

// 2. Race complete but results unavailable → WAITING_FOR_RESULTS
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [],
  });
  const result = await harness.ensure();
  assert.equal(result.state, LIFECYCLE_STATES.WAITING_FOR_RESULTS);
  assert.equal(result.mutated, false);
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(harness.state.publishCalls, 0);
  assert.match(result.nextAction.label, /official/i);
}

// 3 + 4. Results available → score/finalize exactly once; re-run does not rescore
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const first = await harness.ensure();
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(isSlateFinalized(harness.state.slates[0]), true);
  const second = await harness.ensure();
  assert.equal(harness.state.scoreCalls, 1);
  assert.ok(first.mutated);
  assert.equal(second.diagnostics.actions.some((row) => row.action === 'finalized') || isSlateFinalized(harness.state.slates[0]), true);
}

// 5 + 6. Next race created/activated exactly once; repeated runs identical
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const first = await harness.ensure();
  const afterFirst = clone(harness.state.slates);
  const generateAfterFirst = harness.state.generateCalls;
  const publishAfterFirst = harness.state.publishCalls;
  assert.equal(publishAfterFirst, 1);
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 21 && row.status === 'published'));
  const second = await harness.ensure();
  const third = await harness.ensure();
  assert.equal(harness.state.generateCalls, generateAfterFirst);
  assert.equal(harness.state.publishCalls, publishAfterFirst);
  assert.deepEqual(
    harness.state.slates.map((row) => ({ id: row.id, race: row.race_number, status: row.status, scored: isSlateFinalized(row) })),
    afterFirst.map((row) => ({ id: row.id, race: row.race_number, status: row.status, scored: isSlateFinalized(row) })),
  );
  assert.equal(first.state === LIFECYCLE_STATES.NEXT_WEEK_READY || first.state === LIFECYCLE_STATES.OPEN, true);
  assert.equal(second.state, third.state);
}

// 7. Automatic OFF → no automatic mutation
{
  const harness = createHarness({
    automationEnabled: false,
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const result = await harness.ensure();
  assert.equal(result.mutated, false);
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(harness.state.generateCalls, 0);
  assert.equal(harness.state.publishCalls, 0);
  assert.match(result.nextAction.label, /Manual mode/i);
}

// 8. Manual PROCESS CURRENT WEEK uses the same orchestrator
{
  const harness = createHarness({
    automationEnabled: false,
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const result = await harness.ensure({ forcedByAdmin: true });
  assert.ok(result.mutated);
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(harness.state.publishCalls, 1);
}

// 9 + 10. Duels are not championship Race 1; Daytona is Race 1
{
  const schedule = makeSchedule(1);
  const next = getNextEligibleChampionshipRace(schedule, 0);
  assert.equal(next.officialPointsRaceNumber, 1);
  assert.equal(next.track, 'Daytona International Speedway');
  assert.ok(schedule.some((race) => race.displayRaceLabel === '1A' && !isChampionshipFantasyRace(race)));
}

// 11. Race 20 → 21 advances into playoffs
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ id: 20, raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  await harness.ensure();
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 21 && row.status === 'published'));
}

// 12. Race 23 → 24 continues through Round 2
{
  const harness = createHarness({
    completedThrough: 23,
    slates: [makeSlate({ id: 23, raceNumber: 23, lockAt: pastLock(), track: 'Track 23' })],
    officialReady: [23],
  });
  await harness.ensure();
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 24 && row.status === 'published'));
}

// 13. Race 26 → 27 continues into Final 8
{
  const harness = createHarness({
    completedThrough: 26,
    slates: [makeSlate({ id: 26, raceNumber: 26, lockAt: pastLock(), track: 'Track 26' })],
    officialReady: [26],
  });
  await harness.ensure();
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 27 && row.status === 'published'));
}

// 14. Race 30 → season complete, no nonexistent next week
{
  const harness = createHarness({
    completedThrough: 30,
    slates: [makeSlate({ id: 30, raceNumber: 30, lockAt: pastLock(), track: 'Track 30' })],
    officialReady: [30],
  });
  const result = await harness.ensure();
  assert.equal(result.state, LIFECYCLE_STATES.SEASON_COMPLETE);
  assert.equal(harness.state.publishCalls, 0);
  assert.equal(
    harness.state.slates.some((row) => Number(row.race_number) === 31),
    false,
  );
}

// 15. Scoring failure → no advancement
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
    scoreShouldFail: true,
  });
  const result = await harness.ensure();
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(harness.state.publishCalls, 0);
  assert.equal(result.failure?.code, FAILURE_CODES.SCORING_FAILED);
  assert.equal(isSlateFinalized(harness.state.slates[0]), false);
}

// 16. Driver pool failure → next week not marked ready
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
    generateShouldFail: true,
  });
  const result = await harness.ensure();
  assert.equal(isSlateFinalized(harness.state.slates[0]), true);
  assert.equal(harness.state.publishCalls, 0);
  assert.equal(
    harness.state.slates.some((row) => Number(row.race_number) === 21 && row.status === 'published'),
    false,
  );
  assert.equal(result.failure?.code, FAILURE_CODES.DRIVER_POOL_ERROR);
}

// 17. Historical entries unchanged
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
    entries: { 20: [{ userId: 'u1', drivers: ['42', '11'] }] },
  });
  const before = clone(harness.state.entries);
  await harness.ensure();
  await harness.ensure();
  assert.deepEqual(harness.state.entries, before);
  assert.deepEqual(harness.state.entries, harness.historicalEntries);
}

// 18. Catch-up: do not skip a missing completed week
{
  const harness = createHarness({
    completedThrough: 19,
    slates: [makeSlate({ id: 18, raceNumber: 18, lockAt: pastLock(), track: 'Track 18' })],
    officialReady: [18, 19],
  });
  harness.state.schedule = makeSchedule(19);
  const result = await harness.ensure();
  assert.equal(isSlateFinalized(harness.state.slates[0]), true);
  assert.equal(
    harness.state.slates.some((row) => Number(row.race_number) === 19),
    false,
  );
  assert.equal(result.failure?.code, FAILURE_CODES.NEEDS_ADMIN_ATTENTION);
  assert.match(result.failure.message, /cannot be reconstructed/i);
}

// 18b. Catch-up when slates already exist for 18 and 19
{
  const harness = createHarness({
    completedThrough: 19,
    slates: [
      makeSlate({ id: 18, raceNumber: 18, lockAt: pastLock(), track: 'Track 18' }),
      makeSlate({ id: 19, raceNumber: 19, lockAt: pastLock(), track: 'Track 19' }),
    ],
    officialReady: [18, 19],
  });
  await harness.ensure();
  assert.equal(isSlateFinalized(harness.state.slates.find((row) => row.race_number === 18)), true);
  assert.equal(isSlateFinalized(harness.state.slates.find((row) => row.race_number === 19)), true);
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 20 && row.status === 'published'));
}

// 19. Duplicate / concurrent-ish invocation protection
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  __resetFantasyLifecycleInflightForTests();
  const [a, b] = await Promise.all([harness.ensureRaw(), harness.ensureRaw()]);
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(a.state, b.state);
}

// 20. No unnecessary official-results fetch when state clearly needs no work
{
  const harness = createHarness({
    completedThrough: 19,
    slates: [makeSlate({ raceNumber: 20, lockAt: futureLock() })],
    officialReady: [],
  });
  await harness.ensure();
  assert.equal(harness.state.officialResultsFetches, 0);
  assert.equal(harness.state.scheduleFetches, 0);
}

// Empty-pool week is not marked ready
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
    emptyPool: true,
  });
  const result = await harness.ensure();
  assert.equal(result.failure?.code, FAILURE_CODES.DRIVER_POOL_ERROR);
  assert.equal(harness.state.publishCalls, 0);
}

// Admin HTML surface
{
  const html = fs.readFileSync(path.join(repoRoot, 'public/admin/fantasy.html'), 'utf8');
  assert.match(html, /FANTASY AUTOMATION/i);
  assert.match(html, /PROCESS CURRENT WEEK/i);
  assert.match(html, /ADVANCED \/ MANUAL CONTROLS/i);
  assert.match(html, /fantasyAutomationAutomatic/);
  assert.match(
    html,
    /Automatically processes Fantasy when official race results are updated/,
  );
  assert.match(html, /refreshOfficialRaceResults/);
  assert.doesNotMatch(html, /Run Lifecycle Now/);
}

{
  assert.equal(triggerDisplayLabel(LIFECYCLE_TRIGGERS.RESULTS_UPDATE), 'Triggered by results update');
  assert.equal(triggerDisplayLabel(LIFECYCLE_TRIGGERS.MONDAY_SAFETY), 'Monday safety check');
  assert.equal(triggerDisplayLabel(LIFECYCLE_TRIGGERS.MANUAL), 'Manual process');
  const last = buildLastAutomationRecord({
    now: new Date('2026-09-20T02:42:00.000Z'),
    trigger: LIFECYCLE_TRIGGERS.RESULTS_UPDATE,
    actions: [
      { action: 'finalized', raceNumber: 20 },
      { action: 'next_week_opened', raceNumber: 21 },
    ],
  });
  assert.equal(last.outcome, 'SUCCESS');
  assert.match(last.summary, /Race 20 finalized/);
  assert.match(last.summary, /Race 21 opened/);
  assert.equal(last.trigger, 'results_update');
}

// 1. Results update + Automatic ON + complete results → lifecycle runs
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const result = await harness.notifyResults({ resultsReady: true });
  assert.equal(result.skipped, undefined);
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(harness.state.publishCalls, 1);
  assert.equal(result.lastAutomation?.trigger, LIFECYCLE_TRIGGERS.RESULTS_UPDATE);
  assert.equal(result.lastAutomation?.outcome, 'SUCCESS');
}

// 2. Results update repeated → no duplicate scoring/slate
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  await harness.notifyResults({ resultsReady: true });
  const afterFirst = clone(harness.state.slates);
  await harness.notifyResults({ resultsReady: true });
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(harness.state.publishCalls, 1);
  assert.deepEqual(
    harness.state.slates.map((row) => ({ id: row.id, race: row.race_number, status: row.status })),
    afterFirst.map((row) => ({ id: row.id, race: row.race_number, status: row.status })),
  );
}

// 3. Results update + Automatic OFF → no automatic fantasy mutation
{
  const harness = createHarness({
    automationEnabled: false,
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const result = await harness.notifyResults({ resultsReady: true });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'automation_disabled');
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(harness.state.generateCalls, 0);
  assert.equal(harness.state.publishCalls, 0);
}

// 4. Monday safety + Automatic ON + results available → lifecycle advances
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const result = await harness.mondaySafety();
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(harness.state.publishCalls, 1);
  assert.equal(result.trigger, LIFECYCLE_TRIGGERS.MONDAY_SAFETY);
  assert.equal(result.lastAutomation?.trigger, LIFECYCLE_TRIGGERS.MONDAY_SAFETY);
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 21 && row.status === 'published'));
}

// 5. Monday safety + results unavailable → WAITING_FOR_RESULTS and stops
{
  const harness = createHarness({
    completedThrough: 19,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [],
  });
  const result = await harness.mondaySafety();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'results_not_ready');
  assert.equal(result.state, LIFECYCLE_STATES.WAITING_FOR_RESULTS);
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(harness.state.publishCalls, 0);
  assert.equal(result.lastAutomation?.outcome, 'NO ACTION');
  assert.match(result.lastAutomation?.summary || '', /Race 20 official results/i);
}

// 6. Monday safety runs once → no polling loop
{
  const harness = createHarness({
    completedThrough: 19,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [],
  });
  await harness.mondaySafety();
  assert.equal(harness.state.refreshCalls, 1);
  assert.equal(harness.state.invalidateCalls, 1);
  assert.equal(harness.state.scheduleFetches, 1);
}

// 7. Monday safety + Automatic OFF → no mutation
{
  const harness = createHarness({
    automationEnabled: false,
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const result = await harness.mondaySafety();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'automation_disabled');
  assert.equal(harness.state.refreshCalls, 0);
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(harness.state.publishCalls, 0);
}

// 8. Manual Process Current Week + Automatic OFF → works intentionally
{
  const harness = createHarness({
    automationEnabled: false,
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  const result = await harness.processManual();
  assert.ok(result.mutated);
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(harness.state.publishCalls, 1);
  assert.equal(result.lastAutomation?.trigger, LIFECYCLE_TRIGGERS.MANUAL);
}

// 9–11. Ordinary public GET traffic must not mutate Fantasy
{
  const lineups = fs.readFileSync(path.join(repoRoot, 'api/_fantasy-lineups.js'), 'utf8');
  const settingsSrc = fs.readFileSync(path.join(repoRoot, 'api/settings.js'), 'utf8');
  const scheduleSrc = fs.readFileSync(path.join(repoRoot, 'api/schedule.js'), 'utf8');
  assert.doesNotMatch(lineups, /ensureFantasyLifecycleCurrent/);
  assert.doesNotMatch(lineups, /notifyFantasyAfterOfficialResultsUpdate/);
  assert.doesNotMatch(lineups, /runMondayFantasySafetyCheck/);
  assert.match(settingsSrc, /queryAction === 'getFantasyStandings'/);
  assert.match(settingsSrc, /queryAction === 'getDashboard'/);
  assert.doesNotMatch(
    settingsSrc.slice(
      settingsSrc.indexOf("if (queryAction === 'getDashboard')"),
      settingsSrc.indexOf("if (queryAction === 'getFantasyStandings')"),
    ),
    /ensureFantasyLifecycleCurrent/,
  );
  assert.doesNotMatch(scheduleSrc, /ensureFantasyLifecycleCurrent/);
}

// 12. Results-update trigger and Monday trigger repeated/concurrent → score once, next slate once
{
  const harness = createHarness({
    completedThrough: 20,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [20],
  });
  __resetFantasyLifecycleInflightForTests();
  const [fromResults, fromMonday] = await Promise.all([
    notifyFantasyAfterOfficialResultsUpdate(
      { seasonId: '27987', settings: harness.state.settings, resultsReady: true, trigger: LIFECYCLE_TRIGGERS.RESULTS_UPDATE },
      harness.deps,
    ),
    runMondayFantasySafetyCheck(
      { seasonId: '27987', settings: harness.state.settings, trigger: LIFECYCLE_TRIGGERS.MONDAY_SAFETY },
      harness.deps,
    ),
  ]);
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(harness.state.publishCalls, 1);
  assert.equal(
    harness.state.slates.filter((row) => Number(row.race_number) === 21 && row.status === 'published').length,
    1,
  );
  assert.ok(fromResults.skipped === true || fromMonday.skipped === true || fromResults.mutated || fromMonday.mutated);
}

// 13–16 already covered above for Race 20→21, 23→24, 26→27, Race 30 season complete

// 19. postponed / no-results race does not advance merely because Monday arrived
{
  const harness = createHarness({
    completedThrough: 19,
    slates: [makeSlate({ raceNumber: 20, lockAt: pastLock() })],
    officialReady: [],
  });
  const result = await harness.mondaySafety();
  assert.equal(result.state, LIFECYCLE_STATES.WAITING_FOR_RESULTS);
  assert.equal(isSlateFinalized(harness.state.slates[0]), false);
  assert.equal(
    harness.state.slates.some((row) => Number(row.race_number) === 21),
    false,
  );
}

{
  const vercel = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
  assert.equal(vercel.crons[0].path, MONDAY_FANTASY_CRON.path);
  assert.equal(vercel.crons[0].schedule, MONDAY_FANTASY_CRON.schedule);
  assert.equal(vercel.crons.length, 1);
}

{
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const missing = authorizeVercelCron({ headers: { authorization: 'Bearer test' } });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 503);
  process.env.CRON_SECRET = 'unit-test-cron-secret';
  const denied = authorizeVercelCron({ headers: { authorization: 'Bearer wrong' } });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 401);
  const allowed = authorizeVercelCron({ headers: { authorization: 'Bearer unit-test-cron-secret' } });
  assert.equal(allowed.ok, true);
  if (previous == null) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
}

{
  const settingsHandler = (await import('../api/settings.js')).default;
  function mockRes() {
    return {
      statusCode: 200,
      body: null,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
  }

  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const missing = mockRes();
  await settingsHandler(
    { method: 'GET', query: { cron: 'fantasy-monday' }, headers: {} },
    missing,
  );
  assert.equal(missing.statusCode, 503);
  assert.notEqual(missing.body?.trigger, 'monday_safety');

  process.env.CRON_SECRET = 'unit-test-cron-secret';
  const denied = mockRes();
  await settingsHandler(
    {
      method: 'GET',
      query: { cron: 'fantasy-monday' },
      headers: { authorization: 'Bearer wrong' },
    },
    denied,
  );
  assert.equal(denied.statusCode, 401);

  const allowed = mockRes();
  await settingsHandler(
    {
      method: 'GET',
      query: { cron: 'fantasy-monday' },
      headers: { authorization: 'Bearer unit-test-cron-secret' },
    },
    allowed,
  );
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body?.trigger, 'monday_safety');
  assert.equal(allowed.body?.once, true);

  if (previous == null) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previous;
}

{
  assert.deepEqual(readLockClaimResult({ acquired: true, lockToken: 'a' }, 'a'), {
    acquired: true,
    token: 'a',
  });
  assert.equal(readLockClaimResult({ acquired: false }, 'a').acquired, false);
  assert.equal(readLockClaimResult({ acquired: true, lockToken: 'b' }, 'a').acquired, false);
}

{
  const store = { lockToken: null, lockUntil: null };
  const now = Date.now();
  const claim = (token) => {
    if (store.lockToken && store.lockUntil > now) {
      return readLockClaimResult({ acquired: false, lockToken: store.lockToken }, token);
    }
    store.lockToken = token;
    store.lockUntil = now + 90_000;
    return readLockClaimResult({ acquired: true, lockToken: token }, token);
  };
  const a = claim('results_update:A');
  const b = claim('monday_safety:B');
  assert.equal(a.acquired, true);
  assert.equal(b.acquired, false);
  assert.equal(store.lockToken, 'results_update:A');
}

{
  assert.equal(isMondayFantasyCronRequest({ query: { cron: 'fantasy-monday' } }), true);
  assert.equal(isMondayFantasyCronRequest({ query: {} }), false);
  assert.equal(isMondayFantasyCronRequest({ query: { action: 'getDashboard' } }), false);

  const settingsSrc = fs.readFileSync(path.join(repoRoot, 'api/settings.js'), 'utf8');
  assert.match(settingsSrc, /isMondayFantasyCronRequest/);
  assert.match(settingsSrc, /runMondayFantasySafetyCheck/);
  assert.match(settingsSrc, /authorizeVercelCron/);
  assert.doesNotMatch(settingsSrc, /setInterval|while\s*\(/);
  assert.equal(fs.existsSync(path.join(repoRoot, 'api/cron-fantasy-monday.js')), false);

  const routable = fs
    .readdirSync(path.join(repoRoot, 'api'))
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'));
  assert.equal(routable.length, 12);
  assert.ok(!routable.includes('cron-fantasy-monday.js'));
}

function makeSeason11LiveSlates() {
  const slates = [
    makeSlate({
      id: 11,
      raceNumber: 14,
      finalized: false,
      lockAt: pastLock(),
      track: 'Talladega Superspeedway',
      lineupCount: 0,
    }),
  ];
  for (let race = 15; race <= 22; race += 1) {
    slates.push(
      makeSlate({
        id: 10 + race,
        raceNumber: race,
        finalized: true,
        lockAt: pastLock(),
        track: race === 22 ? 'Nashville Superspeedway' : `Track ${race}`,
        lineupCount: 3,
      }),
    );
  }
  slates.push({
    id: 37,
    season_id: '27987',
    race_number: 23,
    status: 'draft',
    track: 'The Milwaukee Mile',
    schedule_id: 'sched-23',
    lock_at: null,
    lock_time: '6:30pm EST',
    meta: {},
  });
  return slates;
}

{
  const slates = makeSeason11LiveSlates();
  const published = slates.filter((row) => row.status === 'published');
  const resolved = resolveCurrentFantasyProgression(published);
  assert.equal(resolved.currentSlate.race_number, 22);
  assert.equal(resolved.latestFinalized.race_number, 22);
  assert.deepEqual(resolved.staleSlates.map((row) => row.race_number), [14]);
  assert.equal(resolved.gap, null);
  assert.equal(selectCurrentPublishedSlate(published).race_number, 22);
}

{
  const entries = { 14: [], 15: [{ userId: 'a' }], 22: [{ userId: 'b' }] };
  const harness = createHarness({
    completedThrough: 22,
    slates: makeSeason11LiveSlates(),
    officialReady: [22],
    entries,
  });
  const before14 = clone(harness.state.slates.find((row) => row.race_number === 14));
  const beforeFinalized = clone(
    harness.state.slates.filter((row) => row.race_number >= 15 && row.race_number <= 22),
  );
  const beforeEntries = clone(harness.state.entries);

  const first = await harness.ensure();
  assert.equal(harness.state.scoreCalls, 0);
  assert.deepEqual(harness.state.slates.find((row) => row.race_number === 14), before14);
  assert.deepEqual(
    harness.state.slates.filter((row) => row.race_number >= 15 && row.race_number <= 22),
    beforeFinalized,
  );
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 23 && row.status === 'published'));
  assert.equal(harness.state.slates.filter((row) => Number(row.race_number) === 23).length, 1);
  assert.equal(first.diagnostics.staleHistoricalRaceNumbers.includes(14), true);
  assert.equal(first.diagnostics.resolvedCurrentRaceNumber, 23);

  for (let i = 0; i < 100; i += 1) {
    await harness.ensure();
  }
  assert.equal(harness.state.scoreCalls, 0);
  assert.deepEqual(harness.state.slates.find((row) => row.race_number === 14), before14);
  assert.deepEqual(
    harness.state.slates.filter((row) => row.race_number >= 15 && row.race_number <= 22),
    beforeFinalized,
  );
  assert.deepEqual(harness.state.entries, beforeEntries);
  assert.equal(harness.state.slates.filter((row) => Number(row.race_number) === 23).length, 1);
}

{
  const harness = createHarness({
    completedThrough: 22,
    slates: makeSeason11LiveSlates(),
    officialReady: [22],
    entries: { 14: [], 22: [{ userId: 'b' }] },
  });
  const fromResults = await harness.notifyResults({ resultsReady: true });
  const fromMonday = await harness.mondaySafety();
  const fromManual = await harness.processManual();
  assert.equal(fromResults.diagnostics.staleHistoricalRaceNumbers.includes(14), true);
  assert.equal(fromMonday.diagnostics.staleHistoricalRaceNumbers.includes(14), true);
  assert.equal(fromManual.diagnostics.staleHistoricalRaceNumbers.includes(14), true);
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(harness.state.slates.find((row) => row.race_number === 14).meta.scoring, undefined);
  assert.equal(harness.state.slates.filter((row) => Number(row.race_number) === 23 && row.status === 'published').length, 1);
}

{
  const harness = createHarness({
    completedThrough: 23,
    slates: [
      makeSlate({ id: 22, raceNumber: 22, finalized: true, lockAt: pastLock() }),
      makeSlate({ id: 23, raceNumber: 23, finalized: false, lockAt: pastLock(), track: 'The Milwaukee Mile' }),
    ],
    officialReady: [23],
  });
  await harness.ensure();
  assert.equal(harness.state.scoreCalls, 1);
  assert.equal(isSlateFinalized(harness.state.slates.find((row) => row.race_number === 23)), true);
  assert.ok(harness.state.slates.some((row) => Number(row.race_number) === 24 && row.status === 'published'));
}

{
  const harness = createHarness({
    completedThrough: 19,
    slates: [
      makeSlate({ id: 18, raceNumber: 18, finalized: true, lockAt: pastLock() }),
      makeSlate({ id: 20, raceNumber: 20, finalized: false, lockAt: pastLock() }),
    ],
    officialReady: [18, 19, 20],
  });
  const result = await harness.ensure();
  assert.equal(result.failure?.code, FAILURE_CODES.NEEDS_ADMIN_ATTENTION);
  assert.equal(harness.state.scoreCalls, 0);
  assert.equal(
    harness.state.slates.some((row) => Number(row.race_number) === 19),
    false,
  );
  assert.equal(isSlateFinalized(harness.state.slates.find((row) => row.race_number === 20)), false);
}

{
  const slates = [
    makeSlate({ id: 22, raceNumber: 22, finalized: true, lockAt: pastLock() }),
    makeSlate({ id: 23, raceNumber: 23, finalized: false, lockAt: futureLock(), track: 'The Milwaukee Mile' }),
  ];
  const harness = createHarness({
    completedThrough: 22,
    slates,
    officialReady: [22],
  });
  const before = clone(harness.state.slates);
  const result = await harness.ensure();
  assert.equal(result.mutated, false);
  assert.equal(harness.state.publishCalls, 0);
  assert.equal(harness.state.generateCalls, 0);
  assert.deepEqual(
    harness.state.slates.map((row) => ({ id: row.id, race: row.race_number, status: row.status })),
    before.map((row) => ({ id: row.id, race: row.race_number, status: row.status })),
  );
}

console.log('test-fantasy-lifecycle: all tests passed');
