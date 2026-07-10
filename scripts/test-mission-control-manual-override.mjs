import assert from 'node:assert/strict';
import { DETECTION_MODES, resolveTaskCompletionState } from '../api/_mission-control-task-engine.js';

const autoTask = {
  id: 'thu-confirm-broadcast-link',
  detectionMode: DETECTION_MODES.AUTOMATIC,
};

const manualTask = {
  id: 'mon-upload-transcript',
  detectionMode: DETECTION_MODES.MANUAL,
};

const autoCtx = {
  broadcast: { configured: false, matchedToRace: false },
  nextRace: { raceNumber: 15, raceSource: 'workflow' },
};

{
  const completions = new Map();
  const result = resolveTaskCompletionState(autoTask, autoCtx, completions, { windowActive: true });
  assert.equal(result.completed, false);
  assert.equal(result.completionSource, null);
}

{
  const completions = new Map([
    [
      'thu-confirm-broadcast-link',
      {
        completedAt: '2026-07-10T17:15:00.000Z',
        completionSource: 'manual',
        manualOverride: true,
        manuallyCompletedBy: 'admin',
      },
    ],
  ]);
  const result = resolveTaskCompletionState(autoTask, autoCtx, completions, { windowActive: true });
  assert.equal(result.completed, true);
  assert.equal(result.completionSource, 'manual');
  assert.equal(result.manualOverride, true);
  assert.equal(result.manuallyCompletedAt, '2026-07-10T17:15:00.000Z');
}

{
  const completions = new Map([
    [
      'mon-upload-transcript',
      {
        completedAt: '2026-07-10T17:15:00.000Z',
        completionSource: 'manual',
      },
    ],
  ]);
  const result = resolveTaskCompletionState(manualTask, {}, completions, { windowActive: true });
  assert.equal(result.completed, true);
  assert.equal(result.completionSource, 'manual');
  assert.equal(result.manualOverride, false);
}

console.log('mission-control-manual-override: all scenarios passed');
