import { getSettings, supabase } from './_lib.js';
import { resolveFantasySlateProgression, buildFantasyProgressionMeta } from './_fantasy-slate-progression.js';
import {
  getEasternDateParts,
  getEffectivePointsRaceProgression,
  parseScheduleDateParts,
} from './_race-date-status.js';
import { getPointsRaceByNumber } from './_schedule-points-races.js';
import {
  DETECTION_MODES,
  loadMissionControlDetectionContext,
  resolveTaskCompletionState,
  summarizeDetectionCounts,
} from './_mission-control-task-engine.js';

export const MISSION_CONTROL_TASKS = [
  {
    id: 'sun-upload-race-control-pdf',
    workflow: 'postRace',
    raceRole: 'completed',
    day: 'sunday',
    dayLabel: 'Sunday',
    title: 'Upload Race Control PDF',
    description: 'Add race control notes for league reference.',
    href: '/admin/news',
  },
  {
    id: 'sun-confirm-race-results',
    workflow: 'postRace',
    raceRole: 'completed',
    day: 'sunday',
    dayLabel: 'Sunday',
    title: 'Confirm race results posted',
    description: 'Verify SimRacerHub results are live on the site.',
    href: '/results.html',
  },
  {
    id: 'sun-score-fantasy-lineups',
    workflow: 'postRace',
    raceRole: 'completed',
    day: 'sunday',
    dayLabel: 'Sunday',
    title: 'Score fantasy lineups if results are available',
    description: 'Run fantasy scoring once official results are confirmed.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'mon-upload-transcript',
    workflow: 'postRace',
    raceRole: 'completed',
    day: 'monday',
    dayLabel: 'Monday',
    title: 'Upload race transcript',
    description: 'Paste the broadcast transcript for news and rankings.',
    href: '/admin/transcripts',
  },
  {
    id: 'mon-publish-race-recap',
    workflow: 'postRace',
    raceRole: 'completed',
    day: 'monday',
    dayLabel: 'Monday',
    title: 'Publish race recap/news article if not already done',
    description: 'Post the weekly race recap for fans.',
    href: '/admin/news',
  },
  {
    id: 'wed-generate-power-rankings',
    workflow: 'postRace',
    raceRole: 'completed',
    day: 'wednesday',
    dayLabel: 'Wednesday',
    title: 'Generate Power Rankings',
    description: 'Build rankings from the completed race results.',
    href: '/admin/power-rankings',
  },
  {
    id: 'wed-publish-power-rankings',
    workflow: 'postRace',
    raceRole: 'completed',
    day: 'wednesday',
    dayLabel: 'Wednesday',
    title: 'Publish Power Rankings',
    description: 'Review and publish rankings for the completed race.',
    href: '/admin/power-rankings',
  },
  {
    id: 'wed-review-fantasy-salaries',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'wednesday',
    dayLabel: 'Wednesday',
    title: 'Review fantasy salaries for next race',
    description: 'Generate and review the upcoming slate salaries.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'thu-publish-driver-spotlight',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'thursday',
    dayLabel: 'Thursday',
    title: 'Publish Driver Spotlight',
    description: 'Post the mid-week driver feature article.',
    href: '/admin/news',
  },
  {
    id: 'thu-confirm-broadcast-link',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'thursday',
    dayLabel: 'Thursday',
    title: 'Confirm broadcast link',
    description: 'Verify Green Flag TV / stream embed is correct.',
    href: '/admin/',
  },
  {
    id: 'thu-confirm-next-race-schedule',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'thursday',
    dayLabel: 'Thursday',
    title: 'Confirm next race schedule/track',
    description: 'Check schedule URL and track info in admin settings.',
    href: '/admin/',
  },
  {
    id: 'fri-post-weekend-outlook',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'friday',
    dayLabel: 'Friday',
    title: 'Post Weekend Outlook news article',
    description: 'Publish the pre-race preview for fans.',
    href: '/admin/news',
  },
  {
    id: 'fri-publish-fantasy-slate',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'friday',
    dayLabel: 'Friday',
    title: 'Publish fantasy slate if ready',
    description: 'Publish salaries and open lineup submissions.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'fri-confirm-lineup-lock',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'friday',
    dayLabel: 'Friday',
    title: 'Confirm lineup lock time',
    description: 'Verify submission close time matches race day plan.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'sat-verify-fantasy-slate-published',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Verify fantasy slate is published',
    description: 'Confirm players see the active slate before lock.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'sat-verify-lineups-open',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Verify lineup submissions are open before lock',
    description: 'Test that lineup builder accepts entries.',
    href: '/fantasy/lineup.html',
  },
  {
    id: 'sat-confirm-submission-close',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Confirm submission close time',
    description: 'Double-check the computed lock matches expectations.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'sat-lock-monitor-entries',
    workflow: 'nextRace',
    raceRole: 'upcoming',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Lock/monitor fantasy entries',
    description: 'Watch submitted lineups through lock and race start.',
    href: '/admin/fantasy.html',
  },
];

const TASK_DETECTION_MODES = {
  'sun-upload-race-control-pdf': DETECTION_MODES.MANUAL,
  'sun-confirm-race-results': DETECTION_MODES.AUTOMATIC,
  'sun-score-fantasy-lineups': DETECTION_MODES.PLACEHOLDER,
  'mon-upload-transcript': DETECTION_MODES.MANUAL,
  'mon-publish-race-recap': DETECTION_MODES.AUTOMATIC,
  'wed-generate-power-rankings': DETECTION_MODES.MANUAL,
  'wed-publish-power-rankings': DETECTION_MODES.AUTOMATIC,
  'wed-review-fantasy-salaries': DETECTION_MODES.MANUAL,
  'thu-publish-driver-spotlight': DETECTION_MODES.AUTOMATIC,
  'thu-confirm-broadcast-link': DETECTION_MODES.AUTOMATIC,
  'thu-confirm-next-race-schedule': DETECTION_MODES.AUTOMATIC,
  'fri-post-weekend-outlook': DETECTION_MODES.AUTOMATIC,
  'fri-publish-fantasy-slate': DETECTION_MODES.AUTOMATIC,
  'fri-confirm-lineup-lock': DETECTION_MODES.MANUAL,
  'sat-verify-fantasy-slate-published': DETECTION_MODES.AUTOMATIC,
  'sat-verify-lineups-open': DETECTION_MODES.AUTOMATIC,
  'sat-confirm-submission-close': DETECTION_MODES.MANUAL,
  'sat-lock-monitor-entries': DETECTION_MODES.AUTOMATIC,
};

for (const task of MISSION_CONTROL_TASKS) {
  task.detectionMode = TASK_DETECTION_MODES[task.id] || DETECTION_MODES.MANUAL;
  task.raceRole = task.raceRole || (task.workflow === 'postRace' ? 'completed' : 'upcoming');
}

const POST_RACE_DAY_OFFSET = {
  sunday: 0,
  monday: 1,
  wednesday: 3,
};

const NEXT_RACE_DAY_OFFSET = {
  wednesday: -4,
  thursday: -3,
  friday: -2,
  saturday: -1,
};

const POST_RACE_DAY_ORDER = ['sunday', 'monday', 'wednesday'];
const NEXT_RACE_DAY_ORDER = ['wednesday', 'thursday', 'friday', 'saturday'];

const WORKFLOW_ORDER = ['postRace', 'nextRace'];

export function parseMissionControlStore(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function easternDateKeyFromParts({ year, month, day }) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function easternDateKey(date = new Date()) {
  return easternDateKeyFromParts(getEasternDateParts(date));
}

function addCalendarDays(dateParts, deltaDays) {
  const anchor = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day));
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

function getTaskDefinition(taskId) {
  return MISSION_CONTROL_TASKS.find((task) => task.id === taskId) || null;
}

function isWorkflowBucket(value) {
  return value === 'postRace' || value === 'nextRace';
}

export function getCompletedTaskIds(store, seasonId, raceNumber, workflow) {
  const raceStore = store?.[String(seasonId)]?.[String(raceNumber)] || {};
  const workflowStore = isWorkflowBucket(workflow) ? raceStore[workflow] || {} : {};
  const completed = new Set();

  for (const [key, value] of Object.entries(workflowStore)) {
    if (value?.completedAt) completed.add(key);
  }

  if (!isWorkflowBucket(workflow)) return Array.from(completed);

  for (const [key, value] of Object.entries(raceStore)) {
    if (isWorkflowBucket(key) || !value?.completedAt) continue;
    const task = getTaskDefinition(key);
    if (task?.workflow === workflow) completed.add(key);
  }

  return Array.from(completed);
}

export function resolveMissionControlRaces(scheduleRaces, options = {}) {
  const progression = getEffectivePointsRaceProgression(scheduleRaces, options);
  const completedRace = progression.latestCompletedPointsRace || null;
  const upcomingRace =
    progression.currentUpcomingPointsRace || progression.nextPointsRace || null;

  const postRaceNumber = completedRace?.officialPointsRaceNumber ?? null;
  const nextRaceNumber = upcomingRace?.officialPointsRaceNumber ?? null;

  return {
    postRace:
      postRaceNumber != null
        ? {
            raceNumber: Number(postRaceNumber),
            track: completedRace?.track || null,
            date: completedRace?.date || null,
          }
        : null,
    nextRace:
      nextRaceNumber != null && nextRaceNumber !== postRaceNumber
        ? {
            raceNumber: Number(nextRaceNumber),
            track: upcomingRace?.track || null,
            date: upcomingRace?.date || null,
          }
        : nextRaceNumber != null
          ? {
              raceNumber: Number(nextRaceNumber),
              track: upcomingRace?.track || null,
              date: upcomingRace?.date || null,
            }
          : null,
    progressionMeta: {
      effectiveCompletedPointsCount: progression.effectiveCompletedPointsCount,
      suggestedPointsRaceNumber: progression.suggestedPointsRaceNumber,
    },
  };
}

export function resolveMissionRaceDate(scheduleRaces, raceNumber) {
  if (raceNumber == null) return null;
  const race = getPointsRaceByNumber(scheduleRaces, Number(raceNumber));
  return race?.date || null;
}

export function resolveFantasyPhaseLabel(progression = {}) {
  if (progression.isPlayable) return 'Active';
  if (progression.slatePhase === 'race-complete' || progression.archivedSlateRow) {
    return 'Race complete — scoring pending';
  }
  if (progression.hasUpcomingRaceWithoutSlate) return 'Next slate needed';
  return 'Next slate needed';
}

function computeTaskDueDateKey(raceDateParts, workflow, dayKey) {
  if (!raceDateParts) return null;
  const offsetMap = workflow === 'postRace' ? POST_RACE_DAY_OFFSET : NEXT_RACE_DAY_OFFSET;
  const offset = offsetMap[dayKey];
  if (offset == null) return null;
  return easternDateKeyFromParts(addCalendarDays(raceDateParts, offset));
}

function computeTaskStatus({ completed, dueDateKey, todayKey, hasRaceDate }) {
  if (!hasRaceDate || !dueDateKey) return completed ? 'done' : 'pending';
  if (dueDateKey > todayKey) return 'upcoming';
  if (completed) return 'done';
  if (dueDateKey === todayKey) return 'due';
  return 'overdue';
}

const STATUS_SORT = { overdue: 0, due: 1, pending: 2, upcoming: 3, done: 4 };

function getDayOrderForWorkflow(workflow) {
  return workflow === 'postRace' ? POST_RACE_DAY_ORDER : NEXT_RACE_DAY_ORDER;
}

export function buildWorkflowTasks({
  workflow,
  raceNumber,
  raceDate,
  completedTaskIds = [],
  detectionContext = null,
  now = new Date(),
}) {
  const raceDateParts = raceDate ? parseScheduleDateParts(raceDate) : null;
  const todayKey = easternDateKey(now);
  const hasRaceDate = Boolean(raceDateParts);
  const manualCompletedIds = new Set(completedTaskIds);
  const dayOrder = getDayOrderForWorkflow(workflow);

  const tasks = MISSION_CONTROL_TASKS.filter((task) => task.workflow === workflow).map((task) => {
    const dueDateKey = computeTaskDueDateKey(raceDateParts, workflow, task.day);
    const calendarGate = { dueDateKey, todayKey, hasRaceDate, dayLabel: task.dayLabel };
    const completion = detectionContext
      ? resolveTaskCompletionState(task, detectionContext, manualCompletedIds, calendarGate)
      : resolveTaskCompletionState(
          task,
          {},
          manualCompletedIds,
          calendarGate
        );
    const completed = Boolean(completion.completed);
    const status = computeTaskStatus({ completed, dueDateKey, todayKey, hasRaceDate });
    return {
      ...task,
      workflow,
      raceNumber,
      status,
      dueDateKey,
      completed,
      completedAt: completed ? true : false,
      completionSource: completion.completionSource,
      autoReason: completion.autoReason || null,
      autoPending: completion.autoPending === true,
      calendarGated: completion.calendarGated === true,
    };
  });

  tasks.sort((a, b) => {
    const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
    if (dayDiff !== 0) return dayDiff;
    return STATUS_SORT[a.status] - STATUS_SORT[b.status];
  });

  return tasks;
}

export function summarizeMissionControl(tasks = []) {
  const openTasks = tasks.filter((task) => task.status !== 'done');
  const remainingCount = openTasks.length;
  const nextDueTask =
    openTasks
      .filter((task) => task.status === 'overdue' || task.status === 'due' || task.status === 'pending')
      .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status])[0] ||
    openTasks.find((task) => task.status === 'upcoming') ||
    null;

  return {
    remainingCount,
    nextDueTask: nextDueTask
      ? {
          id: nextDueTask.id,
          title: nextDueTask.title,
          status: nextDueTask.status,
          dayLabel: nextDueTask.dayLabel,
          workflow: nextDueTask.workflow,
        }
      : null,
  };
}

function buildWorkflowBucket({
  workflow,
  bucket,
  scheduleRaces,
  store,
  seasonId,
  detectionContext,
  now,
}) {
  if (!bucket?.raceNumber) {
    return {
      workflow,
      raceNumber: null,
      track: null,
      date: null,
      hasRaceDate: false,
      tasks: [],
      summary: summarizeMissionControl([]),
      detectionSummary: summarizeDetectionCounts([]),
      completedTaskIds: [],
    };
  }

  const raceDate = bucket.date || resolveMissionRaceDate(scheduleRaces, bucket.raceNumber);
  const completedTaskIds = getCompletedTaskIds(store, seasonId, bucket.raceNumber, workflow);
  const tasks = buildWorkflowTasks({
    workflow,
    raceNumber: bucket.raceNumber,
    raceDate,
    completedTaskIds,
    detectionContext,
    now,
  });

  return {
    workflow,
    raceNumber: bucket.raceNumber,
    track: bucket.track || null,
    date: raceDate,
    hasRaceDate: Boolean(raceDate && parseScheduleDateParts(raceDate)),
    tasks,
    summary: summarizeMissionControl(tasks),
    detectionSummary: summarizeDetectionCounts(tasks),
    completedTaskIds,
  };
}

export async function loadMissionControlStore(settings = null) {
  const resolved = settings || (await getSettings());
  return parseMissionControlStore(resolved.adminMissionControl);
}

export async function setMissionControlTaskComplete(options = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const seasonId = String(options.seasonId || '27987');
  const raceNumber = String(options.raceNumber);
  const taskId = String(options.taskId || '').trim();
  const completed = options.completed !== false;
  const workflow = String(options.workflow || '').trim();

  if (!raceNumber || !taskId) {
    throw new Error('raceNumber and taskId are required.');
  }

  const taskDef = getTaskDefinition(taskId);
  if (!taskDef) {
    throw new Error(`Unknown mission control task: ${taskId}`);
  }

  const resolvedWorkflow = workflow || taskDef.workflow;
  if (resolvedWorkflow !== taskDef.workflow) {
    throw new Error(`Task ${taskId} does not belong to workflow ${workflow}.`);
  }
  if (taskDef.detectionMode !== DETECTION_MODES.MANUAL) {
    throw new Error('Only manual tasks can be marked complete from admin.');
  }

  const store = await loadMissionControlStore();
  if (!store[seasonId]) store[seasonId] = {};
  if (!store[seasonId][raceNumber]) store[seasonId][raceNumber] = {};
  if (!store[seasonId][raceNumber][resolvedWorkflow]) store[seasonId][raceNumber][resolvedWorkflow] = {};

  if (completed) {
    store[seasonId][raceNumber][resolvedWorkflow][taskId] = { completedAt: new Date().toISOString() };
    if (store[seasonId][raceNumber][taskId]) {
      delete store[seasonId][raceNumber][taskId];
    }
  } else {
    delete store[seasonId][raceNumber][resolvedWorkflow][taskId];
  }

  const { error } = await sb.from('site_settings').update({ adminMissionControl: store }).eq('id', 1);
  if (error) throw new Error(error.message || 'Failed to save mission control state.');

  return store;
}

export async function buildAdminMissionControlResponse(options = {}) {
  const settings = options.settings || (await getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const now = options.now || new Date();

  const fantasyProgression = await resolveFantasySlateProgression(seasonId, { settings, now });
  const scheduleRaces = fantasyProgression.scheduleRaces || [];
  const raceBuckets = resolveMissionControlRaces(scheduleRaces, { now, settings });
  const store = await loadMissionControlStore(settings);

  const detectionContext = await loadMissionControlDetectionContext({
    settings,
    seasonId,
    now,
    scheduleRaces,
    fantasyProgression,
    postRace: raceBuckets.postRace,
    nextRace: raceBuckets.nextRace,
  });

  const postRace = buildWorkflowBucket({
    workflow: 'postRace',
    bucket: raceBuckets.postRace,
    scheduleRaces,
    store,
    seasonId,
    detectionContext,
    now,
  });

  const nextRace = buildWorkflowBucket({
    workflow: 'nextRace',
    bucket: raceBuckets.nextRace,
    scheduleRaces,
    store,
    seasonId,
    detectionContext,
    now,
  });

  const allTasks = [...postRace.tasks, ...nextRace.tasks];
  const summary = summarizeMissionControl(allTasks);
  const detectionSummary = summarizeDetectionCounts(allTasks);

  return {
    seasonId,
    fantasyPhase: resolveFantasyPhaseLabel(fantasyProgression),
    progression: buildFantasyProgressionMeta(fantasyProgression),
    postRace,
    nextRace,
    tasks: allTasks,
    summary,
    detectionSummary,
    hasRaceDate: Boolean(postRace.hasRaceDate || nextRace.hasRaceDate),
    workflows: {
      postRace,
      nextRace,
    },
    raceNumber: postRace.raceNumber ?? nextRace.raceNumber ?? null,
    raceDate: postRace.date ?? nextRace.date ?? null,
    completedTaskIds: [...postRace.completedTaskIds, ...nextRace.completedTaskIds],
  };
}

export {
  POST_RACE_DAY_ORDER,
  NEXT_RACE_DAY_ORDER,
  WORKFLOW_ORDER,
  POST_RACE_DAY_OFFSET,
  NEXT_RACE_DAY_OFFSET,
};
