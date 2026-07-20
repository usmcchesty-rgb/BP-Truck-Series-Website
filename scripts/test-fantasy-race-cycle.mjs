import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFantasyRaceCycleModel,
  buildFantasyRaceCycleSteps,
  buildSummaryDashboard,
  displayValue,
  getActionDisabledReason,
  getAutoExpandedStepId,
  getNextRecommendedAction,
  runFullValidation,
  shouldStepExpand,
  STEP_STATUS,
} from '../scripts/helpers/fantasy-race-cycle-state.js';
import {
  confirmationMatches,
  expectedConfirmationPhrase,
  recordRecoveryAudit,
  requiresTypedConfirmation,
} from '../scripts/helpers/fantasy-race-cycle-recovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function baseContext(overrides = {}) {
  return {
    seasonName: 'Season 11',
    adminStats: {
      progression: { isPlayable: false },
      nextRace: { raceNumber: 5, track: 'Nashville', date: '2026-04-01' },
      slate: { id: 10, drivers: [{ salary: 9000, driver_id: '1' }, { salary: 8000, driver_id: '2' }] },
      driverPoolHealth: { counts: { eligibleRosterDrivers: 20, slateDriverCount: 20, unresolvedIdentity: 0 } },
      lockPreview: { valid: true, lockTimeDisplay: 'Sunday 7:45 PM' },
      publishedSlate: null,
    },
    postRace: {
      completedRace: { raceNumber: 4, track: 'Charlotte', date: '2026-03-01' },
      nextRace: { raceNumber: 5, track: 'Nashville', date: '2026-04-01' },
      scoring: {
        resultsReady: true,
        status: 'ready',
        lineupCount: 12,
        unresolvedDrivers: [],
        officialStarterCount: 28,
        dnpCount: 2,
        provisionalCount: 0,
      },
      salaryDraft: { published: false, draft: { id: 11, driver_count: 20 } },
      lineupScores: [],
    },
    scoring: {
      resultsReady: true,
      status: 'ready',
      lineupCount: 12,
      unresolvedDrivers: [],
    },
    manualApprovals: {},
    ...overrides,
  };
}

function emptyContext() {
  return {
    seasonName: null,
    adminStats: {
      progression: {},
      lockPreview: { valid: false },
      driverPoolHealth: { counts: {} },
    },
    postRace: { scoring: { resultsReady: false, unresolvedDrivers: [] } },
    scoring: { resultsReady: false, unresolvedDrivers: [] },
    manualApprovals: {},
  };
}

{
  const model = buildFantasyRaceCycleModel(emptyContext());
  assert.equal(model.progress.completedRequired, 0);
  assert.equal(model.progress.totalRequired, 12);
}

{
  const model = buildFantasyRaceCycleModel(baseContext());
  assert.ok(model.progress.completedRequired >= 2);
  assert.ok(model.progress.completedRequired < 12);
}

{
  const model = buildFantasyRaceCycleModel(baseContext());
  const completed = model.steps.filter((step) => step.status === STEP_STATUS.COMPLETE);
  for (const step of completed) {
    assert.equal(shouldStepExpand(step, model.autoExpandedStepId, {}), false);
  }
}

{
  const model = buildFantasyRaceCycleModel(baseContext());
  const current = model.steps.find((step) => step.id === model.autoExpandedStepId);
  assert.ok(current);
  assert.equal(shouldStepExpand(current, model.autoExpandedStepId, {}), true);
}

{
  const context = baseContext({
    postRace: {
      ...baseContext().postRace,
      scoring: { resultsReady: false, unresolvedDrivers: [] },
    },
    scoring: { resultsReady: false, unresolvedDrivers: [] },
  });
  const steps = buildFantasyRaceCycleSteps(context);
  const next = getNextRecommendedAction(steps);
  const autoId = getAutoExpandedStepId(steps, next);
  const blocked = steps.find((step) => step.id === autoId);
  assert.equal(blocked.status, STEP_STATUS.BLOCKED);
}

{
  const model = buildFantasyRaceCycleModel(baseContext({
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'scored',
        scoringMeta: { status: 'scored', scoredAt: '2026-03-02T01:00:00.000Z' },
        unresolvedDrivers: [],
      },
      salaryDraft: { published: true, draft: { id: 11, driver_count: 20 } },
    },
    scoring: {
      resultsReady: true,
      status: 'scored',
      scoringMeta: { status: 'scored', scoredAt: '2026-03-02T01:00:00.000Z' },
    },
    manualApprovals: { slateReview: true },
    adminStats: {
      ...baseContext().adminStats,
      publishedSlate: { id: 12, lock_time: 'Sunday 7:45 PM', published_at: '2026-03-03T00:00:00.000Z' },
      progression: { isPlayable: true },
    },
  }));
  assert.equal(model.phases.postRace.status, 'Complete');
  assert.match(model.phases.nextRace.status, /6 of 6 steps complete|Complete/);
}

{
  const summary = buildSummaryDashboard(baseContext(), buildFantasyRaceCycleSteps(baseContext()));
  assert.equal(summary.season, 'Season 11');
  assert.match(summary.previousRace, /Race 4/);
  assert.match(summary.nextRace, /Race 5/);
}

{
  const summary = buildSummaryDashboard(emptyContext(), buildFantasyRaceCycleSteps(emptyContext()));
  assert.equal(displayValue(undefined), 'Not available');
  assert.equal(summary.season, 'Not available');
  assert.equal(summary.previousRace, 'Not available');
}

{
  const model = buildFantasyRaceCycleModel(baseContext({
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'scored',
        scoringMeta: { status: 'scored' },
        unresolvedDrivers: [],
      },
      salaryDraft: { published: true, draft: { id: 11, driver_count: 20 } },
    },
    scoring: { resultsReady: true, status: 'scored', scoringMeta: { status: 'scored' } },
    manualApprovals: { slateReview: true },
    adminStats: {
      ...baseContext().adminStats,
      publishedSlate: { id: 12, lock_time: 'Sunday 7:45 PM' },
      progression: { isPlayable: true },
    },
  }));
  assert.equal(model.readiness.ready, true);
  assert.equal(model.readiness.title, 'READY FOR NEXT RACE');
}

{
  const model = buildFantasyRaceCycleModel(baseContext({
    adminStats: {
      ...baseContext().adminStats,
      slate: { id: 10, drivers: [{ salary: 9000, driver_id: '1' }, { driver_id: '2' }] },
      lockPreview: { valid: false },
    },
  }));
  assert.equal(model.readiness.ready, false);
  assert.ok(model.readiness.issues.length >= 2);
  assert.ok(model.readiness.issues.some((issue) => /salary/i.test(issue.message)));
  assert.ok(model.readiness.issues.some((issue) => /lock time/i.test(issue.message)));
}

{
  const steps = buildFantasyRaceCycleSteps(baseContext({
    scoring: { resultsReady: false, unresolvedDrivers: [] },
    postRace: { ...baseContext().postRace, scoring: { resultsReady: false, unresolvedDrivers: [] } },
  }));
  const step3 = steps.find((step) => step.id === 'calculate_fantasy_scoring');
  assert.equal(step3.actionEnabled, false);
}

{
  const steps = buildFantasyRaceCycleSteps(baseContext({
    scoring: { resultsReady: false, unresolvedDrivers: [] },
    postRace: { ...baseContext().postRace, scoring: { resultsReady: false, unresolvedDrivers: [] } },
  }));
  const step3 = steps.find((step) => step.id === 'calculate_fantasy_scoring');
  const reason = getActionDisabledReason(step3, steps);
  assert.match(reason, /official results/i);
}

{
  const before = JSON.stringify(baseContext());
  runFullValidation(baseContext(), buildFantasyRaceCycleSteps(baseContext()));
  assert.equal(JSON.stringify(baseContext()), before);
}

{
  const readyBase = baseContext({
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'scored',
        scoringMeta: { status: 'scored' },
        unresolvedDrivers: [],
      },
    },
    scoring: { resultsReady: true, status: 'scored', scoringMeta: { status: 'scored' } },
    manualApprovals: { slateReview: true },
  });
  const validation = runFullValidation({
    ...readyBase,
    adminStats: {
      ...readyBase.adminStats,
      slate: { id: 10, drivers: [{ driver_id: '1' }, { driver_id: '2' }] },
    },
  }, buildFantasyRaceCycleSteps(readyBase));
  assert.ok(validation.blocking.some((row) => /salary/i.test(row.label)));
}

{
  const readyBase = baseContext({
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'scored',
        scoringMeta: { status: 'scored' },
        unresolvedDrivers: [],
      },
    },
    scoring: { resultsReady: true, status: 'scored', scoringMeta: { status: 'scored' } },
    manualApprovals: { slateReview: true },
  });
  const validation = runFullValidation({
    ...readyBase,
    adminStats: {
      ...readyBase.adminStats,
      slate: {
        id: 10,
        drivers: [
          { salary: 9000, driver_id: '1' },
          { salary: 8000, driver_id: '1' },
        ],
      },
    },
  }, buildFantasyRaceCycleSteps(readyBase));
  assert.ok(validation.blocking.some((row) => /duplicate/i.test(row.label)));
}

{
  const validation = runFullValidation(baseContext({
    adminStats: {
      ...baseContext().adminStats,
      lockPreview: { valid: false },
      publishedSlate: null,
    },
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'scored',
        scoringMeta: { status: 'scored' },
        unresolvedDrivers: [],
      },
      salaryDraft: { published: false, draft: { id: 11, driver_count: 20 } },
    },
    scoring: { resultsReady: true, status: 'scored', scoringMeta: { status: 'scored' } },
    manualApprovals: { slateReview: true },
  }), buildFantasyRaceCycleSteps(baseContext()));
  assert.ok(validation.blocking.some((row) => /lock time/i.test(row.label)));
}

{
  const readyBase = baseContext({
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'scored',
        scoringMeta: { status: 'scored' },
        unresolvedDrivers: [],
      },
      salaryDraft: { published: false, draft: { id: 11, driver_count: 20 } },
    },
    scoring: { resultsReady: true, status: 'scored', scoringMeta: { status: 'scored' } },
    manualApprovals: { slateReview: true },
  });
  const validation = runFullValidation(readyBase, buildFantasyRaceCycleSteps(readyBase));
  assert.ok(validation.blocking.some((row) => /published/i.test(row.label)));
}

{
  const validation = runFullValidation(baseContext({
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'scored',
        scoringMeta: { status: 'scored' },
        unresolvedDrivers: [],
      },
      salaryDraft: { published: true, draft: { id: 11, driver_count: 20 } },
    },
    scoring: { resultsReady: true, status: 'scored', scoringMeta: { status: 'scored' } },
    manualApprovals: { slateReview: true },
    adminStats: {
      ...baseContext().adminStats,
      publishedSlate: { id: 12, lock_time: 'Sunday 7:45 PM' },
      progression: { isPlayable: true },
    },
  }), buildFantasyRaceCycleSteps(baseContext()));
  assert.equal(validation.passed, true);
}

{
  const html = fs.readFileSync(path.join(repoRoot, 'public/admin/fantasy.html'), 'utf8');
  assert.match(html, /Advanced \/ Recovery Tools/);
  assert.doesNotMatch(html, /<details class="frc-advanced-wrap[^"]*" open/i);
}

{
  assert.equal(requiresTypedConfirmation('full_regenerate_published_slate'), true);
  assert.equal(requiresTypedConfirmation('add_missing_eligible_drivers'), false);
  const phrase = expectedConfirmationPhrase('full_regenerate_published_slate', { raceNumber: 5 });
  assert.equal(phrase, 'REGENERATE RACE 5');
  assert.equal(confirmationMatches('full_regenerate_published_slate', 'regenerate race 5', { raceNumber: 5 }), true);
}

{
  const steps = buildFantasyRaceCycleSteps(baseContext());
  const next = getNextRecommendedAction(steps);
  assert.equal(next.stepNumber, 3);
}

{
  const model = buildFantasyRaceCycleModel(baseContext());
  assert.equal(model.nextRecommendedAction.stepId, 'calculate_fantasy_scoring');
}

{
  const context = baseContext({
    scoring: { resultsReady: false, unresolvedDrivers: [] },
    postRace: { ...baseContext().postRace, scoring: { resultsReady: false, unresolvedDrivers: [] } },
  });
  const model = buildFantasyRaceCycleModel(context);
  assert.equal(model.autoExpandedStepId, 'calculate_fantasy_scoring');
}

{
  const attention = fs.readFileSync(path.join(repoRoot, 'public/admin/admin-attention.js'), 'utf8');
  assert.doesNotMatch(attention, /setInterval\(/);
  assert.doesNotMatch(attention, /pollTimer\s*=/);
}

{
  const ui = fs.readFileSync(path.join(repoRoot, 'public/admin/fantasy-race-cycle-ui.js'), 'utf8');
  assert.doesNotMatch(ui, /for\s*\([^)]*drivers[^)]*\)[\s\S]{0,120}fetch\(/);
}

{
  const routable = fs
    .readdirSync(path.join(repoRoot, 'api'))
    .filter((name) => name.endsWith('.js') && !name.startsWith('_'));
  assert.equal(routable.length, 12);
}

{
  const uiBundle = [
    fs.readFileSync(path.join(repoRoot, 'public/admin/fantasy-race-cycle-ui.js'), 'utf8'),
    fs.readFileSync(path.join(repoRoot, 'public/admin/fantasy-race-cycle-state.js'), 'utf8'),
    fs.readFileSync(path.join(repoRoot, 'public/admin/fantasy.html'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(uiBundle, /estimated completion/i);
  assert.doesNotMatch(uiBundle, /30 seconds/i);
  assert.doesNotMatch(uiBundle, /1 minute/i);
  assert.doesNotMatch(uiBundle, /Duration icons/i);
}

{
  const storage = new Map();
  const mockStorage = {
    setItem(key, value) {
      storage.set(key, value);
    },
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
  };
  const stamp = recordRecoveryAudit('full_regenerate_published_slate', mockStorage);
  assert.ok(stamp);
  assert.ok(mockStorage.getItem('frc_recovery_audit_full_regenerate_published_slate'));
}

{
  const context = baseContext({
    scoring: {
      resultsReady: true,
      status: 'ready',
      unresolvedDrivers: [{ driverId: '1' }, { driverId: '2' }],
    },
    postRace: {
      ...baseContext().postRace,
      scoring: {
        resultsReady: true,
        status: 'ready',
        unresolvedDrivers: [{ driverId: '1' }, { driverId: '2' }],
      },
    },
  });
  const steps = buildFantasyRaceCycleSteps(context);
  const step2 = steps.find((s) => s.id === 'import_official_results');
  const step3 = steps.find((s) => s.id === 'calculate_fantasy_scoring');
  assert.equal(step2.status, STEP_STATUS.NEEDS_REVIEW);
  assert.equal(step3.status, STEP_STATUS.BLOCKED);
  assert.match(String(step2.blockedReason), /not linked to BP driver profiles/i);
}

{
  const context = baseContext({
    postRace: {
      ...baseContext().postRace,
      lineupScores: [{ rank: 1 }],
      scoring: {
        resultsReady: true,
        status: 'needs_review',
        scoringMeta: { scoredAt: '2026-03-02T00:00:00.000Z', status: 'needs_review' },
        unresolvedDrivers: [],
        lineupCount: 3,
      },
    },
    scoring: {
      resultsReady: true,
      status: 'needs_review',
      scoringMeta: { scoredAt: '2026-03-02T00:00:00.000Z', status: 'needs_review' },
      unresolvedDrivers: [],
    },
    manualApprovals: { scoringReview: true },
  });
  const steps = buildFantasyRaceCycleSteps(context);
  assert.equal(steps.find((s) => s.id === 'review_fantasy_scoring').status, STEP_STATUS.COMPLETE);
  assert.equal(steps.find((s) => s.id === 'finalize_contest').status, STEP_STATUS.READY);
}

console.log('test-fantasy-race-cycle: all tests passed');
