import {
  computeFantasyLockAt,
  formatLockTimeLinePretty,
} from './_fantasy-lock-time.js';
import { easternDateKey, easternDateKeyFromParts, computeWindowAwareTaskStatus } from './_mission-control-windows.js';

export const FANTASY_LOCK_REVIEW_TASK_IDS = new Set([
  'fri-confirm-lineup-lock',
  'sat-confirm-submission-close',
]);

export const FANTASY_LOCK_MONITOR_TASK_IDS = new Set(['sat-lock-monitor-entries']);

export const FANTASY_LOCK_RELATED_TASK_IDS = new Set([
  ...FANTASY_LOCK_REVIEW_TASK_IDS,
  ...FANTASY_LOCK_MONITOR_TASK_IDS,
]);

function addCalendarDays(dateParts, deltaDays) {
  const anchor = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day));
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

function dateKeyFromParts(parts) {
  return easternDateKeyFromParts(parts);
}

function dayBeforeDateKey(dateKey) {
  if (!dateKey) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return null;
  return dateKeyFromParts(addCalendarDays({ year, month, day }, -1));
}

export function formatEasternDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'shortGeneric',
  }).format(date);
}

export function formatEasternLockDayLabel(lockAtIso, lockTimeDisplay = '') {
  if (!lockAtIso) return null;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(new Date(lockAtIso));
  const timeLine = formatLockTimeLinePretty(lockTimeDisplay).replace(/\s+EST$/i, ' ET');
  return `${weekday.toUpperCase()} — ${timeLine}`;
}

export function getActiveWorkflowSlate(ctx = {}) {
  const workflowRaceNumber = ctx.nextRace?.raceNumber ?? null;
  const active = ctx.fantasyProgression?.activeSlateRow || null;
  if (!active || workflowRaceNumber == null) return null;
  if (Number(active.race_number) !== Number(workflowRaceNumber)) return null;
  if (active.status !== 'published') return null;
  return active;
}

export async function buildFantasyLockMissionContext(ctx = {}) {
  const workflowRaceNumber = ctx.nextRace?.raceNumber ?? null;
  const workflowTrackName = ctx.nextRace?.track ?? null;
  const slate = getActiveWorkflowSlate(ctx);
  const now = ctx.now || new Date();
  const nowEastern = formatEasternDateTime(now);

  if (!slate) {
    return {
      workflowRaceNumber,
      workflowTrackName,
      slateRaceNumber: null,
      slateId: null,
      lockAt: null,
      lockTimeEastern: null,
      nowEastern,
      lockPassed: false,
      lockDateKey: null,
      reviewDueDateKey: null,
      lockDayLabel: null,
      lockDescriptionLine: null,
      selectedDueSource: null,
      selectedDueDateTime: null,
    };
  }

  let lockAt = slate.lock_at || slate.lockAt || null;
  let lockTimeDisplay = slate.lock_time || slate.lockTime || null;
  let selectedDueSource = lockAt ? 'fantasy_slate_lock' : null;

  if (!lockAt && workflowRaceNumber != null) {
    try {
      const computed = await computeFantasyLockAt({
        raceNumber: workflowRaceNumber,
        settings: ctx.settings,
        seasonId: ctx.seasonId,
        lockTimeDisplay,
        now,
      });
      lockAt = computed.lock_at || null;
      lockTimeDisplay = computed.lock_time || lockTimeDisplay;
      selectedDueSource = lockAt ? 'fantasy_slate_lock_computed' : null;
    } catch {
      lockAt = null;
    }
  }

  const lockDateKey = lockAt ? easternDateKey(new Date(lockAt)) : null;
  const lockPassed = lockAt ? now.getTime() >= new Date(lockAt).getTime() : false;
  const lockTimeEastern = lockTimeDisplay
    ? formatLockTimeLinePretty(lockTimeDisplay).replace(/\s+EST$/i, ' ET')
    : null;
  const lockDayLabel = lockAt ? formatEasternLockDayLabel(lockAt, lockTimeDisplay) : null;
  const lockDescriptionLine =
    lockAt && lockTimeEastern
      ? `Submission closes ${new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }).format(new Date(lockAt))} at ${lockTimeEastern}.`
      : null;

  const raceLine =
    workflowRaceNumber != null
      ? `Race ${workflowRaceNumber}${workflowTrackName ? ` — ${workflowTrackName}` : ''}`
      : null;
  const descriptionLine =
    raceLine && lockDescriptionLine ? `${raceLine}\n${lockDescriptionLine}` : lockDescriptionLine;

  if (
    workflowRaceNumber != null &&
    slate.race_number != null &&
    Number(workflowRaceNumber) !== Number(slate.race_number)
  ) {
    console.warn('[MissionControl] fantasy lock workflow/slate race mismatch', {
      workflowRaceNumber,
      slateRaceNumber: slate.race_number,
      slateId: slate.id,
    });
  }

  return {
    workflowRaceNumber,
    workflowTrackName,
    slateRaceNumber: slate.race_number ?? null,
    slateId: slate.id ?? null,
    lockAt,
    lockTimeEastern,
    lockTimeDisplay,
    nowEastern,
    lockPassed,
    lockDateKey,
    reviewDueDateKey: dayBeforeDateKey(lockDateKey),
    lockDayLabel,
    lockDescriptionLine: descriptionLine,
    selectedDueSource,
    selectedDueDateTime: lockAt,
    slate,
  };
}

export function buildFantasyLockDiagnostics(lockContext = {}, taskId = null) {
  return {
    workflowRaceNumber: lockContext.workflowRaceNumber ?? null,
    slateRaceNumber: lockContext.slateRaceNumber ?? null,
    slateId: lockContext.slateId ?? null,
    lockAt: lockContext.lockAt ?? null,
    lockTimeEastern: lockContext.lockTimeEastern ?? null,
    nowEastern: lockContext.nowEastern ?? null,
    lockPassed: Boolean(lockContext.lockPassed),
    selectedDueSource: lockContext.selectedDueSource ?? null,
    selectedDueDateTime: lockContext.selectedDueDateTime ?? null,
    taskId,
  };
}

export function warnGenericSaturdayDueWhenLockExists(
  taskId,
  lockContext = {},
  genericDueDateKey = null,
  resolvedDueDateKey = null,
) {
  if (!lockContext?.lockAt || !FANTASY_LOCK_MONITOR_TASK_IDS.has(taskId)) return;
  const lockDateKey = lockContext.lockDateKey;
  const dueInUse = resolvedDueDateKey ?? genericDueDateKey;
  if (
    genericDueDateKey &&
    lockDateKey &&
    dueInUse === genericDueDateKey &&
    genericDueDateKey !== lockDateKey
  ) {
    console.warn('[MissionControl] generic Saturday due date used while fantasy lock_at exists', {
      taskId,
      genericDueDateKey,
      lockAt: lockContext.lockAt,
      lockDateKey,
    });
  }
}

export function computeFantasyLockMonitorStatus({
  completed,
  lockContext = {},
  now = new Date(),
  windowActive = true,
  workflow = 'nextRace',
  windowContext = null,
}) {
  if (completed) return 'done';

  if (!windowActive) {
    return computeWindowAwareTaskStatus({
      completed: false,
      dueDateKey: lockContext.lockDateKey,
      todayKey: easternDateKey(now),
      hasRaceDate: Boolean(lockContext.lockDateKey),
      windowActive: false,
      workflow,
      windowContext,
    });
  }

  if (!lockContext.lockAt) return 'pending';

  const nowMs = now.getTime();
  const lockMs = new Date(lockContext.lockAt).getTime();
  if (!Number.isFinite(lockMs)) return 'pending';

  if (nowMs < lockMs) return 'upcoming';
  return 'overdue';
}

export function computeFantasyLockReviewStatus(args) {
  return computeWindowAwareTaskStatus(args);
}

export function resolveFantasyLockTaskPresentation({
  task,
  lockContext = {},
  genericDueDateKey = null,
  todayKey,
  hasRaceDate,
  now = new Date(),
  raceNumber = null,
  track = null,
}) {
  if (!FANTASY_LOCK_RELATED_TASK_IDS.has(task.id)) {
    return null;
  }

  const diagnostics = buildFantasyLockDiagnostics(lockContext, task.id);
  const raceLine =
    raceNumber != null ? `Race ${raceNumber}${track ? ` — ${track}` : ''}` : null;

  if (FANTASY_LOCK_MONITOR_TASK_IDS.has(task.id)) {
    const dayLabel = lockContext.lockDayLabel || 'LOCKS AT RACE SLATE TIME';
    const dueDateKey = lockContext.lockDateKey || genericDueDateKey;
    warnGenericSaturdayDueWhenLockExists(task.id, lockContext, genericDueDateKey, dueDateKey);
    const description = lockContext.lockDescriptionLine
      ? lockContext.lockDescriptionLine
      : raceLine
        ? `${raceLine}\nMonitor fantasy entries through the published slate lock time.`
        : task.description;

    return {
      dueDateKey,
      dayLabel,
      description,
      calendarGate: {
        fantasyLockAt: lockContext.lockAt || null,
        now,
        dayLabel,
        autoReason: buildFantasyLockMonitorAutoReason(lockContext, {}),
      },
      lockDiagnostics: diagnostics,
      selectedDueSource: lockContext.selectedDueSource || 'fantasy_slate_lock',
      selectedDueDateTime: lockContext.selectedDueDateTime || lockContext.lockAt || null,
      statusComputer: ({ completed, windowActive, workflow, windowContext }) =>
        computeFantasyLockMonitorStatus({
          completed,
          lockContext,
          now,
          windowActive,
          workflow,
          windowContext,
        }),
    };
  }

  if (task.id === 'sat-confirm-submission-close') {
    const reviewDueDateKey = lockContext.reviewDueDateKey || genericDueDateKey;
    const lockSuffix = lockContext.lockDayLabel
      ? lockContext.lockDayLabel.split(' — ').slice(1).join(' — ')
      : null;
    const dayLabel = lockSuffix
      ? `SATURDAY — REVIEW (LOCKS ${lockSuffix})`
      : 'Saturday — Review';
    const description = lockContext.lockDescriptionLine
      ? `${raceLine ? `${raceLine}\n` : ''}Review submission close time before lock.\n${lockContext.lockDescriptionLine}`
      : task.description;

    return {
      dueDateKey: reviewDueDateKey,
      dayLabel,
      description,
      calendarGate: {
        dayLabel,
      },
      lockDiagnostics: diagnostics,
      selectedDueSource: 'fantasy_lock_review',
      selectedDueDateTime: lockContext.lockAt || null,
      statusComputer: ({ completed, windowActive, workflow, windowContext }) =>
        computeFantasyLockReviewStatus({
          completed,
          dueDateKey: reviewDueDateKey,
          todayKey,
          hasRaceDate: Boolean(reviewDueDateKey || hasRaceDate),
          windowActive,
          workflow,
          windowContext,
        }),
    };
  }

  if (task.id === 'fri-confirm-lineup-lock') {
    const lockSuffix = lockContext.lockDayLabel
      ? lockContext.lockDayLabel.split(' — ').slice(1).join(' — ')
      : null;
    const description = lockContext.lockDescriptionLine
      ? `${raceLine ? `${raceLine}\n` : ''}Verify submission close time matches race day plan.\n${lockContext.lockDescriptionLine}`
      : task.description;

    return {
      dueDateKey: genericDueDateKey,
      dayLabel: lockSuffix
        ? `FRIDAY — REVIEW (LOCKS ${lockSuffix})`
        : task.dayLabel,
      description,
      calendarGate: {
        dayLabel: task.dayLabel,
      },
      lockDiagnostics: diagnostics,
      selectedDueSource: 'fantasy_lock_review',
      selectedDueDateTime: lockContext.lockAt || null,
    };
  }

  return null;
}

export function buildFantasyLockMonitorAutoReason(lockContext = {}, lockState = {}) {
  const timeLabel = lockContext.lockTimeEastern || 'the published lock time';
  if (!lockContext.lockAt) {
    return 'Fantasy slate lock time is not set yet.';
  }
  if (!lockContext.lockPassed) {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
    }).format(new Date(lockContext.lockAt));
    return `Lineups remain open until ${weekday} at ${timeLabel}.`;
  }
  if (lockState.isLocked) {
    return `Fantasy submissions closed at ${timeLabel}.`;
  }
  return 'Fantasy submissions should be closed, but entries are still open.';
}
