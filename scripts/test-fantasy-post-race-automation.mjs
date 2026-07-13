import assert from 'node:assert/strict';
import {
  resolveStandingsDisplayState,
  isScoreReady,
  isCleanlyScored,
  draftHasManualSalaryEdits,
} from '../api/_fantasy-post-race-automation.js';
import { evaluateAutomaticTask } from '../api/_mission-control-task-engine.js';

// Unified standings display state
{
  const pending = resolveStandingsDisplayState({ status: 'pending' }, []);
  assert.equal(pending.phase, 'pending');
  assert.equal(pending.showPoints, false);
  assert.equal(pending.scoringAvailable, false);

  const scored = resolveStandingsDisplayState({ status: 'scored' }, [{ lineup_id: '1' }]);
  assert.equal(scored.phase, 'scored');
  assert.equal(scored.showPoints, true);
  assert.equal(scored.label, 'Scoring Complete');

  const review = resolveStandingsDisplayState({ status: 'needs_review' }, [{ lineup_id: '1' }]);
  assert.equal(review.phase, 'needs_review');
  assert.equal(review.showPoints, false);
  assert.match(review.message, /under review/i);

  const staleScores = resolveStandingsDisplayState(null, [{ lineup_id: '1' }]);
  assert.equal(staleScores.phase, 'scored');
  assert.equal(staleScores.showPoints, true);
}

// Score readiness
{
  assert.equal(
    isScoreReady({
      raceComplete: true,
      resultsReady: true,
      lineupCount: 5,
      status: 'ready',
    }),
    true,
  );
  assert.equal(
    isScoreReady({
      raceComplete: true,
      resultsReady: false,
      lineupCount: 5,
      status: 'ready',
    }),
    false,
  );
  assert.equal(
    isScoreReady({
      raceComplete: true,
      resultsReady: true,
      lineupCount: 0,
      status: 'ready',
    }),
    false,
  );
}

// Clean scoring gate for salary draft
{
  assert.equal(
    isCleanlyScored({
      status: 'scored',
      lineupCount: 8,
      unresolvedDrivers: [],
    }),
    true,
  );
  assert.equal(
    isCleanlyScored({
      status: 'needs_review',
      lineupCount: 8,
      unresolvedDrivers: [{ driverId: '1' }],
    }),
    false,
  );
}

// Manual draft protection
{
  assert.equal(draftHasManualSalaryEdits({ slate: { meta: { salaryDraft: { manualEditsPresent: true } } } }), true);
  assert.equal(
    draftHasManualSalaryEdits({
      drivers: [{ salaryOverride: 9500 }],
      slate: { meta: {} },
    }),
    true,
  );
  assert.equal(draftHasManualSalaryEdits({ drivers: [{ salary: 9000 }], slate: { meta: {} } }), false);
}

// Mission Control scoring states
{
  const missing = evaluateAutomaticTask('sun-score-fantasy-lineups', {
    postRace: { raceNumber: 15 },
    fantasyScoringStatus: {
      raceComplete: true,
      resultsReady: false,
      status: 'not_ready',
      resultsReason: 'Official race results are not available yet.',
    },
  });
  assert.equal(missing.complete, false);

  const autoScored = evaluateAutomaticTask('sun-score-fantasy-lineups', {
    postRace: { raceNumber: 15 },
    fantasyScoringStatus: {
      raceComplete: true,
      resultsReady: true,
      status: 'scored',
      lineupCount: 8,
      scoringMeta: { lineupCount: 8, source: 'auto' },
    },
  });
  assert.equal(autoScored.complete, true);
  assert.match(autoScored.reason, /automatically/i);

  const needsReview = evaluateAutomaticTask('sun-score-fantasy-lineups', {
    postRace: { raceNumber: 15 },
    fantasyScoringStatus: {
      raceComplete: true,
      resultsReady: true,
      status: 'needs_review',
      unresolvedDrivers: [{ driverId: '99' }],
    },
  });
  assert.equal(needsReview.complete, false);
}

// Mission Control salary draft states
{
  const waiting = evaluateAutomaticTask('sun-prepare-next-race-salaries', {
    nextRace: { raceNumber: 16, track: 'Michigan' },
    fantasyScoringStatus: { status: 'ready', unresolvedDrivers: [] },
    fantasyPostRaceAutomationStatus: { salaryDraft: { published: false, draft: null } },
  });
  assert.equal(waiting.complete, false);
  assert.match(waiting.reason, /waiting for completed race/i);

  const generated = evaluateAutomaticTask('sun-prepare-next-race-salaries', {
    nextRace: { raceNumber: 16, track: 'Michigan' },
    fantasyScoringStatus: { status: 'scored', unresolvedDrivers: [] },
    fantasyPostRaceAutomationStatus: {
      salaryEngineVersion: 'fantasy-salary-v2.6',
      salaryDraft: {
        published: false,
        draft: { id: 42, raceNumber: 16 },
        needsRegeneration: false,
      },
    },
  });
  assert.equal(generated.complete, true);
  assert.match(generated.reason, /admin review required/i);

  const published = evaluateAutomaticTask('sun-prepare-next-race-salaries', {
    nextRace: { raceNumber: 16 },
    fantasyScoringStatus: { status: 'scored', unresolvedDrivers: [] },
    fantasyPostRaceAutomationStatus: {
      salaryDraft: { published: true, draft: null },
    },
  });
  assert.equal(published.complete, true);
  assert.match(published.reason, /already published/i);

  const conflict = evaluateAutomaticTask('sun-prepare-next-race-salaries', {
    nextRace: { raceNumber: 16 },
    fantasyScoringStatus: { status: 'scored', unresolvedDrivers: [] },
    fantasyPostRaceAutomationStatus: {
      salaryDraft: { published: false, needsRegeneration: true, draft: { id: 42 } },
    },
  });
  assert.equal(conflict.complete, false);
  assert.match(conflict.reason, /needs regeneration/i);
}

// Concurrency: parallel automation calls share one inflight promise
{
  const inflight = new Map();
  let runs = 0;
  async function fakeInternal() {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { runs };
  }
  async function fakeAutomation() {
    const lockKey = 'test-season';
    if (inflight.has(lockKey)) return inflight.get(lockKey);
    const runPromise = fakeInternal().finally(() => inflight.delete(lockKey));
    inflight.set(lockKey, runPromise);
    return runPromise;
  }

  const [a, b] = await Promise.all([fakeAutomation(), fakeAutomation()]);
  assert.equal(a.runs, 1);
  assert.equal(b.runs, 1);
  assert.equal(runs, 1);
}

// Standings sort simulation — stored ranks preserved, not index + 1
{
  const entries = [
    { rank: 3, displayName: 'C', racePoints: 80 },
    { rank: 1, displayName: 'A', racePoints: 120 },
    { rank: 2, displayName: 'B', racePoints: 95 },
  ].sort((a, b) => Number(a.rank) - Number(b.rank));

  assert.deepEqual(
    entries.map((row) => row.rank),
    [1, 2, 3],
  );
  assert.equal(entries[0].displayName, 'A');
}

console.log('test-fantasy-post-race-automation.mjs: all scenarios passed');
