import { getSettings, mergeFantasyLifecycle, supabase } from './_lib.js';
import { getPointsRaceByNumber } from './_schedule-points-races.js';
import { hasRaceResults } from './_race-date-status.js';
import { loadFantasyScheduleContext } from './_fantasy-slate-progression.js';
import { extractScheduleIdFromRace } from './_fantasy-slate.js';
import { getLockDisplayState } from './_fantasy-lock-time.js';

export const LIFECYCLE_STATES = {
  UPCOMING: 'UPCOMING',
  OPEN: 'OPEN',
  LOCKED: 'LOCKED',
  WAITING_FOR_RESULTS: 'WAITING_FOR_RESULTS',
  READY_TO_SCORE: 'READY_TO_SCORE',
  SCORING: 'SCORING',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  FINALIZED: 'FINALIZED',
  ADVANCING: 'ADVANCING',
  NEXT_WEEK_READY: 'NEXT_WEEK_READY',
  SEASON_COMPLETE: 'SEASON_COMPLETE',
  NEEDS_ADMIN_ATTENTION: 'NEEDS_ADMIN_ATTENTION',
};

export const LIFECYCLE_TRIGGERS = {
  RESULTS_UPDATE: 'results_update',
  MONDAY_SAFETY: 'monday_safety',
  MANUAL: 'manual',
};

export const FAILURE_CODES = {
  WAITING_FOR_RESULTS: 'WAITING_FOR_RESULTS',
  WAITING_FOR_FINAL_SCORING_DATA: 'WAITING_FOR_FINAL_SCORING_DATA',
  NEXT_RACE_NOT_FOUND: 'NEXT_RACE_NOT_FOUND',
  DRIVER_POOL_ERROR: 'DRIVER_POOL_ERROR',
  SCORING_FAILED: 'SCORING_FAILED',
  NEEDS_ADMIN_ATTENTION: 'NEEDS_ADMIN_ATTENTION',
};

const inflight = new Map();
const lifecycleLocks = new Map();
const MAX_CATCH_UP_STEPS = 32;
const LIFECYCLE_LOCK_TTL_MS = 90_000;

export const MONDAY_FANTASY_CRON = {
  path: '/api/settings?cron=fantasy-monday',
  schedule: '0 12 * * 1',
  timezone: 'UTC',
  query: { cron: 'fantasy-monday' },
  easternNote:
    'Monday 12:00 UTC is 8:00 AM America/New_York during EDT and 7:00 AM during EST.',
};

export function isMondayFantasyCronRequest(req) {
  return String(req?.query?.cron || '').trim() === MONDAY_FANTASY_CRON.query.cron;
}

export function isFantasyAutomationEnabled(settings = {}) {
  const lifecycle = mergeFantasyLifecycle(settings.fantasyLifecycle);
  if (settings.fantasyAutomationEnabled === false) return false;
  return lifecycle.automationEnabled !== false;
}

export function parseSlateMeta(row) {
  const meta = row?.meta;
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta) || {};
    } catch {
      return {};
    }
  }
  return meta && typeof meta === 'object' ? meta : {};
}

export function getSlateScoringMeta(slate) {
  return parseSlateMeta(slate)?.scoring || null;
}

export function isSlateFinalized(slate) {
  const meta = getSlateScoringMeta(slate);
  return (
    meta?.status === 'scored' &&
    !(meta.unresolvedDrivers || []).length
  );
}

export function isChampionshipFantasyRace(race) {
  if (!race) return false;
  if (race.nonPoints === true || race.isOpeningDuel === true) return false;
  return Number.isFinite(Number(race.officialPointsRaceNumber)) && Number(race.officialPointsRaceNumber) > 0;
}

export function listEligibleChampionshipRaces(scheduleRaces = []) {
  return (scheduleRaces || [])
    .filter((race) => isChampionshipFantasyRace(race))
    .sort((a, b) => Number(a.officialPointsRaceNumber) - Number(b.officialPointsRaceNumber));
}

export function getNextEligibleChampionshipRace(scheduleRaces, afterRaceNumber) {
  const after = Number(afterRaceNumber);
  const races = listEligibleChampionshipRaces(scheduleRaces);
  if (!Number.isFinite(after) || after < 1) return races[0] || null;
  return races.find((race) => Number(race.officialPointsRaceNumber) > after) || null;
}

export function findChampionshipRaceByNumber(scheduleRaces, raceNumber) {
  return getPointsRaceByNumber(scheduleRaces, Number(raceNumber));
}

export function isOpeningDuelLabel(label) {
  return /^1[A-Z]$/i.test(String(label || '').trim());
}

function extractScheduleId(raceOrSlate) {
  if (raceOrSlate?.schedule_id != null && String(raceOrSlate.schedule_id).trim()) {
    return String(raceOrSlate.schedule_id).trim();
  }
  if (raceOrSlate?.scheduleId != null && String(raceOrSlate.scheduleId).trim()) {
    return String(raceOrSlate.scheduleId).trim();
  }
  return extractScheduleIdFromRace(raceOrSlate);
}

function publishedSlatesByRace(slates = []) {
  return [...(slates || [])]
    .filter((row) => row && row.status === 'published')
    .sort((a, b) => Number(a.race_number) - Number(b.race_number));
}

export function resolveCurrentFantasyProgression(slates = []) {
  const published = publishedSlatesByRace(slates);
  if (!published.length) {
    return {
      currentSlate: null,
      latestFinalized: null,
      staleSlates: [],
      gap: null,
    };
  }

  const finalized = published.filter((row) => isSlateFinalized(row));
  const latestFinalized = finalized.length ? finalized[finalized.length - 1] : null;
  if (!latestFinalized) {
    return {
      currentSlate: published[0],
      latestFinalized: null,
      staleSlates: [],
      gap: null,
    };
  }

  const latestNum = Number(latestFinalized.race_number);
  const staleSlates = published.filter(
    (row) => !isSlateFinalized(row) && Number(row.race_number) < latestNum,
  );
  const laterPublished = published.filter((row) => Number(row.race_number) > latestNum);
  if (!laterPublished.length) {
    return {
      currentSlate: latestFinalized,
      latestFinalized,
      staleSlates,
      gap: null,
    };
  }

  const nextPublished = laterPublished[0];
  const expectedNext = latestNum + 1;
  if (Number(nextPublished.race_number) !== expectedNext) {
    return {
      currentSlate: latestFinalized,
      latestFinalized,
      staleSlates,
      gap: {
        afterRaceNumber: latestNum,
        expectedRaceNumber: expectedNext,
        foundRaceNumber: Number(nextPublished.race_number),
      },
    };
  }

  return {
    currentSlate: nextPublished,
    latestFinalized,
    staleSlates,
    gap: null,
  };
}

export function selectCurrentPublishedSlate(slates = []) {
  return resolveCurrentFantasyProgression(slates).currentSlate;
}

export function selectNextPublishedSlate(slates, currentRaceNumber) {
  const current = Number(currentRaceNumber);
  if (!Number.isFinite(current)) return null;
  return (
    publishedSlatesByRace(slates).find((row) => Number(row.race_number) > current) || null
  );
}

export function slateLockState(slate, now = new Date()) {
  const lockAt = slate?.lock_at || null;
  const display = getLockDisplayState(lockAt, now);
  return {
    lockAt,
    lockTime: slate?.lock_time || null,
    isLocked: Boolean(display.isLocked),
    hoursUntil: display.hoursUntil,
    displayState: display.state,
  };
}

/**
 * Cheap local/database gate. Must not require schedule HTML or SRH results.
 * Returns whether the orchestrator might need to mutate or fetch official results.
 */
export function cheapLifecycleDecision({
  automationEnabled = true,
  forcedByAdmin = false,
  publishedSlates = [],
  now = new Date(),
  persistedLifecycle = null,
} = {}) {
  const progression = resolveCurrentFantasyProgression(publishedSlates);
  if (!automationEnabled && !forcedByAdmin) {
    return {
      mayNeedWork: false,
      mayFetchAuthoritativeResults: false,
      mayFetchSchedule: false,
      reason: 'automation_disabled',
      currentSlate: progression.currentSlate,
      latestFinalized: progression.latestFinalized,
      staleSlates: progression.staleSlates,
      gap: progression.gap,
    };
  }

  if (progression.gap) {
    return {
      mayNeedWork: true,
      mayFetchAuthoritativeResults: false,
      mayFetchSchedule: true,
      reason: 'historical_gap',
      currentSlate: progression.currentSlate,
      latestFinalized: progression.latestFinalized,
      staleSlates: progression.staleSlates,
      gap: progression.gap,
    };
  }

  const currentSlate = progression.currentSlate;
  if (!currentSlate) {
    const complete =
      persistedLifecycle?.currentState === LIFECYCLE_STATES.SEASON_COMPLETE &&
      persistedLifecycle?.scoringFinalized === true;
    return {
      mayNeedWork: !complete,
      mayFetchAuthoritativeResults: false,
      mayFetchSchedule: !complete,
      reason: complete ? 'season_complete' : 'no_published_slate',
      currentSlate: null,
      latestFinalized: progression.latestFinalized,
      staleSlates: progression.staleSlates,
      gap: null,
    };
  }

  if (!isSlateFinalized(currentSlate)) {
    const lock = slateLockState(currentSlate, now);
    if (lock.lockAt && !lock.isLocked) {
      return {
        mayNeedWork: false,
        mayFetchAuthoritativeResults: false,
        mayFetchSchedule: false,
        reason: 'current_week_open',
        currentSlate,
        latestFinalized: progression.latestFinalized,
        staleSlates: progression.staleSlates,
        gap: null,
      };
    }
    return {
      mayNeedWork: true,
      mayFetchAuthoritativeResults: false,
      mayFetchSchedule: true,
      reason: lock.isLocked ? 'current_week_locked' : 'current_week_unfinalized',
      currentSlate,
      latestFinalized: progression.latestFinalized,
      staleSlates: progression.staleSlates,
      gap: null,
    };
  }

  const nextSlate = selectNextPublishedSlate(publishedSlates, currentSlate.race_number);
  if (nextSlate) {
    const nextLock = slateLockState(nextSlate, now);
    if (!isSlateFinalized(nextSlate) && nextLock.lockAt && !nextLock.isLocked) {
      return {
        mayNeedWork: false,
        mayFetchAuthoritativeResults: false,
        mayFetchSchedule: false,
        reason: 'next_week_already_open',
        currentSlate,
        nextSlate,
        latestFinalized: progression.latestFinalized,
        staleSlates: progression.staleSlates,
        gap: null,
      };
    }
    if (!isSlateFinalized(nextSlate)) {
      return {
        mayNeedWork: true,
        mayFetchAuthoritativeResults: false,
        mayFetchSchedule: true,
        reason: 'next_week_unfinalized',
        currentSlate,
        nextSlate,
        latestFinalized: progression.latestFinalized,
        staleSlates: progression.staleSlates,
        gap: null,
      };
    }
  }

  if (
    persistedLifecycle?.currentState === LIFECYCLE_STATES.SEASON_COMPLETE &&
    persistedLifecycle?.scoringFinalized === true
  ) {
    return {
      mayNeedWork: false,
      mayFetchAuthoritativeResults: false,
      mayFetchSchedule: false,
      reason: 'season_complete',
      currentSlate,
      latestFinalized: progression.latestFinalized,
      staleSlates: progression.staleSlates,
      gap: null,
    };
  }

  return {
    mayNeedWork: true,
    mayFetchAuthoritativeResults: false,
    mayFetchSchedule: true,
    reason: nextSlate ? 'catch_up_possible' : 'may_need_next_week',
    currentSlate,
    nextSlate,
    latestFinalized: progression.latestFinalized,
    staleSlates: progression.staleSlates,
    gap: null,
  };
}

export function shouldFetchOfficialResults(race) {
  return Boolean(race && hasRaceResults(race));
}

export function buildNextAction(snapshot = {}) {
  const state = snapshot.state;
  const track = snapshot.currentWeek?.track || snapshot.currentWeek?.raceLabel || 'this race';
  if (!snapshot.automationEnabled && !snapshot.forcedByAdmin) {
    return { code: 'MANUAL_MODE', label: 'Automation paused — Manual mode.' };
  }
  switch (state) {
    case LIFECYCLE_STATES.OPEN:
    case LIFECYCLE_STATES.NEXT_WEEK_READY:
      if (snapshot.justAdvanced) {
        return {
          code: 'ADVANCED',
          label: `${snapshot.finalizedLabel || 'Previous race'} finalized. ${snapshot.currentWeek?.raceLabel || 'Next race'} is open.`,
        };
      }
      return { code: 'CURRENT', label: 'No action needed — fantasy is current.' };
    case LIFECYCLE_STATES.LOCKED:
      return {
        code: 'LOCKED',
        label: `Fantasy entries are locked. Waiting for official ${track} results.`,
      };
    case LIFECYCLE_STATES.WAITING_FOR_RESULTS:
      return {
        code: 'WAITING_FOR_RESULTS',
        label: `Waiting for official ${track} results.`,
      };
    case LIFECYCLE_STATES.READY_TO_SCORE:
      return {
        code: 'READY_TO_SCORE',
        label: 'Results available — automatic scoring pending.',
      };
    case LIFECYCLE_STATES.SCORING:
      return { code: 'SCORING', label: 'Scoring the completed fantasy week…' };
    case LIFECYCLE_STATES.NEEDS_REVIEW:
      return {
        code: 'WAITING_FOR_FINAL_SCORING_DATA',
        label: 'Waiting for final scoring data.',
      };
    case LIFECYCLE_STATES.FINALIZED:
    case LIFECYCLE_STATES.ADVANCING:
      return {
        code: 'ADVANCING',
        label: `${snapshot.currentWeek?.raceLabel || 'Race'} finalized. Preparing the next fantasy week.`,
      };
    case LIFECYCLE_STATES.SEASON_COMPLETE:
      return { code: 'SEASON_COMPLETE', label: 'Season complete — no next fantasy week.' };
    case LIFECYCLE_STATES.UPCOMING:
      return { code: 'UPCOMING', label: 'Next fantasy week is being prepared.' };
    case LIFECYCLE_STATES.NEEDS_ADMIN_ATTENTION:
      return {
        code: snapshot.failure?.code || 'NEEDS_ADMIN_ATTENTION',
        label: snapshot.failure?.message || 'Needs admin attention.',
      };
    default:
      return { code: 'CURRENT', label: 'No action needed — fantasy is current.' };
  }
}

export function buildWeekView(slate, race, extras = {}) {
  const raceNumber = slate?.race_number ?? race?.officialPointsRaceNumber ?? null;
  const track = slate?.track || race?.track || null;
  const raceLabel = raceNumber != null ? `Race ${raceNumber}${track ? ` — ${track}` : ''}` : track || '—';
  return {
    raceNumber,
    track,
    date: race?.date || extras.date || null,
    scheduleId: extractScheduleId(slate) || extractScheduleId(race),
    raceLabel,
    slateId: slate?.id ?? null,
    status: extras.status || null,
    entries: extras.entries ?? null,
    lockAt: slate?.lock_at || null,
    lockTime: slate?.lock_time || null,
    lockStatus: extras.lockStatus || null,
    resultsStatus: extras.resultsStatus || null,
    scoringStatus: extras.scoringStatus || null,
    finalized: extras.finalized === true,
  };
}

function scoringMetaStatus(slate, scoringStatus) {
  if (scoringStatus?.status) return scoringStatus.status;
  return getSlateScoringMeta(slate)?.status || null;
}

export async function createFantasyLifecycleDeps(overrides = {}) {
  const {
    generateFantasyDraftSlate,
    publishFantasySlate,
    loadFantasyDraftSlate,
  } = await import('./_fantasy-slate.js');
  const { getFantasyRaceScoringStatus, scoreFantasySlate } = await import(
    './_fantasy-race-scoring.js'
  );
  const { countLineupsForSlate } = await import('./_fantasy-lineups.js');

  const deps = {
    now: () => new Date(),
    getSettings,
    supabase,
    loadSchedule: async (options = {}) => {
      const ctx = await loadFantasyScheduleContext(options);
      return ctx.scheduleRaces || [];
    },
    listPublishedSlates: async (seasonId) => {
      const sb = supabase();
      if (!sb) return [];
      const { data, error } = await sb
        .from('fantasy_slates')
        .select('*')
        .eq('season_id', String(seasonId))
        .eq('status', 'published')
        .order('race_number', { ascending: true });
      if (error || !data) return [];
      return data.filter((row) => !parseSlateMeta(row)?.backfilled);
    },
    countLineups: async (slateId) => countLineupsForSlate(slateId),
    getScoringStatus: async (options) => getFantasyRaceScoringStatus(options),
    scoreSlate: async (options) => scoreFantasySlate(options),
    generateDraft: async (options) =>
      generateFantasyDraftSlate({
        ...options,
        preferExistingDraft: options.preferExistingDraft !== false,
      }),
    publishSlate: async (options) => publishFantasySlate(options),
    loadDraft: async (seasonId, raceNumber) => loadFantasyDraftSlate(seasonId, raceNumber),
    persistLifecycle: async (patch, settings) => {
      const latest = typeof getSettings === 'function' ? await getSettings() : settings;
      const next = {
        ...mergeFantasyLifecycle(latest?.fantasyLifecycle || settings?.fantasyLifecycle),
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      const sb = supabase();
      if (!sb) return next;
      const { error } = await sb
        .from('site_settings')
        .update({ fantasyLifecycle: next })
        .eq('id', 1);
      if (error) {
        next.persistError = error.message || 'fantasy_lifecycle_persist_failed';
      }
      return next;
    },
    invalidateCaches: async ({ seasonId, scheduleUrl } = {}) => {
      const { invalidateOfficialResultsCaches } = await import('./_fantasy-srh-cache.js');
      invalidateOfficialResultsCaches({ seasonId, scheduleUrl });
    },
    loadOfficialResults: async (options) => {
      const { loadOfficialRaceResultsContext } = await import('./_fantasy-race-scoring.js');
      return loadOfficialRaceResultsContext(options);
    },
    ...overrides,
  };
  return deps;
}

async function resolveDeps(overrides) {
  if (overrides && Object.keys(overrides).length && overrides.listPublishedSlates) {
    return {
      now: () => new Date(),
      getSettings,
      supabase,
      persistLifecycle: async (patch, settings) => ({
        ...mergeFantasyLifecycle(settings?.fantasyLifecycle),
        ...patch,
      }),
      ...overrides,
    };
  }
  return createFantasyLifecycleDeps(overrides);
}

function attention(code, message, details = null) {
  return {
    state: LIFECYCLE_STATES.NEEDS_ADMIN_ATTENTION,
    failure: { code, message, details },
  };
}

async function inspectLifecycle(options, deps, publishedSlates, cheap) {
  const settings = options.settings;
  const now = options.now || deps.now();
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  let scheduleRaces = options.scheduleRaces || null;
  let scheduleFetched = false;

  if (cheap.mayFetchSchedule && typeof deps.loadSchedule === 'function') {
    scheduleRaces = await deps.loadSchedule({ settings, now, scheduleRaces: options.scheduleRaces });
    scheduleFetched = true;
  }

  const progression = resolveCurrentFantasyProgression(publishedSlates);
  const currentSlate = cheap.currentSlate || progression.currentSlate;
  const currentRaceNumber = currentSlate?.race_number ?? null;
  const currentRace = currentRaceNumber != null
    ? findChampionshipRaceByNumber(scheduleRaces || [], currentRaceNumber)
    : null;
  const nextEligible = currentRaceNumber != null
    ? getNextEligibleChampionshipRace(scheduleRaces || [], currentRaceNumber)
    : getNextEligibleChampionshipRace(scheduleRaces || [], 0);
  const nextPublished = currentRaceNumber != null
    ? selectNextPublishedSlate(publishedSlates, currentRaceNumber)
    : null;

  const lock = currentSlate ? slateLockState(currentSlate, now) : null;
  const entries = currentSlate?.id != null && deps.countLineups
    ? await deps.countLineups(currentSlate.id)
    : 0;

  let scoringStatus = null;
  let officialResultsFetched = false;
  const raceComplete = Boolean(currentRace && hasRaceResults(currentRace));

  if (currentSlate && raceComplete && typeof deps.getScoringStatus === 'function') {
    scoringStatus = await deps.getScoringStatus({
      seasonId,
      settings,
      raceNumber: currentRaceNumber,
    });
    officialResultsFetched = true;
  }

  const finalized = currentSlate ? isSlateFinalized(currentSlate) : false;
  const resultsReady = Boolean(scoringStatus?.resultsReady);
  const unresolved = scoringStatus?.unresolvedDrivers || getSlateScoringMeta(currentSlate)?.unresolvedDrivers || [];

  let state = LIFECYCLE_STATES.UPCOMING;
  let failure = null;
  const gap = cheap.gap || progression.gap;

  if (gap) {
    ({ state, failure } = attention(
      FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
      `Race ${gap.expectedRaceNumber} is missing from fantasy history while Race ${gap.foundRaceNumber} exists. Historical entries cannot be reconstructed.`,
      gap,
    ));
  } else if (!currentSlate) {
    if (!scheduleFetched && !scheduleRaces) {
      state = LIFECYCLE_STATES.UPCOMING;
    } else if (!nextEligible) {
      ({ state, failure } = attention(
        FAILURE_CODES.NEXT_RACE_NOT_FOUND,
        'NEXT RACE NOT FOUND — no eligible championship race is available to open.',
      ));
    } else if (hasRaceResults(nextEligible)) {
      ({ state, failure } = attention(
        FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
        `Race ${nextEligible.officialPointsRaceNumber} already has official results but no fantasy week exists. Historical entries cannot be reconstructed.`,
        { raceNumber: nextEligible.officialPointsRaceNumber, scheduleId: extractScheduleId(nextEligible) },
      ));
    } else {
      state = LIFECYCLE_STATES.UPCOMING;
    }
  } else if (currentRace && !isChampionshipFantasyRace(currentRace)) {
    ({ state, failure } = attention(
      FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
      `Fantasy week ${currentRaceNumber} is attached to a non-championship event and needs admin attention.`,
      { raceNumber: currentRaceNumber, displayRaceLabel: currentRace.displayRaceLabel || null },
    ));
  } else if (!finalized && !raceComplete) {
    state = lock?.isLocked ? LIFECYCLE_STATES.WAITING_FOR_RESULTS : LIFECYCLE_STATES.OPEN;
  } else if (!finalized && raceComplete && !resultsReady) {
    state = LIFECYCLE_STATES.WAITING_FOR_RESULTS;
    failure = {
      code: FAILURE_CODES.WAITING_FOR_RESULTS,
      message: scoringStatus?.resultsReason || 'Official race results are not available yet.',
      details: { raceNumber: currentRaceNumber },
    };
  } else if (!finalized && resultsReady && scoringStatus?.status === 'needs_review') {
    state = LIFECYCLE_STATES.NEEDS_REVIEW;
    failure = {
      code: FAILURE_CODES.WAITING_FOR_FINAL_SCORING_DATA,
      message: 'WAITING FOR FINAL SCORING DATA — unresolved drivers need review before advancement.',
      details: { unresolvedDrivers: unresolved },
    };
  } else if (!finalized && (resultsReady || scoringStatus?.status === 'ready')) {
    state = LIFECYCLE_STATES.READY_TO_SCORE;
  } else if (finalized && unresolved.length) {
    state = LIFECYCLE_STATES.NEEDS_REVIEW;
    failure = {
      code: FAILURE_CODES.WAITING_FOR_FINAL_SCORING_DATA,
      message: 'WAITING FOR FINAL SCORING DATA — unresolved drivers remain after scoring.',
      details: { unresolvedDrivers: unresolved },
    };
  } else if (finalized) {
    if (!nextEligible) {
      state = LIFECYCLE_STATES.SEASON_COMPLETE;
    } else if (nextPublished && Number(nextPublished.race_number) === Number(nextEligible.officialPointsRaceNumber)) {
      const nextRace = findChampionshipRaceByNumber(scheduleRaces || [], nextPublished.race_number);
      const nextLock = slateLockState(nextPublished, now);
      if (nextRace && hasRaceResults(nextRace) && !isSlateFinalized(nextPublished)) {
        state = LIFECYCLE_STATES.READY_TO_SCORE;
      } else if (isSlateFinalized(nextPublished)) {
        state = LIFECYCLE_STATES.FINALIZED;
      } else {
        state = nextLock.isLocked ? LIFECYCLE_STATES.LOCKED : LIFECYCLE_STATES.NEXT_WEEK_READY;
      }
    } else if (nextPublished && Number(nextPublished.race_number) !== Number(nextEligible.officialPointsRaceNumber)) {
      ({ state, failure } = attention(
        FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
        `Next published fantasy week is Race ${nextPublished.race_number}, but the next eligible championship race is Race ${nextEligible.officialPointsRaceNumber}.`,
        {
          publishedNextRaceNumber: nextPublished.race_number,
          eligibleNextRaceNumber: nextEligible.officialPointsRaceNumber,
        },
      ));
    } else if (hasRaceResults(nextEligible)) {
      ({ state, failure } = attention(
        FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
        `Race ${nextEligible.officialPointsRaceNumber} already has official results but no fantasy week exists. Historical entries cannot be reconstructed.`,
        { raceNumber: nextEligible.officialPointsRaceNumber, scheduleId: extractScheduleId(nextEligible) },
      ));
    } else {
      state = LIFECYCLE_STATES.FINALIZED;
    }
  }

  const displaySlate =
    state === LIFECYCLE_STATES.NEXT_WEEK_READY || state === LIFECYCLE_STATES.LOCKED
      ? nextPublished || currentSlate
      : currentSlate;
  const displayRace =
    displaySlate && displaySlate !== currentSlate
      ? findChampionshipRaceByNumber(scheduleRaces || [], displaySlate.race_number)
      : currentRace;
  const displayLock = displaySlate ? slateLockState(displaySlate, now) : lock;
  const displayEntries =
    displaySlate && displaySlate !== currentSlate && deps.countLineups
      ? await deps.countLineups(displaySlate.id)
      : entries;
  const displayFinalized = displaySlate ? isSlateFinalized(displaySlate) : finalized;

  const currentWeek = buildWeekView(displaySlate, displayRace, {
    status: state,
    entries: displayEntries,
    lockStatus: displayLock?.isLocked ? 'Locked' : displayLock?.lockAt ? 'Open' : 'Not set',
    resultsStatus: displayRace
      ? hasRaceResults(displayRace)
        ? resultsReady || displayFinalized
          ? 'Official results available'
          : 'Results listed — scoring data pending'
        : 'Waiting for official results'
      : 'Unknown',
    scoringStatus: displayFinalized
      ? 'Finalized'
      : scoringMetaStatus(displaySlate, scoringStatus) || 'Not scored',
    finalized: displayFinalized,
  });

  const nextWeekRace =
    state === LIFECYCLE_STATES.NEXT_WEEK_READY || state === LIFECYCLE_STATES.LOCKED
      ? null
      : nextEligible;
  const nextWeekSlate = nextPublished && nextEligible && Number(nextPublished.race_number) === Number(nextEligible.officialPointsRaceNumber)
    ? nextPublished
    : null;

  const snapshot = {
    seasonId,
    automationEnabled: isFantasyAutomationEnabled(settings),
    forcedByAdmin: options.forcedByAdmin === true,
    state,
    currentWeek,
    nextWeek: nextWeekRace
      ? buildWeekView(nextWeekSlate, nextWeekRace, {
          status: nextWeekSlate
            ? isSlateFinalized(nextWeekSlate)
              ? LIFECYCLE_STATES.FINALIZED
              : LIFECYCLE_STATES.OPEN
            : LIFECYCLE_STATES.UPCOMING,
          finalized: nextWeekSlate ? isSlateFinalized(nextWeekSlate) : false,
        })
      : null,
    currentSlate,
    nextPublished,
    nextEligible,
    currentRace,
    scoringStatus,
    entries,
    raceComplete,
    resultsReady,
    finalized,
    failure,
    scheduleFetched,
    officialResultsFetched,
    cheapReason: cheap.reason,
    lastAutomation: mergeFantasyLifecycle(settings.fantasyLifecycle).lastAutomation || null,
    latestFinalized: cheap.latestFinalized || progression.latestFinalized,
    staleSlates: cheap.staleSlates || progression.staleSlates,
    gap: cheap.gap || progression.gap,
  };
  snapshot.nextAction = buildNextAction(snapshot);
  return snapshot;
}

async function scoreCurrentWeek(snapshot, options, deps) {
  const raceNumber = snapshot.currentSlate?.race_number;
  if (raceNumber == null) {
    return {
      mutated: false,
      ...attention(FAILURE_CODES.SCORING_FAILED, 'SCORING FAILED — no current fantasy week to score.'),
    };
  }
  if (isSlateFinalized(snapshot.currentSlate)) {
    return { mutated: false, skipped: true, reason: 'already_scored' };
  }
  const latestFinalizedNumber = Number(snapshot.latestFinalized?.race_number);
  if (
    Number.isFinite(latestFinalizedNumber) &&
    Number(raceNumber) < latestFinalizedNumber
  ) {
    return { mutated: false, skipped: true, reason: 'stale_historical_week', raceNumber };
  }
  try {
    const scored = await deps.scoreSlate({
      seasonId: snapshot.seasonId,
      settings: options.settings,
      raceNumber,
      source: options.forcedByAdmin ? 'admin_lifecycle' : 'auto_lifecycle',
    });
    if (scored?.status === 'needs_review' || (scored?.unresolvedDrivers || []).length) {
      return {
        mutated: true,
        scored: true,
        ...attention(
          FAILURE_CODES.WAITING_FOR_FINAL_SCORING_DATA,
          'WAITING FOR FINAL SCORING DATA — scoring needs review before the next week can open.',
          { unresolvedDrivers: scored.unresolvedDrivers || [] },
        ),
        action: 'scored_needs_review',
        raceNumber,
      };
    }
    if (scored?.status && scored.status !== 'scored') {
      return {
        mutated: true,
        scored: false,
        ...attention(
          FAILURE_CODES.SCORING_FAILED,
          `SCORING FAILED — scoring returned status ${scored.status}.`,
          { status: scored.status },
        ),
        action: 'scoring_failed',
        raceNumber,
      };
    }
    return {
      mutated: true,
      scored: true,
      action: 'finalized',
      raceNumber,
      state: LIFECYCLE_STATES.FINALIZED,
    };
  } catch (error) {
    return {
      mutated: false,
      scored: false,
      ...attention(
        FAILURE_CODES.SCORING_FAILED,
        `SCORING FAILED — ${error.message || 'fantasy scoring failed.'}`,
        { error: error.message || 'score_failed' },
      ),
      action: 'scoring_failed',
      raceNumber,
    };
  }
}

async function advanceToNextWeek(snapshot, options, deps) {
  const nextRace = snapshot.nextEligible;
  if (!nextRace) {
    return {
      mutated: false,
      action: 'season_complete',
      state: LIFECYCLE_STATES.SEASON_COMPLETE,
    };
  }
  if (!isChampionshipFantasyRace(nextRace)) {
    return {
      mutated: false,
      ...attention(
        FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
        'NEXT RACE NOT FOUND — the next schedule event is not an eligible championship fantasy race.',
        { displayRaceLabel: nextRace.displayRaceLabel || null },
      ),
    };
  }
  if (hasRaceResults(nextRace)) {
    return {
      mutated: false,
      ...attention(
        FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
        `Race ${nextRace.officialPointsRaceNumber} already has official results but no fantasy week exists. Historical entries cannot be reconstructed.`,
        { raceNumber: nextRace.officialPointsRaceNumber, scheduleId: extractScheduleId(nextRace) },
      ),
    };
  }

  const nextRaceNumber = Number(nextRace.officialPointsRaceNumber);
  if (snapshot.nextPublished && Number(snapshot.nextPublished.race_number) === nextRaceNumber) {
    return { mutated: false, skipped: true, reason: 'next_week_already_published', raceNumber: nextRaceNumber };
  }

  let draft;
  try {
    draft = await deps.generateDraft({
      raceNumber: nextRaceNumber,
      preferExistingDraft: true,
    });
  } catch (error) {
    return {
      mutated: false,
      ...attention(
        FAILURE_CODES.DRIVER_POOL_ERROR,
        `DRIVER POOL ERROR — ${error.message || 'the next fantasy driver pool could not be created.'}`,
        { error: error.message || 'driver_pool_failed', raceNumber: nextRaceNumber },
      ),
      action: 'driver_pool_failed',
      raceNumber: nextRaceNumber,
    };
  }

  const driverCount = Array.isArray(draft?.drivers) ? draft.drivers.length : 0;
  if (!draft?.slate?.id || driverCount < 1) {
    return {
      mutated: false,
      ...attention(
        FAILURE_CODES.DRIVER_POOL_ERROR,
        'DRIVER POOL ERROR — the next fantasy week was not marked ready because the driver pool is empty.',
        { raceNumber: nextRaceNumber, slateId: draft?.slate?.id || null },
      ),
      action: 'driver_pool_failed',
      raceNumber: nextRaceNumber,
    };
  }

  if (draft.slate.status === 'published') {
    return {
      mutated: false,
      skipped: true,
      reason: 'next_week_already_published',
      raceNumber: nextRaceNumber,
      slateId: draft.slate.id,
    };
  }

  try {
    const published = await deps.publishSlate({
      seasonId: snapshot.seasonId,
      slateId: draft.slate.id,
      raceNumber: nextRaceNumber,
    });
    return {
      mutated: true,
      published: true,
      action: 'next_week_opened',
      raceNumber: nextRaceNumber,
      slateId: published?.slate?.id || draft.slate.id,
      state: LIFECYCLE_STATES.NEXT_WEEK_READY,
    };
  } catch (error) {
    return {
      mutated: true,
      published: false,
      ...attention(
        FAILURE_CODES.NEEDS_ADMIN_ATTENTION,
        `NEXT WEEK NOT READY — the driver pool was created but the week could not be opened. ${error.message || ''}`,
        { error: error.message || 'publish_failed', raceNumber: nextRaceNumber, slateId: draft.slate.id },
      ),
      action: 'publish_failed',
      raceNumber: nextRaceNumber,
    };
  }
}

export function triggerDisplayLabel(trigger) {
  switch (trigger) {
    case LIFECYCLE_TRIGGERS.RESULTS_UPDATE:
      return 'Triggered by results update';
    case LIFECYCLE_TRIGGERS.MONDAY_SAFETY:
      return 'Monday safety check';
    case LIFECYCLE_TRIGGERS.MANUAL:
      return 'Manual process';
    default:
      return trigger ? String(trigger) : null;
  }
}

function summarizeAction(actions = []) {
  if (!actions.length) return 'No fantasy lifecycle changes.';
  return actions
    .map((item) => {
      if (item.action === 'finalized') return `Race ${item.raceNumber} finalized`;
      if (item.action === 'next_week_opened') return `Race ${item.raceNumber} opened`;
      if (item.action === 'scored_needs_review') return `Race ${item.raceNumber} scored — needs review`;
      if (item.action === 'season_complete') return 'Season complete';
      return item.action || item.reason || 'lifecycle update';
    })
    .join(' · ');
}

export function buildLastAutomationRecord({
  now,
  trigger,
  actions = [],
  success = true,
  error = null,
  state = null,
  summary = null,
} = {}) {
  const actionSummary = summary || summarizeAction(actions);
  let outcome = 'SUCCESS';
  if (error || success === false) outcome = 'NEEDS ATTENTION';
  else if (!actions.length && (state === LIFECYCLE_STATES.WAITING_FOR_RESULTS || state === LIFECYCLE_STATES.OPEN || state === LIFECYCLE_STATES.LOCKED)) {
    outcome = 'NO ACTION';
  }
  return {
    at: (now || new Date()).toISOString(),
    trigger: trigger || null,
    triggerLabel: triggerDisplayLabel(trigger),
    success: success !== false && !error,
    error: error || null,
    summary: actionSummary,
    action: actionSummary,
    outcome,
  };
}

function progressionDiagnostics(progression = {}, raceNumber = null) {
  return {
    resolvedCurrentRaceNumber: raceNumber ?? progression.currentSlate?.race_number ?? null,
    latestFinalizedRaceNumber: progression.latestFinalized?.race_number ?? null,
    staleHistoricalRaceNumbers: (progression.staleSlates || []).map((row) => row.race_number),
  };
}

function buildAdminPayload(snapshot, extras = {}) {
  const persisted = extras.persisted || snapshot.lastAutomation || null;
  return {
    ok: snapshot.state !== LIFECYCLE_STATES.NEEDS_ADMIN_ATTENTION,
    automationEnabled: snapshot.automationEnabled,
    mode: snapshot.automationEnabled ? 'automatic' : 'manual',
    mutated: extras.mutated === true,
    writes: extras.writes || 0,
    state: extras.displayState || snapshot.state,
    currentWeek: snapshot.currentWeek,
    nextWeek: snapshot.nextWeek,
    nextAction: extras.nextAction || snapshot.nextAction,
    lastAutomation: persisted,
    failure: snapshot.failure,
    diagnostics: {
      cheapReason: snapshot.cheapReason,
      scheduleFetched: Boolean(snapshot.scheduleFetched || extras.scheduleFetched),
      officialResultsFetched: Boolean(snapshot.officialResultsFetched || extras.officialResultsFetched),
      currentScheduleId: snapshot.currentWeek?.scheduleId || null,
      nextScheduleId:
        snapshot.nextWeek?.scheduleId ||
        (snapshot.nextEligible ? extractScheduleId(snapshot.nextEligible) : null),
      currentRaceNumber: snapshot.currentWeek?.raceNumber ?? snapshot.currentSlate?.race_number ?? null,
      resolvedCurrentRaceNumber: snapshot.currentSlate?.race_number ?? null,
      latestFinalizedRaceNumber: snapshot.latestFinalized?.race_number ?? null,
      staleHistoricalRaceNumbers: (snapshot.staleSlates || []).map((row) => row.race_number),
      nextRaceNumber: snapshot.nextEligible?.officialPointsRaceNumber ?? null,
      resultsDetected: Boolean(snapshot.raceComplete && snapshot.resultsReady),
      scoringFinalized: Boolean(snapshot.finalized),
      actions: extras.actions || [],
      lastError: snapshot.failure || persisted?.error || null,
    },
  };
}

function lastAutomationFromRun(options, extras = {}) {
  return buildLastAutomationRecord({
    now: options.now,
    trigger: options.trigger,
    actions: extras.actions || [],
    success: extras.success,
    error: extras.error || null,
    state: extras.state || null,
    summary: extras.summary || null,
  });
}

async function runLifecycleInternal(options, deps) {
  const settings = options.settings || (await deps.getSettings());
  const now = options.now || deps.now();
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const automationEnabled = isFantasyAutomationEnabled(settings);
  const forcedByAdmin = options.forcedByAdmin === true;
  const inspectOnly = options.inspectOnly === true || (!automationEnabled && !forcedByAdmin);
  options.now = now;
  options.trigger = options.trigger || (forcedByAdmin ? LIFECYCLE_TRIGGERS.MANUAL : null);

  const publishedSlates = await deps.listPublishedSlates(seasonId);
  const cheap = cheapLifecycleDecision({
    automationEnabled,
    forcedByAdmin,
    publishedSlates,
    now,
    persistedLifecycle: mergeFantasyLifecycle(settings.fantasyLifecycle),
  });

  if (inspectOnly) {
    const snapshot = await inspectLifecycle(
      { ...options, settings, now, seasonId },
      deps,
      publishedSlates,
      {
        ...cheap,
        mayFetchSchedule: true,
        mayFetchAuthoritativeResults: false,
      },
    );
    snapshot.automationEnabled = automationEnabled;
    snapshot.forcedByAdmin = forcedByAdmin;
    snapshot.nextAction = buildNextAction(snapshot);
    return buildAdminPayload(snapshot, { mutated: false, writes: 0 });
  }

  if (!cheap.mayNeedWork && !forcedByAdmin) {
    const snapshot = await inspectLifecycle(
      { ...options, settings, now, seasonId },
      deps,
      publishedSlates,
      {
        ...cheap,
        mayFetchSchedule: false,
        mayFetchAuthoritativeResults: false,
      },
    );
    snapshot.automationEnabled = automationEnabled;
    snapshot.nextAction = buildNextAction(snapshot);
    return buildAdminPayload(snapshot, { mutated: false, writes: 0 });
  }

  const actions = [];
  let writes = 0;
  let lastFailure = null;
  let officialResultsFetched = false;
  let scheduleFetched = false;
  let justAdvanced = false;
  let finalizedLabel = null;

  for (let step = 0; step < MAX_CATCH_UP_STEPS; step += 1) {
    const slates = step === 0 ? publishedSlates : await deps.listPublishedSlates(seasonId);
    const stepCheap = cheapLifecycleDecision({
      automationEnabled: true,
      forcedByAdmin,
      publishedSlates: slates,
      now,
      persistedLifecycle: mergeFantasyLifecycle(settings.fantasyLifecycle),
    });
    const snapshot = await inspectLifecycle(
      { ...options, settings, now, seasonId },
      deps,
      slates,
      {
        ...stepCheap,
        mayFetchSchedule: true,
      },
    );
    scheduleFetched = scheduleFetched || snapshot.scheduleFetched;
    officialResultsFetched = officialResultsFetched || snapshot.officialResultsFetched;

    if (snapshot.state === LIFECYCLE_STATES.NEEDS_ADMIN_ATTENTION) {
      lastFailure = snapshot.failure;
      const persisted = writes
        ? await deps.persistLifecycle(
            {
              automationEnabled,
              currentState: snapshot.state,
              currentScheduleId: snapshot.currentWeek?.scheduleId || null,
              currentRaceNumber: snapshot.currentWeek?.raceNumber ?? null,
              nextScheduleId: snapshot.nextEligible ? extractScheduleId(snapshot.nextEligible) : null,
              resultsDetected: Boolean(snapshot.resultsReady),
              scoringFinalized: Boolean(snapshot.finalized),
              lastError: snapshot.failure,
              lastAutomation: lastAutomationFromRun(options, {
                actions,
                success: false,
                error: snapshot.failure,
                state: snapshot.state,
                summary: snapshot.failure?.message,
              }),
            },
            settings,
          )
        : mergeFantasyLifecycle(settings.fantasyLifecycle);
      snapshot.nextAction = buildNextAction(snapshot);
      return buildAdminPayload(snapshot, {
        mutated: writes > 0,
        writes,
        actions,
        persisted: persisted.lastAutomation || persisted,
        officialResultsFetched,
        scheduleFetched,
      });
    }

    if (snapshot.state === LIFECYCLE_STATES.READY_TO_SCORE) {
      const result = await scoreCurrentWeek(snapshot, { ...options, settings }, deps);
      officialResultsFetched = true;
      if (result.failure) lastFailure = result.failure;
      if (result.mutated) {
        writes += 1;
        actions.push(result);
        if (result.action === 'finalized') {
          finalizedLabel = `Race ${result.raceNumber}`;
        }
      }
      if (!result.scored || result.failure) {
        const inspectAfter = await inspectLifecycle(
          { ...options, settings, now, seasonId },
          deps,
          await deps.listPublishedSlates(seasonId),
          { mayFetchSchedule: true, currentSlate: snapshot.currentSlate },
        );
        inspectAfter.failure = result.failure || inspectAfter.failure;
        inspectAfter.state = result.state || inspectAfter.state;
        const persisted = await deps.persistLifecycle(
          {
            automationEnabled,
            currentState: inspectAfter.state,
            currentScheduleId: inspectAfter.currentWeek?.scheduleId || null,
            currentRaceNumber: inspectAfter.currentWeek?.raceNumber ?? null,
            lastError: result.failure,
            lastAutomation: lastAutomationFromRun(options, {
              actions,
              success: false,
              error: result.failure,
              state: inspectAfter.state,
              summary: result.failure?.message || summarizeAction(actions),
            }),
          },
          settings,
        );
        inspectAfter.nextAction = buildNextAction(inspectAfter);
        return buildAdminPayload(inspectAfter, {
          mutated: writes > 0,
          writes,
          actions,
          persisted: persisted.lastAutomation || persisted,
          officialResultsFetched,
          scheduleFetched,
        });
      }
      continue;
    }

    if (snapshot.state === LIFECYCLE_STATES.FINALIZED || snapshot.state === LIFECYCLE_STATES.UPCOMING) {
      const result = await advanceToNextWeek(snapshot, { ...options, settings }, deps);
      if (result.failure) lastFailure = result.failure;
      if (result.mutated) {
        writes += 1;
        actions.push(result);
        justAdvanced = result.published === true;
      } else if (result.skipped) {
        break;
      }
      if (result.failure || result.state === LIFECYCLE_STATES.SEASON_COMPLETE) {
        const inspectAfter = await inspectLifecycle(
          { ...options, settings, now, seasonId },
          deps,
          await deps.listPublishedSlates(seasonId),
          { mayFetchSchedule: true, currentSlate: selectCurrentPublishedSlate(await deps.listPublishedSlates(seasonId)) },
        );
        inspectAfter.failure = result.failure || inspectAfter.failure;
        if (result.state === LIFECYCLE_STATES.SEASON_COMPLETE) {
          inspectAfter.state = LIFECYCLE_STATES.SEASON_COMPLETE;
        }
        const alreadyComplete =
          mergeFantasyLifecycle(settings.fantasyLifecycle).currentState ===
          LIFECYCLE_STATES.SEASON_COMPLETE;
        const shouldPersist =
          writes > 0 || (result.state === LIFECYCLE_STATES.SEASON_COMPLETE && !alreadyComplete);
        const persisted = shouldPersist
          ? await deps.persistLifecycle(
              {
                automationEnabled,
                currentState: inspectAfter.state,
                currentScheduleId: inspectAfter.currentWeek?.scheduleId || null,
                currentRaceNumber: inspectAfter.currentWeek?.raceNumber ?? null,
                nextScheduleId: inspectAfter.nextEligible ? extractScheduleId(inspectAfter.nextEligible) : null,
                resultsDetected: Boolean(inspectAfter.resultsReady),
                scoringFinalized: Boolean(inspectAfter.finalized),
                lastError: result.failure || null,
                lastAutomation: lastAutomationFromRun(options, {
                  actions: actions.concat(result.action ? [result] : []),
                  success: !result.failure,
                  error: result.failure || null,
                  state: inspectAfter.state,
                  summary: result.failure?.message || summarizeAction(actions.concat(result.action ? [result] : [])),
                }),
              },
              settings,
            )
          : mergeFantasyLifecycle(settings.fantasyLifecycle);
        inspectAfter.justAdvanced = justAdvanced;
        inspectAfter.finalizedLabel = finalizedLabel;
        inspectAfter.nextAction = buildNextAction(inspectAfter);
        return buildAdminPayload(inspectAfter, {
          mutated: writes > 0,
          writes,
          actions,
          persisted: persisted.lastAutomation || persisted,
          officialResultsFetched,
          scheduleFetched,
        });
      }
      continue;
    }

    if (
      snapshot.state === LIFECYCLE_STATES.OPEN ||
      snapshot.state === LIFECYCLE_STATES.LOCKED ||
      snapshot.state === LIFECYCLE_STATES.WAITING_FOR_RESULTS ||
      snapshot.state === LIFECYCLE_STATES.NEXT_WEEK_READY ||
      snapshot.state === LIFECYCLE_STATES.SEASON_COMPLETE ||
      snapshot.state === LIFECYCLE_STATES.NEEDS_REVIEW
    ) {
      if (writes > 0) {
        const persisted = await deps.persistLifecycle(
          {
            automationEnabled,
            currentState: snapshot.state,
            currentScheduleId: snapshot.currentWeek?.scheduleId || null,
            currentRaceNumber: snapshot.currentWeek?.raceNumber ?? null,
            nextScheduleId: snapshot.nextEligible ? extractScheduleId(snapshot.nextEligible) : null,
            resultsDetected: Boolean(snapshot.resultsReady),
            scoringFinalized: Boolean(snapshot.finalized),
            lastError: lastFailure,
            lastAutomation: lastAutomationFromRun(options, {
              actions,
              success: !lastFailure,
              error: lastFailure,
              state: snapshot.state,
            }),
          },
          settings,
        );
        snapshot.justAdvanced = justAdvanced;
        snapshot.finalizedLabel = finalizedLabel;
        snapshot.nextAction = buildNextAction(snapshot);
        return buildAdminPayload(snapshot, {
          mutated: true,
          writes,
          actions,
          persisted: persisted.lastAutomation || persisted,
          officialResultsFetched,
          scheduleFetched,
        });
      }
      snapshot.justAdvanced = justAdvanced;
      snapshot.finalizedLabel = finalizedLabel;
      snapshot.nextAction = buildNextAction(snapshot);
      return buildAdminPayload(snapshot, {
        mutated: false,
        writes: 0,
        actions,
        officialResultsFetched,
        scheduleFetched,
      });
    }

    break;
  }

  const finalSlates = await deps.listPublishedSlates(seasonId);
  const finalSnapshot = await inspectLifecycle(
    { ...options, settings, now, seasonId },
    deps,
    finalSlates,
    { mayFetchSchedule: true, currentSlate: selectCurrentPublishedSlate(finalSlates) },
  );
  if (writes > 0) {
    const persisted = await deps.persistLifecycle(
      {
        automationEnabled,
        currentState: finalSnapshot.state,
        currentScheduleId: finalSnapshot.currentWeek?.scheduleId || null,
        currentRaceNumber: finalSnapshot.currentWeek?.raceNumber ?? null,
        nextScheduleId: finalSnapshot.nextEligible ? extractScheduleId(finalSnapshot.nextEligible) : null,
        resultsDetected: Boolean(finalSnapshot.resultsReady),
        scoringFinalized: Boolean(finalSnapshot.finalized),
        lastError: lastFailure,
        lastAutomation: lastAutomationFromRun(options, {
          actions,
          success: !lastFailure,
          error: lastFailure,
          state: finalSnapshot.state,
        }),
      },
      settings,
    );
    finalSnapshot.justAdvanced = justAdvanced;
    finalSnapshot.finalizedLabel = finalizedLabel;
    finalSnapshot.nextAction = buildNextAction(finalSnapshot);
    return buildAdminPayload(finalSnapshot, {
      mutated: true,
      writes,
      actions,
      persisted: persisted.lastAutomation || persisted,
      officialResultsFetched,
      scheduleFetched,
    });
  }
  finalSnapshot.nextAction = buildNextAction(finalSnapshot);
  return buildAdminPayload(finalSnapshot, {
    mutated: false,
    writes: 0,
    actions,
    officialResultsFetched,
    scheduleFetched,
  });
}

export async function ensureFantasyLifecycleCurrent(options = {}, depOverrides = {}) {
  const deps = await resolveDeps(depOverrides);
  const settings = options.settings || (await deps.getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const lockKey = `${seasonId}:${options.forcedByAdmin ? 'admin' : 'auto'}`;

  if (inflight.has(lockKey)) {
    return inflight.get(lockKey);
  }

  const runPromise = runLifecycleInternal({ ...options, settings, seasonId }, deps).finally(() => {
    inflight.delete(lockKey);
  });
  inflight.set(lockKey, runPromise);
  return runPromise;
}

export async function setFantasyAutomationEnabled(enabled, options = {}, depOverrides = {}) {
  const deps = await resolveDeps(depOverrides);
  const settings = options.settings || (await deps.getSettings());
  const next = await deps.persistLifecycle(
    {
      automationEnabled: enabled !== false,
    },
    settings,
  );
  if (next.persistError) {
    throw new Error(next.persistError);
  }
  return {
    ok: true,
    automationEnabled: next.automationEnabled !== false,
    mode: next.automationEnabled !== false ? 'automatic' : 'manual',
    fantasyLifecycle: next,
  };
}

export function readLockClaimResult(result, token) {
  if (!result || typeof result !== 'object') return { acquired: false, reason: 'empty_claim' };
  const lockToken = result.lockToken || result.lock_token || null;
  if (result.acquired === false) return { acquired: false, token: lockToken, reason: 'db_lock_held' };
  if (lockToken && token && lockToken !== token) {
    return { acquired: false, token: lockToken, reason: 'db_lock_lost' };
  }
  if (result.acquired === true || lockToken === token) {
    return { acquired: true, token: token || lockToken };
  }
  return { acquired: false, reason: 'db_lock_held' };
}

async function claimFantasyLifecycleLockAtomic({ token, trigger, now, deps }) {
  const sb = typeof deps.supabase === 'function' ? deps.supabase() : null;
  if (!sb) return null;

  const ttlSeconds = Math.round(LIFECYCLE_LOCK_TTL_MS / 1000);
  const { data, error } = await sb.rpc('claim_fantasy_lifecycle_lock', {
    p_token: token,
    p_trigger: trigger || null,
    p_ttl_seconds: ttlSeconds,
  });
  if (!error) {
    return readLockClaimResult(data, token);
  }

  const settings = await deps.getSettings();
  const next = {
    ...mergeFantasyLifecycle(settings.fantasyLifecycle),
    lockToken: token,
    lockTrigger: trigger || null,
    lockUntil: new Date(now + LIFECYCLE_LOCK_TTL_MS).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const nowIso = new Date(now).toISOString();
  const fallback = await sb
    .from('site_settings')
    .update({ fantasyLifecycle: next })
    .eq('id', 1)
    .or(
      [
        'fantasyLifecycle->>lockToken.is.null',
        'fantasyLifecycle->>lockToken.eq.',
        'fantasyLifecycle->>lockUntil.is.null',
        `fantasyLifecycle->>lockUntil.lte.${nowIso}`,
      ].join(','),
    )
    .select('fantasyLifecycle')
    .maybeSingle();
  if (fallback.error) {
    return { acquired: false, reason: fallback.error.message || 'db_lock_error' };
  }
  if (!fallback.data) {
    return { acquired: false, reason: 'db_lock_held' };
  }
  return readLockClaimResult(
    { acquired: true, lockToken: mergeFantasyLifecycle(fallback.data.fantasyLifecycle).lockToken },
    token,
  );
}

export async function acquireFantasyLifecycleLock(trigger, deps) {
  if (typeof deps.acquireLock === 'function') {
    return deps.acquireLock(trigger);
  }
  const token = `${trigger || 'lifecycle'}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  const local = lifecycleLocks.get('default');
  if (local && local.until > now) {
    return { acquired: false, token: local.token, reason: 'in_process_lock' };
  }
  lifecycleLocks.set('default', { token, until: now + LIFECYCLE_LOCK_TTL_MS, trigger });

  const atomic = await claimFantasyLifecycleLockAtomic({ token, trigger, now, deps });
  if (atomic) {
    if (!atomic.acquired) lifecycleLocks.delete('default');
    return { ...atomic, token: atomic.token || token };
  }

  const settings = await deps.getSettings();
  const current = mergeFantasyLifecycle(settings.fantasyLifecycle);
  const existingUntil = current.lockUntil ? new Date(current.lockUntil).getTime() : 0;
  if (existingUntil > now && current.lockToken && current.lockToken !== token) {
    lifecycleLocks.delete('default');
    return { acquired: false, token: current.lockToken, reason: 'db_lock_held' };
  }

  const persisted = await deps.persistLifecycle(
    {
      lockToken: token,
      lockTrigger: trigger || null,
      lockUntil: new Date(now + LIFECYCLE_LOCK_TTL_MS).toISOString(),
    },
    settings,
  );
  if (persisted.lockToken && persisted.lockToken !== token) {
    lifecycleLocks.delete('default');
    return { acquired: false, token: persisted.lockToken, reason: 'db_lock_lost' };
  }
  return { acquired: true, token };
}

export async function releaseFantasyLifecycleLock(token, deps) {
  if (typeof deps.releaseLock === 'function') {
    return deps.releaseLock(token);
  }
  const local = lifecycleLocks.get('default');
  if (local?.token === token) lifecycleLocks.delete('default');
  const settings = await deps.getSettings();
  const current = mergeFantasyLifecycle(settings.fantasyLifecycle);
  if (current.lockToken && current.lockToken !== token) return current;
  return deps.persistLifecycle(
    {
      lockToken: null,
      lockTrigger: null,
      lockUntil: null,
    },
    settings,
  );
}

export async function runFantasyLifecycleWithLock(options = {}, depOverrides = {}) {
  const deps = await resolveDeps(depOverrides);
  const trigger = options.trigger || (options.forcedByAdmin ? LIFECYCLE_TRIGGERS.MANUAL : LIFECYCLE_TRIGGERS.RESULTS_UPDATE);
  const lock = await acquireFantasyLifecycleLock(trigger, deps);
  if (!lock.acquired) {
    const settings = options.settings || (await deps.getSettings());
    return {
      skipped: true,
      reason: 'lifecycle_lock_held',
      trigger,
      mutated: false,
      lastAutomation: mergeFantasyLifecycle(settings.fantasyLifecycle).lastAutomation || null,
    };
  }
  try {
    return await ensureFantasyLifecycleCurrent({ ...options, trigger }, depOverrides);
  } finally {
    await releaseFantasyLifecycleLock(lock.token, deps);
  }
}

export async function refreshOfficialResultsForCurrentFantasyWeek(options = {}, depOverrides = {}) {
  const deps = await resolveDeps(depOverrides);
  const settings = options.settings || (await deps.getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  if (typeof deps.invalidateCaches === 'function') {
    await deps.invalidateCaches({ seasonId, scheduleUrl: settings.scheduleUrl });
  }
  const publishedSlates = await deps.listPublishedSlates(seasonId);
  const progression = resolveCurrentFantasyProgression(publishedSlates);
  const currentSlate = progression.currentSlate;
  const raceNumber = options.raceNumber != null ? Number(options.raceNumber) : currentSlate?.race_number ?? null;
  if (raceNumber == null) {
    return {
      ready: false,
      reason: 'no_unfinalized_fantasy_week',
      raceNumber: null,
      scheduleId: null,
      refreshed: true,
      progression,
    };
  }
  const scheduleRaces = await deps.loadSchedule({ settings, now: options.now || deps.now() });
  const race = findChampionshipRaceByNumber(scheduleRaces, raceNumber);
  const scheduleId =
    options.scheduleId ||
    (currentSlate ? extractScheduleId(currentSlate) : null) ||
    extractScheduleId(race);
  if (typeof deps.loadOfficialResults !== 'function') {
    const ready = Boolean(race && hasRaceResults(race));
    return {
      ready,
      reason: ready ? null : 'Official race results are not available yet.',
      raceNumber,
      scheduleId,
      race,
      refreshed: true,
      progression,
    };
  }
  // Existing official-results loader is keyed by championship raceNumber /
  // scheduleId. It may still request the season standings JSON (the current
  // SRH API shape) rather than a single-race payload.
  const results = await deps.loadOfficialResults({
    raceNumber,
    settings,
    scheduleRaces,
  });
  return {
    ready: Boolean(results?.ready),
    reason: results?.reason || null,
    raceNumber,
    scheduleId,
    progression,
    race,
    results,
    refreshed: true,
  };
}

export async function notifyFantasyAfterOfficialResultsUpdate(options = {}, depOverrides = {}) {
  const trigger = options.trigger || LIFECYCLE_TRIGGERS.RESULTS_UPDATE;
  const deps = await resolveDeps(depOverrides);
  const settings = options.settings || (await deps.getSettings());
  if (!isFantasyAutomationEnabled(settings) && !options.forcedByAdmin) {
    return {
      skipped: true,
      reason: 'automation_disabled',
      trigger,
      mutated: false,
    };
  }
  if (options.resultsReady === false) {
    return {
      skipped: true,
      reason: 'results_not_ready',
      trigger,
      mutated: false,
      state: LIFECYCLE_STATES.WAITING_FOR_RESULTS,
    };
  }
  return runFantasyLifecycleWithLock(
    {
      ...options,
      settings,
      trigger,
    },
    depOverrides,
  );
}

export async function refreshOfficialResultsAndAdvanceFantasy(options = {}, depOverrides = {}) {
  const trigger = options.trigger || LIFECYCLE_TRIGGERS.RESULTS_UPDATE;
  const deps = await resolveDeps(depOverrides);
  const settings = options.settings || (await deps.getSettings());
  const refresh = await refreshOfficialResultsForCurrentFantasyWeek(options, depOverrides);
  if (!isFantasyAutomationEnabled(settings) && !options.forcedByAdmin) {
    return {
      skipped: true,
      reason: 'automation_disabled',
      trigger,
      mutated: false,
      resultsRefresh: refresh,
    };
  }
  if (!refresh.ready) {
    const persisted = await deps.persistLifecycle(
      {
        currentState: LIFECYCLE_STATES.WAITING_FOR_RESULTS,
        lastError: { code: FAILURE_CODES.WAITING_FOR_RESULTS, message: refresh.reason },
        lastAutomation: buildLastAutomationRecord({
          now: options.now || deps.now(),
          trigger,
          actions: [],
          success: true,
          state: LIFECYCLE_STATES.WAITING_FOR_RESULTS,
          summary: `Waiting for Race ${refresh.raceNumber || ''} official results`.replace(/\s+/g, ' ').trim() ||
            refresh.reason ||
            'Waiting for official results',
        }),
      },
      settings,
    );
    return {
      skipped: true,
      reason: 'results_not_ready',
      trigger,
      mutated: false,
      writes: 1,
      state: LIFECYCLE_STATES.WAITING_FOR_RESULTS,
      resultsRefresh: refresh,
      lastAutomation: persisted.lastAutomation,
      diagnostics: progressionDiagnostics(refresh.progression, refresh.raceNumber),
    };
  }
  const advanced = await notifyFantasyAfterOfficialResultsUpdate(
    {
      ...options,
      settings,
      trigger,
      resultsReady: true,
      raceNumber: refresh.raceNumber,
      scheduleId: refresh.scheduleId,
    },
    depOverrides,
  );
  return { ...advanced, resultsRefresh: refresh, trigger };
}

export async function runMondayFantasySafetyCheck(options = {}, depOverrides = {}) {
  const deps = await resolveDeps(depOverrides);
  const settings = options.settings || (await deps.getSettings());
  const trigger = LIFECYCLE_TRIGGERS.MONDAY_SAFETY;
  if (!isFantasyAutomationEnabled(settings)) {
    return {
      skipped: true,
      reason: 'automation_disabled',
      trigger,
      mutated: false,
    };
  }
  return refreshOfficialResultsAndAdvanceFantasy(
    {
      ...options,
      settings,
      trigger,
    },
    depOverrides,
  );
}

export function authorizeVercelCron(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) {
    return { ok: false, status: 503, error: 'CRON_SECRET is not configured.' };
  }
  const header = String(req?.headers?.authorization || req?.headers?.Authorization || '');
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== secret) {
    return { ok: false, status: 401, error: 'Unauthorized cron request.' };
  }
  return { ok: true };
}

export function __resetFantasyLifecycleInflightForTests() {
  inflight.clear();
  lifecycleLocks.clear();
}
