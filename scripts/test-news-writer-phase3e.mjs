/**
 * Phase 3e — writer run UI client (browser orchestration, mocked APIs only).
 */
import assert from 'node:assert/strict';

const sessionMem = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (sessionMem.has(k) ? sessionMem.get(k) : null),
  setItem: (k, v) => sessionMem.set(k, String(v)),
  removeItem: (k) => sessionMem.delete(k),
};

import {
  WriterRunController,
  computeWriterRunProgressPercent,
  formatWriterStageName,
  shouldStopWriterAutoContinue,
  shouldScheduleNextContinue,
  clearWriterAutoAllowFlags,
  markWriterAutoAllowed,
  isWriterAutoAllowed,
} from '../public/admin/writer-run-ui-client.js';

function progressPartial(completedStepIds, extra = {}) {
  return {
    status: 'partial',
    runId: 'run-1',
    currentStep: 'section:battle_for_win',
    sectionsTotal: 8,
    sectionsCompleted: completedStepIds.filter((s) => s.startsWith('section:')).length,
    stepsCompleted: completedStepIds.length,
    stepsTotal: 11,
    completedStepIds,
    elapsedMs: 60000,
    openAiUsage: { calls: 3, totalTokens: 1200 },
    estimatedCostUsd: 0.004,
    ...extra,
  };
}

assert.equal(formatWriterStageName('section:battle_for_win'), 'Battle for the Win');
assert.equal(formatWriterStageName('editor'), 'Editorial Pass');
assert.equal(formatWriterStageName('shadow:compare'), 'Article Comparison');

const sectionsOnly = [];
for (let i = 0; i < 8; i += 1) sectionsOnly.push(`section:s${i}`);
const pctMid = computeWriterRunProgressPercent(
  progressPartial(sectionsOnly.slice(0, 3)),
  'multipass_preview'
);
assert.ok(pctMid > 10 && pctMid < 99, 'weighted mid-run must not be 100');

const pctComplete = computeWriterRunProgressPercent(
  { status: 'complete', completedStepIds: sectionsOnly, sectionsTotal: 8 },
  'multipass_preview'
);
assert.equal(pctComplete, 100);

const repairProgress = progressPartial(
  [...sectionsOnly, 'editor', 'headline', 'validation', 'repair:section:s0', 'repair:editor'],
  { stepsTotal: 15 }
);
const pctRepair = computeWriterRunProgressPercent(repairProgress, 'multipass_preview');
assert.ok(pctRepair <= 99, 'repair stages must not show 100% until complete');

clearWriterAutoAllowFlags();
assert.equal(isWriterAutoAllowed('multipass_preview'), false);
markWriterAutoAllowed('multipass_preview');
assert.equal(isWriterAutoAllowed('multipass_preview'), true);

clearWriterAutoAllowFlags();
const ctrl = new WriterRunController('multipass_preview', {
  continueRun: async () => ({ done: false, progress: progressPartial(['section:introduction']) }),
});
ctrl.applyPausedAfterRefreshIfNeeded(true);
assert.equal(ctrl.getState().paused, true);
assert.equal(ctrl.getState().pausedAfterRefresh, true);
assert.equal(ctrl.getState().autoContinue, false);

let continueCalls = 0;
const steps = [
  { done: false, progress: progressPartial(['section:introduction']) },
  { done: false, progress: progressPartial(['section:introduction', 'section:race_summary']) },
  { done: true, progress: { ...progressPartial(sectionsOnly), status: 'complete', currentStep: 'validation' } },
];
const autoCtrl = new WriterRunController('multipass_preview', {
  continueRun: async () => {
    continueCalls += 1;
    return steps.shift() || { done: true, progress: { status: 'complete' } };
  },
});

markWriterAutoAllowed('multipass_preview');
autoCtrl.beginAutoAfterStart('run-auto', progressPartial([]));
const autoDone = await autoCtrl.tickContinue();
assert.equal(continueCalls, 1);
assert.equal(autoCtrl.getState().requestInFlight, false);
assert.equal(autoDone?.done, false);

const inFlightCtrl = new WriterRunController('multipass_preview', {
  continueRun: () => new Promise(() => {}),
});
inFlightCtrl.state.runId = 'x';
inFlightCtrl.state.autoContinue = true;
inFlightCtrl.state.requestInFlight = true;
const skipped = await inFlightCtrl.tickContinue();
assert.equal(skipped, null);

const pauseCtrl = new WriterRunController('multipass_preview', {
  continueRun: async () => {
    throw new Error('should not run');
  },
});
pauseCtrl.beginAutoAfterStart('run-pause', progressPartial([]));
pauseCtrl.pause();
await pauseCtrl.tickContinue();
assert.equal(pauseCtrl.getState().paused, true);

let oneStepCalls = 0;
let releaseContinue;
const oneStepCtrl = new WriterRunController('multipass_preview', {
  continueRun: () =>
    new Promise((resolve) => {
      oneStepCalls += 1;
      releaseContinue = () => resolve({ done: false, progress: progressPartial(['section:introduction']) });
    }),
});
oneStepCtrl.state.runId = 'run-one';
const p1 = oneStepCtrl.runOneStep();
const p2 = oneStepCtrl.runOneStep();
assert.equal(oneStepCalls, 1, 'only one continuation while request in flight');
releaseContinue();
await p1;
await p2;
assert.equal(oneStepCalls, 1);
assert.equal(oneStepCtrl.getState().autoContinue, false);

let statusBeforeContinue = 0;
const retryCtrl = new WriterRunController('multipass_preview', {
  fetchStatus: async () => {
    statusBeforeContinue += 1;
    return { progress: progressPartial(['section:introduction']) };
  },
  continueRun: async () => ({ done: false, progress: progressPartial(['section:introduction', 'section:race_summary']) }),
});
retryCtrl.state.runId = 'run-retry';
retryCtrl.state.lastError = new Error('network');
await retryCtrl.retryAfterError();
assert.equal(statusBeforeContinue, 1);

const staleStop = shouldStopWriterAutoContinue({ stale: true, message: 'Package changed' });
assert.equal(staleStop.stop, true);
assert.equal(staleStop.reason, 'stale');

const failCtrl = new WriterRunController('multipass_preview', {
  continueRun: async () => {
    throw new Error('API failure');
  },
});
failCtrl.state.runId = 'run-fail';
failCtrl.state.autoContinue = true;
await failCtrl.tickContinue();
assert.equal(failCtrl.getState().autoContinue, false);
assert.ok(failCtrl.getState().lastError);

failCtrl.cancelLocal();
assert.equal(failCtrl.getState().cancelled, true);

const partialPayload = { done: false, progress: progressPartial(['section:introduction']) };
assert.equal(
  shouldScheduleNextContinue(partialPayload, { autoContinue: true, paused: false, cancelled: false, lastError: null }),
  true
);
assert.equal(
  shouldScheduleNextContinue(partialPayload, { autoContinue: true, paused: false, cancelled: false, lastError: null }, { forceOneStep: true }),
  false
);

const loopCtrl = new WriterRunController('multipass_preview', {
  continueRun: async () => partialPayload,
});
loopCtrl.state.runId = 'run-loop';
loopCtrl.state.autoContinue = true;
loopCtrl.state.running = true;
await loopCtrl.tickContinue();
assert.equal(loopCtrl.getState().requestInFlight, false, 'requestInFlight must clear after continue');
assert.equal(loopCtrl.getState().activityLabel, 'Waiting…', 'must not stay on Saving checkpoint');
assert.ok(loopCtrl._autoTimer != null, 'scheduleNextTick must run after requestInFlight clears');

console.log('Phase 3e writer run UI client tests passed.');
