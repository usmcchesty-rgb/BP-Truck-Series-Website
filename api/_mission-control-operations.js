import { easternDateKey, easternDateKeyFromParts } from './_mission-control-windows.js';
import { parseScheduleDateParts } from './_race-date-status.js';
import { easternLocalDateTimeToUtcIso, parseDisplayLockTimeMinutes } from './_fantasy-lock-time.js';

const SEVERITY_BY_STATUS = {
  overdue: 'critical',
  due: 'high',
  pending: 'medium',
  upcoming: 'info',
  done: 'complete',
  inactive: 'none',
};

const TIMELINE_DAYS = [
  { key: 'sunday', label: 'Sunday' },
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'race', label: 'Race' },
];

function addCalendarDays(parts, delta) {
  const anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

function dateKeyFromParts(parts) {
  return easternDateKeyFromParts(parts);
}

function offsetDateKey(dateKey, deltaDays) {
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return null;
  return dateKeyFromParts(addCalendarDays({ year, month, day }, deltaDays));
}

function isCompletedToday(task, todayKey) {
  if (!task?.completed) return false;
  const stamp = task.manuallyCompletedAt || null;
  if (stamp) {
    const key = easternDateKey(new Date(stamp));
    return key === todayKey;
  }
  if (task.completionSource === 'automatic' && task.dueDateKey === todayKey) {
    return true;
  }
  return false;
}

function isDueToday(task, todayKey) {
  if (task.status === 'inactive' || task.status === 'done') return false;
  if (task.dueDateKey !== todayKey) return false;
  if (task.calendarGated) return false;
  return ['due', 'overdue', 'pending'].includes(task.status);
}

function formatDueTimeLabel(task) {
  if (task.selectedDueDateTime) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'shortGeneric',
    }).format(new Date(task.selectedDueDateTime));
  }
  if (task.lockDiagnostics?.lockTimeEastern) {
    return task.lockDiagnostics.lockTimeEastern;
  }
  return task.dayLabel || 'Today';
}

function bucketComingUp(tasks, todayKey, windowContext) {
  const tomorrowKey = offsetDateKey(todayKey, 1);
  const postEnd = windowContext?.postRaceWindow?.endKey || null;
  const nextEnd = windowContext?.nextRaceWindow?.endKey || null;
  const weekEndKey = [postEnd, nextEnd, tomorrowKey].filter(Boolean).sort().pop() || tomorrowKey;

  const open = tasks.filter(
    (task) =>
      task.status !== 'inactive' &&
      task.status !== 'done' &&
      task.dueDateKey &&
      task.dueDateKey > todayKey,
  );

  const tomorrow = open.filter((task) => task.dueDateKey === tomorrowKey);
  const laterThisWeek = open.filter(
    (task) => task.dueDateKey > tomorrowKey && task.dueDateKey <= weekEndKey,
  );
  const afterRace = open.filter((task) => task.dueDateKey > weekEndKey);

  return { tomorrow, laterThisWeek, afterRace };
}

function resolveRaceStartAt(nextRace, settings = {}) {
  if (!nextRace?.date) return null;
  const parts = parseScheduleDateParts(nextRace.date);
  if (!parts) return null;
  const lockMinutes = parseDisplayLockTimeMinutes(settings.raceStartTime || '6:30pm EST');
  if (lockMinutes == null) return null;
  const hour = Math.floor(lockMinutes / 60);
  const minute = lockMinutes % 60;
  return easternLocalDateTimeToUtcIso({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute,
  });
}

function buildCountdownTargets({ tasks, detectionContext, nextRace, settings, now }) {
  const targets = [];
  const lockContext = detectionContext?.fantasyLockContext || {};

  if (lockContext.lockAt) {
    targets.push({
      id: 'fantasy-lock',
      label: 'Fantasy Lock',
      targetAt: lockContext.lockAt,
      type: 'fantasy_lock',
      taskId: 'sat-lock-monitor-entries',
    });
  }

  const raceStartAt = resolveRaceStartAt(nextRace, settings);
  if (raceStartAt) {
    targets.push({
      id: 'race-start',
      label: 'Race Start',
      targetAt: raceStartAt,
      type: 'race_start',
    });
    targets.push({
      id: 'broadcast',
      label: 'Broadcast',
      targetAt: raceStartAt,
      type: 'broadcast',
      taskId: 'thu-confirm-broadcast-link',
    });
  }

  for (const task of tasks) {
    if (!task.selectedDueDateTime || task.status === 'done' || task.status === 'inactive') continue;
    if (targets.some((row) => row.taskId === task.id)) continue;
    targets.push({
      id: `task-${task.id}`,
      label: task.title,
      targetAt: task.selectedDueDateTime,
      type: 'task_due',
      taskId: task.id,
    });
  }

  return targets
    .filter((row) => row.targetAt && new Date(row.targetAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.targetAt).getTime() - new Date(b.targetAt).getTime());
}

function subsystemStatusFromTasks(taskIds, tasks) {
  const scoped = tasks.filter((task) => taskIds.includes(task.id) && task.status !== 'inactive');
  if (!scoped.length) return { status: 'yellow', detail: 'No tasks in active window' };
  if (scoped.some((task) => task.status === 'overdue')) {
    return { status: 'red', detail: scoped.find((task) => task.status === 'overdue')?.autoReason || 'Blocking issue' };
  }
  if (scoped.every((task) => task.status === 'done')) {
    return { status: 'green', detail: 'Complete' };
  }
  if (scoped.some((task) => task.status === 'due' || task.status === 'pending')) {
    return { status: 'yellow', detail: scoped.find((task) => task.status === 'due')?.title || 'Attention soon' };
  }
  return { status: 'green', detail: 'On track' };
}

function buildLeagueReadiness(tasks, detectionContext) {
  const subsystems = [
    {
      id: 'news',
      label: 'News',
      taskIds: ['fri-post-weekend-outlook', 'thu-publish-driver-spotlight', 'mon-publish-race-recap'],
    },
    {
      id: 'fantasy',
      label: 'Fantasy',
      taskIds: [
        'fri-publish-fantasy-slate',
        'sat-verify-fantasy-slate-published',
        'sat-verify-lineups-open',
        'sat-lock-monitor-entries',
      ],
    },
    { id: 'broadcast', label: 'Broadcast', taskIds: ['thu-confirm-broadcast-link'] },
    {
      id: 'track-images',
      label: 'Track Images',
      taskIds: ['thu-confirm-next-race-schedule'],
    },
    { id: 'race-control', label: 'Race Control', taskIds: ['sun-upload-race-control-pdf'] },
    { id: 'power-rankings', label: 'Power Rankings', taskIds: ['wed-publish-power-rankings'] },
    {
      id: 'driver-photos',
      label: 'Driver Photos',
      taskIds: ['thu-publish-driver-spotlight'],
    },
  ];

  const rows = subsystems.map((def) => {
    const derived = subsystemStatusFromTasks(def.taskIds, tasks);
    if (def.id === 'race-control') {
      const rcTask = tasks.find((task) => task.id === 'sun-upload-race-control-pdf');
      if (rcTask?.status === 'overdue' || rcTask?.status === 'due') {
        derived.detail = rcTask.autoReason || 'Waiting for race report PDF';
        derived.status = rcTask.status === 'overdue' ? 'red' : 'yellow';
      } else if (rcTask?.completed) {
        derived.detail = 'Race Control PDF on file';
        derived.status = 'green';
      }
    }
    if (def.id === 'broadcast') {
      const broadcast = detectionContext?.broadcast || {};
      if (!broadcast.configured) {
        derived.status = 'red';
        derived.detail = 'No Green Flag TV feed found';
      } else if (!broadcast.matchedToRace) {
        derived.status = 'yellow';
        derived.detail = broadcast.matchReason || 'Broadcast needs race match';
      } else {
        derived.status = 'green';
        derived.detail = 'Ready';
      }
    }
    if (def.id === 'fantasy' && detectionContext?.fantasyProgression?.isPlayable) {
      derived.detail = 'Open';
      if (derived.status === 'green') derived.status = 'green';
    }
    return { ...def, ...derived };
  });

  const weights = { green: 1, yellow: 0.6, red: 0 };
  const percent = Math.round(
    (rows.reduce((sum, row) => sum + (weights[row.status] ?? 0), 0) / rows.length) * 100,
  );

  return { percent, subsystems: rows };
}

function buildStatusCards(tasks, detectionContext, readiness) {
  const cardMap = {
    fantasy: readiness.subsystems.find((row) => row.id === 'fantasy'),
    broadcast: readiness.subsystems.find((row) => row.id === 'broadcast'),
    news: readiness.subsystems.find((row) => row.id === 'news'),
    powerRankings: readiness.subsystems.find((row) => row.id === 'power-rankings'),
    trackImages: readiness.subsystems.find((row) => row.id === 'track-images'),
    driverPhotos: readiness.subsystems.find((row) => row.id === 'driver-photos'),
    raceControl: readiness.subsystems.find((row) => row.id === 'race-control'),
  };

  return [
    { id: 'fantasy', label: 'Fantasy', ...pickCard(cardMap.fantasy, 'Open') },
    { id: 'broadcast', label: 'Broadcast', ...pickCard(cardMap.broadcast, 'Ready') },
    { id: 'news', label: 'News', ...pickCard(cardMap.news, 'Published') },
    {
      id: 'powerRankings',
      label: 'Power Rankings',
      ...pickCard(cardMap.powerRankings, 'Complete'),
    },
    { id: 'trackImages', label: 'Track Images', ...pickCard(cardMap.trackImages, 'Ready') },
    { id: 'driverPhotos', label: 'Driver Photos', ...pickCard(cardMap.driverPhotos, 'Ready') },
    { id: 'raceControl', label: 'Race Control', ...pickCard(cardMap.raceControl, 'Waiting') },
  ];
}

function pickCard(row, fallbackDetail) {
  if (!row) return { status: 'yellow', detail: fallbackDetail };
  return { status: row.status, detail: row.detail || fallbackDetail };
}

function buildTaskIntelligence(tasks, detectionContext) {
  const intelligence = {};
  const broadcast = detectionContext?.broadcast || {};
  const nextRaceNumber = detectionContext?.nextRace?.raceNumber ?? null;

  for (const task of tasks) {
    if (task.status === 'inactive') continue;
    const diag = task.detectionDiagnostics || {};
    const lockDiag = task.lockDiagnostics || {};
    const entry = {
      taskId: task.id,
      title: task.title,
      why: task.description || null,
      current: null,
      expected: null,
      detected: [],
      recommendation: task.autoReason || null,
      diagnostics: { ...diag, ...lockDiag },
    };

    if (task.id === 'thu-confirm-broadcast-link') {
      entry.why = 'WHY THIS TASK EXISTS\nConfirm the homepage Green Flag TV embed matches the upcoming race broadcast.';
      entry.current = broadcast.featured?.title
        ? `Latest Green Flag TV upload: ${broadcast.featured.title}`
        : 'No broadcast feed detected';
      entry.expected = nextRaceNumber != null ? `Race ${nextRaceNumber} broadcast` : 'Upcoming race broadcast';
      if (broadcast.featured?.raceNumber != null) {
        entry.detected.push(`Race ${broadcast.featured.raceNumber} video in feed`);
      }
      entry.recommendation = broadcast.matchedToRace
        ? 'Broadcast embed matches the workflow race.'
        : 'Update homepage embed URL to the latest race broadcast.';
    }

    if (task.id === 'fri-post-weekend-outlook') {
      entry.why = 'WHY THIS TASK EXISTS\nFans need a Weekend Outlook article before race day.';
      entry.current = task.completed ? 'Published' : 'Missing';
      entry.expected = 'Published Weekend Outlook article';
      if (diag.matchedArticleType) {
        entry.detected.push(diag.matchedArticleType);
      } else {
        entry.detected.push('Driver Spotlight', 'Race Recap');
      }
      entry.recommendation = task.completed
        ? 'Weekend Outlook is live.'
        : 'Publish Weekend Outlook news article.';
    }

    if (task.id === 'sat-lock-monitor-entries') {
      entry.why = 'WHY THIS TASK EXISTS\nFantasy submissions must close at the published slate lock time.';
      entry.current = task.completed ? 'Locked' : task.calendarGated ? 'Open' : task.status;
      entry.expected = lockDiag.lockTimeEastern
        ? `Lock at ${lockDiag.lockTimeEastern}`
        : 'Slate lock enforced';
      entry.recommendation = task.autoReason;
    }

    if (
      entry.why ||
      entry.current ||
      entry.expected ||
      entry.detected.length ||
      (entry.recommendation && task.detectionMode !== 'manual')
    ) {
      intelligence[task.id] = entry;
    }
  }

  return intelligence;
}

function buildTimeline(tasks, nextRace) {
  const raceParts = nextRace?.date ? parseScheduleDateParts(nextRace.date) : null;
  const raceDayKey = raceParts ? easternDateKeyFromParts(raceParts) : null;
  const byDay = new Map(TIMELINE_DAYS.map((day) => [day.key, []]));

  for (const task of tasks) {
    if (task.status === 'inactive') continue;
    let dayKey = task.day;
    if (raceDayKey && task.dueDateKey === raceDayKey && task.workflow === 'nextRace') {
      dayKey = 'race';
    }
    if (!byDay.has(dayKey)) continue;
    byDay.get(dayKey).push({
      id: task.id,
      title: task.title,
      status: task.status,
      workflow: task.workflow,
      href: task.href,
      dayLabel: task.dayLabel,
    });
  }

  return TIMELINE_DAYS.map((day) => ({
    ...day,
    tasks: byDay.get(day.key) || [],
    worstStatus: worstTimelineStatus(byDay.get(day.key) || []),
  }));
}

function worstTimelineStatus(tasks) {
  const order = { overdue: 0, due: 1, pending: 2, upcoming: 3, done: 4 };
  let worst = 'done';
  for (const task of tasks) {
    if (order[task.status] < order[worst]) worst = task.status;
  }
  return worst;
}

function buildOperationsHistory(store, seasonId, tasks, now) {
  const records = [];
  const raceStore = store?.[String(seasonId)] || {};

  for (const [raceNumber, workflows] of Object.entries(raceStore)) {
    if (!workflows || typeof workflows !== 'object') continue;
    for (const [workflowKey, workflowTasks] of Object.entries(workflows)) {
      if (workflowKey !== 'postRace' && workflowKey !== 'nextRace') continue;
      for (const [taskId, value] of Object.entries(workflowTasks || {})) {
        if (!value?.completedAt) continue;
        const task = tasks.find((row) => row.id === taskId);
        records.push({
          raceNumber: Number(raceNumber),
          workflow: workflowKey,
          taskId,
          completedAt: value.completedAt,
          manualOverride: Boolean(value.manualOverride),
          dueDateKey: task?.dueDateKey || null,
        });
      }
    }
  }

  const manualOverrides = records.filter((row) => row.manualOverride).length;
  const withDue = records.filter((row) => row.dueDateKey);
  const onTime = withDue.filter(
    (row) => easternDateKey(new Date(row.completedAt)) <= row.dueDateKey,
  ).length;
  const late = withDue.length - onTime;

  const byRace = new Map();
  for (const task of tasks.filter((row) => row.status !== 'inactive')) {
    const key = String(task.raceNumber ?? 'general');
    if (!byRace.has(key)) {
      byRace.set(key, { raceNumber: task.raceNumber, total: 0, complete: 0, overdue: 0 });
    }
    const bucket = byRace.get(key);
    bucket.total += 1;
    if (task.status === 'done') bucket.complete += 1;
    if (task.status === 'overdue') bucket.overdue += 1;
  }

  const active = tasks.filter((task) => task.status !== 'inactive');
  const completionPercent = active.length
    ? Math.round((active.filter((task) => task.status === 'done').length / active.length) * 100)
    : 0;

  return {
    manualOverrides,
    onTimeRate: withDue.length ? Math.round((onTime / withDue.length) * 100) : null,
    lateTasks: late,
    completionPercent,
    byRace: [...byRace.values()].map((row) => ({
      ...row,
      percent: row.total ? Math.round((row.complete / row.total) * 100) : 0,
    })),
    monthly: [
      {
        month: new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          month: 'short',
          year: 'numeric',
        }).format(now),
        percent: completionPercent,
      },
    ],
    averageCompletionMinutes: null,
  };
}

function buildRaceWeekProgress(tasks, detectionSummary) {
  const active = tasks.filter((task) => task.status !== 'inactive');
  const complete = active.filter((task) => task.status === 'done').length;
  const total = active.length;
  const overdue = active.filter((task) => task.status === 'overdue').length;
  const upcoming = active.filter((task) => task.status === 'upcoming').length;
  const percent = total ? Math.round((complete / total) * 100) : 0;

  return {
    percent,
    completed: complete,
    total,
    overdue,
    upcoming,
    detectionSummary: detectionSummary?.overall || null,
  };
}

export function buildMissionControlOperations({
  tasks = [],
  postRace = null,
  nextRace = null,
  windowContext = null,
  detectionContext = null,
  detectionSummary = null,
  store = {},
  seasonId = null,
  settings = {},
  now = new Date(),
}) {
  const todayKey = easternDateKey(now);
  const actionable = tasks.filter((task) => task.status !== 'inactive');

  const completedToday = actionable
    .filter((task) => isCompletedToday(task, todayKey))
    .map((task) => ({
      id: task.id,
      title: task.title,
      workflow: task.workflow,
      completedAt: task.manuallyCompletedAt || task.completedAt || null,
      completionSource: task.completionSource,
    }));

  const dueToday = actionable
    .filter((task) => isDueToday(task, todayKey))
    .map((task) => ({
      id: task.id,
      title: task.title,
      workflow: task.workflow,
      status: task.status,
      severity: SEVERITY_BY_STATUS[task.status] || 'medium',
      dueTime: formatDueTimeLabel(task),
      countdownTarget: task.selectedDueDateTime || task.lockDiagnostics?.lockAt || null,
      href: task.href,
      dayLabel: task.dayLabel,
    }));

  const comingUp = bucketComingUp(actionable, todayKey, windowContext);
  const countdowns = buildCountdownTargets({
    tasks: actionable,
    detectionContext,
    nextRace,
    settings,
    now,
  });
  const raceWeekProgress = buildRaceWeekProgress(tasks, detectionSummary);
  const leagueReadiness = buildLeagueReadiness(tasks, detectionContext);
  const statusCards = buildStatusCards(tasks, detectionContext, leagueReadiness);
  const taskIntelligence = buildTaskIntelligence(tasks, detectionContext);
  const timeline = buildTimeline(tasks, nextRace);
  const operationsHistory = buildOperationsHistory(store, seasonId, tasks, now);

  const nextRaceDateKey = nextRace?.date
    ? easternDateKeyFromParts(parseScheduleDateParts(nextRace.date) || {})
    : null;
  const isRaceDay = Boolean(nextRaceDateKey && todayKey === nextRaceDateKey);
  const raceDayMode = isRaceDay && Boolean(windowContext?.nextRaceWindow?.active);

  const raceDayOperations = {
    active: raceDayMode,
    headerTitle: 'RACE DAY OPERATIONS',
    raceNumber: nextRace?.raceNumber ?? null,
    track: nextRace?.track ?? null,
    countdowns: countdowns.filter((row) =>
      ['fantasy_lock', 'broadcast', 'race_start'].includes(row.type),
    ),
    focusTasks: actionable.filter(
      (task) =>
        task.workflow === 'nextRace' &&
        ['saturday', 'sunday'].includes(task.day) &&
        task.status !== 'done',
    ),
  };

  return {
    todayKey,
    isRaceDay,
    raceDayMode,
    todaysOperations: {
      completedToday,
      dueToday,
      comingUp,
    },
    countdowns,
    raceWeekProgress,
    leagueReadiness,
    statusCards,
    taskIntelligence,
    timeline,
    raceDayOperations,
    operationsHistory,
  };
}
