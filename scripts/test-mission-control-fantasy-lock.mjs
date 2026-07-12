import assert from 'node:assert/strict';
import { buildWorkflowTasks } from '../api/_admin-mission-control.js';
import { buildMissionControlWindowContext } from '../api/_mission-control-windows.js';
import {
  buildFantasyLockMissionContext,
  computeFantasyLockMonitorStatus,
  formatEasternLockDayLabel,
  resolveFantasyLockTaskPresentation,
} from '../api/_mission-control-fantasy-lock.js';
import { easternLocalDateTimeToUtcIso } from '../api/_fantasy-lock-time.js';
import { evaluateAutomaticTask } from '../api/_mission-control-task-engine.js';

function makeEasternInstant({ year, month, day, hour = 12, minute = 0 }) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  for (let offsetHours = -8; offsetHours <= 12; offsetHours += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0));
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    if (
      Number(parts.year) === year &&
      Number(parts.month) === month &&
      Number(parts.day) === day &&
      Number(parts.hour) === hour &&
      Number(parts.minute) === minute
    ) {
      return candidate;
    }
  }

  throw new Error(`Unable to build Eastern instant for ${year}-${month}-${day} ${hour}:${minute}`);
}

const RACE_15 = {
  raceNumber: 15,
  track: 'Pocono Raceway',
  date: 'Jul 12, 2026',
};

const LOCK_AT = easternLocalDateTimeToUtcIso({
  year: 2026,
  month: 7,
  day: 12,
  hour: 18,
  minute: 30,
});

const SLATE_ROW = {
  id: 'slate-race-15',
  race_number: 15,
  status: 'published',
  lock_at: LOCK_AT,
  lock_time: '6:30pm EST',
};

function buildLockContext(now) {
  const lockPassed = now.getTime() >= new Date(LOCK_AT).getTime();
  return {
    workflowRaceNumber: 15,
    workflowTrackName: 'Pocono Raceway',
    slateRaceNumber: 15,
    slateId: SLATE_ROW.id,
    lockAt: LOCK_AT,
    lockTimeEastern: '6:30 PM ET',
    lockTimeDisplay: '6:30pm EST',
    nowEastern: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'shortGeneric',
    }).format(now),
    lockPassed,
    lockDateKey: '2026-07-12',
    reviewDueDateKey: '2026-07-11',
    lockDayLabel: formatEasternLockDayLabel(LOCK_AT, '6:30pm EST'),
    lockDescriptionLine:
      'Race 15 — Pocono Raceway\nSubmission closes Sunday, July 12, 2026 at 6:30 PM ET.',
    selectedDueSource: 'fantasy_slate_lock',
    selectedDueDateTime: LOCK_AT,
    slate: SLATE_ROW,
  };
}

function buildDetectionContext(now, slateOverrides = {}) {
  const slate = { ...SLATE_ROW, ...slateOverrides };
  return {
    now,
    nextRace: RACE_15,
    fantasyProgression: {
      activeSlateRow: slate,
      isPlayable: true,
      nextRaceNumber: 15,
    },
    fantasyLockContext: buildLockContext(now),
  };
}

function buildRaceWeekTasks(now, detectionContext) {
  const windowContext = buildMissionControlWindowContext({
    postRace: { raceNumber: 14, track: 'Gateway', date: 'Jun 28, 2026' },
    nextRace: RACE_15,
    now,
  });

  return buildWorkflowTasks({
    workflow: 'nextRace',
    raceNumber: 15,
    raceDate: RACE_15.date,
    track: RACE_15.track,
    taskCompletions: new Map(),
    detectionContext,
    fantasyLockContext: detectionContext.fantasyLockContext,
    now,
    windowContext,
  });
}

function getLockMonitorTask(tasks) {
  return tasks.find((task) => task.id === 'sat-lock-monitor-entries');
}

function getConfirmCloseTask(tasks) {
  return tasks.find((task) => task.id === 'sat-confirm-submission-close');
}

// Saturday before a Sunday lock — monitor must stay upcoming, not overdue
{
  const now = makeEasternInstant({ year: 2026, month: 7, day: 11, hour: 14, minute: 0 });
  const detectionContext = buildDetectionContext(now);
  const tasks = buildRaceWeekTasks(now, detectionContext);
  const monitor = getLockMonitorTask(tasks);
  const confirmClose = getConfirmCloseTask(tasks);

  assert.equal(monitor.status, 'upcoming', 'Saturday before lock must not be overdue');
  assert.equal(monitor.dayLabel, 'SUNDAY — 6:30 PM ET');
  assert.match(monitor.description, /Submission closes Sunday, July 12, 2026 at 6:30 PM ET/);
  assert.equal(monitor.lockDiagnostics.selectedDueSource, 'fantasy_slate_lock');
  assert.equal(monitor.lockDiagnostics.lockAt, LOCK_AT);
  assert.equal(monitor.calendarGated, true);
  assert.match(monitor.autoReason, /Lineups remain open until Sunday at 6:30 PM ET/);
  assert.notEqual(confirmClose.status, 'overdue', 'review task should not use race-day overdue on Saturday');
}

// Sunday morning before lock
{
  const now = makeEasternInstant({ year: 2026, month: 7, day: 12, hour: 10, minute: 0 });
  const detectionContext = buildDetectionContext(now);
  const tasks = buildRaceWeekTasks(now, detectionContext);
  const monitor = getLockMonitorTask(tasks);

  assert.equal(monitor.status, 'upcoming');
  assert.equal(monitor.calendarGated, true);
}

// 6:29 PM ET — still upcoming
{
  const now = makeEasternInstant({ year: 2026, month: 7, day: 12, hour: 18, minute: 29 });
  const detectionContext = buildDetectionContext(now);
  const tasks = buildRaceWeekTasks(now, detectionContext);
  const monitor = getLockMonitorTask(tasks);

  assert.equal(monitor.status, 'upcoming');
  assert.equal(monitor.completed, false);
}

// 6:30 PM ET — lock moment with enforced slate lock
{
  const now = makeEasternInstant({ year: 2026, month: 7, day: 12, hour: 18, minute: 30 });
  const detectionContext = buildDetectionContext(now);
  const tasks = buildRaceWeekTasks(now, detectionContext);
  const monitor = getLockMonitorTask(tasks);

  assert.equal(monitor.status, 'done');
  assert.equal(monitor.completed, true);
  assert.equal(monitor.completionSource, 'automatic');
  assert.match(monitor.autoReason, /Fantasy submissions closed at 6:30 PM ET/);
}

// 6:31 PM ET with locked slate — auto complete
{
  const now = makeEasternInstant({ year: 2026, month: 7, day: 12, hour: 18, minute: 31 });
  const detectionContext = buildDetectionContext(now);
  const auto = evaluateAutomaticTask('sat-lock-monitor-entries', detectionContext);
  const tasks = buildRaceWeekTasks(now, detectionContext);
  const monitor = getLockMonitorTask(tasks);

  assert.equal(auto.complete, true);
  assert.match(auto.reason, /Fantasy submissions closed at 6:30 PM ET/);
  assert.equal(monitor.status, 'done');
  assert.equal(monitor.completed, true);
  assert.equal(monitor.completionSource, 'automatic');
}

// 6:31 PM ET with incorrectly open slate — overdue
{
  const now = makeEasternInstant({ year: 2026, month: 7, day: 12, hour: 18, minute: 31 });
  const futureLockAt = easternLocalDateTimeToUtcIso({
    year: 2026,
    month: 7,
    day: 12,
    hour: 19,
    minute: 0,
  });
  const detectionContext = buildDetectionContext(now, { lock_at: futureLockAt });
  detectionContext.fantasyLockContext = {
    ...buildLockContext(now),
    lockAt: LOCK_AT,
    lockPassed: true,
  };

  const auto = evaluateAutomaticTask('sat-lock-monitor-entries', detectionContext);
  const tasks = buildRaceWeekTasks(now, detectionContext);
  const monitor = getLockMonitorTask(tasks);

  assert.equal(auto.complete, false);
  assert.match(auto.reason, /should be closed, but entries are still open/);
  assert.equal(monitor.status, 'overdue');
  assert.equal(monitor.completed, false);
}

// Daylight saving time conversion — March lock uses EDT offset
{
  const springLockAt = easternLocalDateTimeToUtcIso({
    year: 2026,
    month: 3,
    day: 15,
    hour: 18,
    minute: 30,
  });
  assert.ok(springLockAt, 'spring lock converts to UTC');

  const beforeDst = makeEasternInstant({ year: 2026, month: 3, day: 15, hour: 18, minute: 29 });
  const afterDst = makeEasternInstant({ year: 2026, month: 3, day: 15, hour: 18, minute: 31 });

  const springContext = {
    now: beforeDst,
    settings: {},
    seasonId: '27987',
    nextRace: { raceNumber: 3, track: 'Test Track', date: 'Mar 15, 2026' },
    fantasyProgression: {
      activeSlateRow: {
        id: 'spring-slate',
        race_number: 3,
        status: 'published',
        lock_at: springLockAt,
        lock_time: '6:30pm EST',
      },
    },
  };

  const built = await buildFantasyLockMissionContext(springContext);
  assert.equal(built.slateRaceNumber, 3);
  assert.equal(built.lockAt, springLockAt);

  assert.equal(
    computeFantasyLockMonitorStatus({
      completed: false,
      lockContext: { ...built, lockPassed: false },
      now: beforeDst,
      windowActive: true,
      workflow: 'nextRace',
    }),
    'upcoming',
  );

  assert.equal(
    computeFantasyLockMonitorStatus({
      completed: false,
      lockContext: { ...built, lockPassed: true },
      now: afterDst,
      windowActive: true,
      workflow: 'nextRace',
    }),
    'overdue',
  );
}

// Presentation separates review due date from lock monitor due date
{
  const now = makeEasternInstant({ year: 2026, month: 7, day: 11, hour: 12, minute: 0 });
  const lockContext = buildLockContext(now);
  const review = resolveFantasyLockTaskPresentation({
    task: { id: 'sat-confirm-submission-close', dayLabel: 'Saturday / Race Day', description: 'old' },
    lockContext,
    genericDueDateKey: '2026-07-11',
    todayKey: '2026-07-11',
    hasRaceDate: true,
    now,
    raceNumber: 15,
    track: 'Pocono Raceway',
  });
  const monitor = resolveFantasyLockTaskPresentation({
    task: { id: 'sat-lock-monitor-entries', dayLabel: 'Saturday / Race Day', description: 'old' },
    lockContext,
    genericDueDateKey: '2026-07-11',
    todayKey: '2026-07-11',
    hasRaceDate: true,
    now,
    raceNumber: 15,
    track: 'Pocono Raceway',
  });

  assert.equal(review.dueDateKey, '2026-07-11');
  assert.match(review.dayLabel, /SATURDAY — REVIEW \(LOCKS 6:30 PM ET\)/);
  assert.equal(monitor.dueDateKey, '2026-07-12');
  assert.equal(monitor.dayLabel, 'SUNDAY — 6:30 PM ET');
}

console.log('test-mission-control-fantasy-lock.mjs: all scenarios passed');
