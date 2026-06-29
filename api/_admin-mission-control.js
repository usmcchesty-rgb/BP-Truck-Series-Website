import { getSettings, supabase } from './_lib.js';
import { getEasternDateParts, parseScheduleDateParts } from './_race-date-status.js';
import { resolveFantasySlateProgression, buildFantasyProgressionMeta } from './_fantasy-slate-progression.js';
import { getPointsRaceByNumber } from './_schedule-points-races.js';

export const MISSION_CONTROL_TASKS = [
  {
    id: 'sun-upload-race-control-pdf',
    day: 'sunday',
    dayLabel: 'Sunday',
    title: 'Upload Race Control PDF',
    description: 'Add race control notes for league reference.',
    href: '/admin/news',
  },
  {
    id: 'sun-confirm-race-results',
    day: 'sunday',
    dayLabel: 'Sunday',
    title: 'Confirm race results posted',
    description: 'Verify SimRacerHub results are live on the site.',
    href: '/results.html',
  },
  {
    id: 'sun-score-fantasy-lineups',
    day: 'sunday',
    dayLabel: 'Sunday',
    title: 'Score fantasy lineups if results are available',
    description: 'Run fantasy scoring once official results are confirmed.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'mon-upload-transcript',
    day: 'monday',
    dayLabel: 'Monday',
    title: 'Upload race transcript',
    description: 'Paste the broadcast transcript for news and rankings.',
    href: '/admin/transcripts',
  },
  {
    id: 'mon-publish-race-recap',
    day: 'monday',
    dayLabel: 'Monday',
    title: 'Publish race recap/news article if not already done',
    description: 'Post the weekly race recap for fans.',
    href: '/admin/news',
  },
  {
    id: 'mon-archive-fantasy-slate',
    day: 'monday',
    dayLabel: 'Monday',
    title: 'Archive completed fantasy slate',
    description: 'Confirm the prior race slate is closed and archived.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'wed-generate-power-rankings',
    day: 'wednesday',
    dayLabel: 'Wednesday',
    title: 'Generate Power Rankings',
    description: 'Build the latest rankings draft from race data.',
    href: '/admin/power-rankings',
  },
  {
    id: 'wed-publish-power-rankings',
    day: 'wednesday',
    dayLabel: 'Wednesday',
    title: 'Publish Power Rankings',
    description: 'Review and publish rankings for the site.',
    href: '/admin/power-rankings',
  },
  {
    id: 'wed-review-fantasy-salaries',
    day: 'wednesday',
    dayLabel: 'Wednesday',
    title: 'Review fantasy salaries for next race',
    description: 'Generate and review the upcoming slate salaries.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'thu-publish-driver-spotlight',
    day: 'thursday',
    dayLabel: 'Thursday',
    title: 'Publish Driver Spotlight',
    description: 'Post the mid-week driver feature article.',
    href: '/admin/news',
  },
  {
    id: 'thu-confirm-broadcast-link',
    day: 'thursday',
    dayLabel: 'Thursday',
    title: 'Confirm broadcast link',
    description: 'Verify Green Flag TV / stream embed is correct.',
    href: '/admin/',
  },
  {
    id: 'thu-confirm-next-race-schedule',
    day: 'thursday',
    dayLabel: 'Thursday',
    title: 'Confirm next race schedule/track',
    description: 'Check schedule URL and track info in admin settings.',
    href: '/admin/',
  },
  {
    id: 'fri-post-weekend-outlook',
    day: 'friday',
    dayLabel: 'Friday',
    title: 'Post Weekend Outlook news article',
    description: 'Publish the pre-race preview for fans.',
    href: '/admin/news',
  },
  {
    id: 'fri-publish-fantasy-slate',
    day: 'friday',
    dayLabel: 'Friday',
    title: 'Publish fantasy slate if ready',
    description: 'Publish salaries and open lineup submissions.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'fri-confirm-lineup-lock',
    day: 'friday',
    dayLabel: 'Friday',
    title: 'Confirm lineup lock time',
    description: 'Verify submission close time matches race day plan.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'sat-verify-fantasy-slate-published',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Verify fantasy slate is published',
    description: 'Confirm players see the active slate before lock.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'sat-verify-lineups-open',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Verify lineup submissions are open before lock',
    description: 'Test that lineup builder accepts entries.',
    href: '/fantasy/lineup.html',
  },
  {
    id: 'sat-confirm-submission-close',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Confirm submission close time',
    description: 'Double-check the computed lock matches expectations.',
    href: '/admin/fantasy.html',
  },
  {
    id: 'sat-lock-monitor-entries',
    day: 'saturday',
    dayLabel: 'Saturday / Race Day',
    title: 'Lock/monitor fantasy entries',
    description: 'Watch submitted lineups through lock and race start.',
    href: '/admin/fantasy.html',
  },
];

const DAY_OFFSET_FROM_RACE = {
  wednesday: -4,
  thursday: -3,
  friday: -2,
  saturday: -1,
  sunday: 0,
  monday: 1,
};

const DAY_ORDER = ['sunday', 'monday', 'wednesday', 'thursday', 'friday', 'saturday'];

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

export function getCompletedTaskIds(store, seasonId, raceNumber) {
  const raceStore = store?.[String(seasonId)]?.[String(raceNumber)] || {};
  return Object.keys(raceStore).filter((taskId) => raceStore[taskId]?.completedAt);
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

export function resolveMissionRaceNumber(progression = {}) {
  if (progression.activeSlateRow?.race_number != null) {
    return Number(progression.activeSlateRow.race_number);
  }
  if (progression.archivedSlateRow?.race_number != null) {
    return Number(progression.archivedSlateRow.race_number);
  }
  if (progression.nextRaceNumber != null) {
    return Number(progression.nextRaceNumber);
  }
  return null;
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

function computeTaskDueDateKey(raceDateParts, dayKey) {
  const offset = DAY_OFFSET_FROM_RACE[dayKey];
  if (offset == null || !raceDateParts) return null;
  return easternDateKeyFromParts(addCalendarDays(raceDateParts, offset));
}

function computeTaskStatus({ completed, dueDateKey, todayKey, hasRaceDate }) {
  if (completed) return 'done';
  if (!hasRaceDate || !dueDateKey) return 'pending';
  if (dueDateKey > todayKey) return 'upcoming';
  if (dueDateKey === todayKey) return 'due';
  return 'overdue';
}

const STATUS_SORT = { overdue: 0, due: 1, pending: 2, upcoming: 3, done: 4 };

export function buildMissionControlTasks({
  seasonId,
  raceNumber,
  raceDate,
  completedTaskIds = [],
  now = new Date(),
}) {
  const raceDateParts = raceDate ? parseScheduleDateParts(raceDate) : null;
  const todayKey = easternDateKey(now);
  const hasRaceDate = Boolean(raceDateParts);
  const completedSet = new Set(completedTaskIds);

  const tasks = MISSION_CONTROL_TASKS.map((task) => {
    const dueDateKey = computeTaskDueDateKey(raceDateParts, task.day);
    const completed = completedSet.has(task.id);
    const status = computeTaskStatus({ completed, dueDateKey, todayKey, hasRaceDate });
    return {
      ...task,
      status,
      dueDateKey,
      completed,
      completedAt: completed ? true : false,
    };
  });

  tasks.sort((a, b) => {
    const dayDiff = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
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
      ? { id: nextDueTask.id, title: nextDueTask.title, status: nextDueTask.status, dayLabel: nextDueTask.dayLabel }
      : null,
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

  if (!raceNumber || !taskId) {
    throw new Error('raceNumber and taskId are required.');
  }
  if (!MISSION_CONTROL_TASKS.some((task) => task.id === taskId)) {
    throw new Error(`Unknown mission control task: ${taskId}`);
  }

  const store = await loadMissionControlStore();
  if (!store[seasonId]) store[seasonId] = {};
  if (!store[seasonId][raceNumber]) store[seasonId][raceNumber] = {};

  if (completed) {
    store[seasonId][raceNumber][taskId] = { completedAt: new Date().toISOString() };
  } else {
    delete store[seasonId][raceNumber][taskId];
  }

  const { error } = await sb.from('site_settings').update({ adminMissionControl: store }).eq('id', 1);
  if (error) throw new Error(error.message || 'Failed to save mission control state.');

  return store;
}

export async function buildAdminMissionControlResponse(options = {}) {
  const settings = options.settings || (await getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const now = options.now || new Date();

  const progression = await resolveFantasySlateProgression(seasonId, { settings, now });
  const raceNumber = resolveMissionRaceNumber(progression);
  const raceDate = resolveMissionRaceDate(progression.scheduleRaces, raceNumber);
  const store = await loadMissionControlStore(settings);
  const completedTaskIds = raceNumber != null ? getCompletedTaskIds(store, seasonId, raceNumber) : [];
  const tasks = buildMissionControlTasks({
    seasonId,
    raceNumber,
    raceDate,
    completedTaskIds,
    now,
  });
  const summary = summarizeMissionControl(tasks);

  return {
    seasonId,
    raceNumber,
    raceDate,
    hasRaceDate: Boolean(raceDate),
    fantasyPhase: resolveFantasyPhaseLabel(progression),
    progression: buildFantasyProgressionMeta(progression),
    nextRace: progression.nextRaceNumber
      ? {
          raceNumber: progression.nextRaceNumber,
          track: progression.nextRaceTrack,
          date: progression.nextRaceDate,
        }
      : null,
    tasks,
    summary,
    completedTaskIds,
  };
}
