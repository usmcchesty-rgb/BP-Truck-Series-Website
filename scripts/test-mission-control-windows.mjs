import assert from 'node:assert/strict';
import {
  buildMissionControlWindowContext,
  computeWindowAwareTaskStatus,
  easternDateKeyFromParts,
} from '../api/_mission-control-windows.js';
import {
  buildWorkflowTasks,
  summarizeMissionControl,
} from '../api/_admin-mission-control.js';

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

const completedRace = {
  raceNumber: 14,
  track: 'Gateway',
  date: 'Jun 29, 2025',
};

const upcomingRace = {
  raceNumber: 15,
  track: 'Nashville',
  date: 'Jul 12, 2025',
};

function buildContext(now) {
  return buildMissionControlWindowContext({
    postRace: completedRace,
    nextRace: upcomingRace,
    now,
  });
}

function buildTasks(workflow, now, windowContext) {
  const race = workflow === 'postRace' ? completedRace : upcomingRace;
  return buildWorkflowTasks({
    workflow,
    raceNumber: race.raceNumber,
    raceDate: race.date,
    taskCompletions: new Map(),
    detectionContext: null,
    now,
    windowContext,
  });
}

// Off week between races (Race 14 Jun 29, Race 15 Jul 12, today Jul 3)
{
  const now = makeEasternInstant({ year: 2025, month: 7, day: 3 });
  const windowContext = buildContext(now);

  assert.equal(windowContext.isOffWeek, true);
  assert.equal(windowContext.phase, 'offweek');
  assert.equal(windowContext.postRaceWindow.active, false);
  assert.equal(windowContext.nextRaceWindow.active, false);

  const postRaceTasks = buildTasks('postRace', now, windowContext);
  const nextRaceTasks = buildTasks('nextRace', now, windowContext);
  const allTasks = [...postRaceTasks, ...nextRaceTasks];
  const summary = summarizeMissionControl(allTasks, windowContext);

  assert.equal(summary.isOffWeek, true);
  assert.equal(summary.remainingCount, 0);
  assert.equal(summary.offWeekMessage, 'Off week — no race-week tasks due.');

  const staleOverdue = allTasks.filter((task) => task.status === 'overdue');
  assert.equal(staleOverdue.length, 0, 'off week must not leave stale overdue tasks');

  const prepWednesday = nextRaceTasks.find((task) => task.id === 'wed-review-fantasy-salaries');
  assert.equal(prepWednesday.status, 'upcoming', 'prep tasks before prep window stay upcoming');
}

// Race day (Sunday Jun 29) — post-race window only; next-race prep has not started
{
  const now = makeEasternInstant({ year: 2025, month: 6, day: 29 });
  const windowContext = buildContext(now);

  assert.equal(windowContext.isOffWeek, false);
  assert.equal(windowContext.phase, 'postRace');
  assert.equal(windowContext.postRaceWindow.active, true);
  assert.equal(windowContext.nextRaceWindow.active, false);

  const postRaceTasks = buildTasks('postRace', now, windowContext);
  const sundayTask = postRaceTasks.find((task) => task.id === 'sun-confirm-race-results');
  assert.equal(sundayTask.status, 'due');
}

// Wednesday after race (Jul 2) — last day of post-race window
{
  const now = makeEasternInstant({ year: 2025, month: 7, day: 2 });
  const windowContext = buildContext(now);

  assert.equal(windowContext.isOffWeek, false);
  assert.equal(windowContext.phase, 'postRace');
  assert.equal(windowContext.postRaceWindow.active, true);
  assert.equal(windowContext.nextRaceWindow.active, false);

  const postRaceTasks = buildTasks('postRace', now, windowContext);
  const wedTask = postRaceTasks.find((task) => task.id === 'wed-generate-power-rankings');
  assert.equal(wedTask.status, 'due');
}

// Monday after race (Jun 30)
{
  const now = makeEasternInstant({ year: 2025, month: 6, day: 30 });
  const windowContext = buildContext(now);

  assert.equal(windowContext.isOffWeek, false);
  assert.equal(windowContext.phase, 'postRace');
  assert.equal(windowContext.postRaceWindow.active, true);

  const postRaceTasks = buildTasks('postRace', now, windowContext);
  const mondayTask = postRaceTasks.find((task) => task.id === 'mon-upload-transcript');
  assert.equal(mondayTask.status, 'due');
}

// Next-race prep window begins (Wednesday Jul 9)
{
  const now = makeEasternInstant({ year: 2025, month: 7, day: 9 });
  const windowContext = buildContext(now);

  assert.equal(windowContext.isOffWeek, false);
  assert.equal(windowContext.phase, 'nextRacePrep');
  assert.equal(windowContext.nextRaceWindow.active, true);

  const nextRaceTasks = buildTasks('nextRace', now, windowContext);
  const wedPrep = nextRaceTasks.find((task) => task.id === 'wed-review-fantasy-salaries');
  const thuPrep = nextRaceTasks.find((task) => task.id === 'thu-publish-driver-spotlight');
  assert.equal(wedPrep.status, 'overdue', 'Wednesday prep becomes overdue after Wednesday');
  assert.equal(thuPrep.status, 'due', 'Thursday prep is due on Thursday');
}

// Long gap: post-race tasks inactive after window ends
{
  const now = makeEasternInstant({ year: 2025, month: 7, day: 5 });
  const windowContext = buildContext(now);
  const postRaceTasks = buildTasks('postRace', now, windowContext);

  assert.equal(windowContext.isOffWeek, true);
  for (const task of postRaceTasks) {
    assert.notEqual(task.status, 'overdue', `${task.id} should not be overdue during off week`);
    assert.notEqual(task.status, 'due', `${task.id} should not be due during off week`);
  }
}

// computeWindowAwareTaskStatus unit checks
{
  const todayKey = easternDateKeyFromParts({ year: 2025, month: 7, day: 3 });
  const windowContext = buildContext(makeEasternInstant({ year: 2025, month: 7, day: 3 }));

  assert.equal(
    computeWindowAwareTaskStatus({
      completed: false,
      dueDateKey: '2025-06-30',
      todayKey,
      hasRaceDate: true,
      windowActive: false,
      workflow: 'postRace',
      windowContext,
    }),
    'inactive',
  );

  assert.equal(
    computeWindowAwareTaskStatus({
      completed: false,
      dueDateKey: '2025-07-09',
      todayKey,
      hasRaceDate: true,
      windowActive: false,
      workflow: 'nextRace',
      windowContext,
    }),
    'upcoming',
  );
}

console.log('mission-control-windows: all scenarios passed');
