import { fetchHtml, getSettings, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces, getPointsRaceByNumber } from './_schedule-points-races.js';
import { hasRaceResults } from './_race-date-status.js';
import { parseLockState } from './_fantasy-lineups.js';
import { resolveFantasySlateProgression } from './_fantasy-slate-progression.js';

const GREEN_FLAG_PLAYLIST_ID = 'PL4aFms0YBw6_uE-yoYgOFDtaNcN9ozPIO';
const GREEN_FLAG_RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${GREEN_FLAG_PLAYLIST_ID}`;

export const DETECTION_MODES = {
  MANUAL: 'manual',
  AUTOMATIC: 'automatic',
  PLACEHOLDER: 'placeholder',
};

async function loadPublishedNewsArticles() {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('news_articles')
    .select('id, article_type, headline, summary, race_number, published, published_at')
    .eq('published', true)
    .order('published_at', { ascending: false });
  if (error || !Array.isArray(data)) return [];
  return data;
}

async function loadPublishedPowerRankingRaceNumbers() {
  const sb = supabase();
  if (!sb) return new Set();
  const { data, error } = await sb
    .from('power_rankings_weeks')
    .select('race_number')
    .eq('published', true);
  if (error || !Array.isArray(data)) return new Set();
  return new Set(data.map((row) => Number(row.race_number)).filter(Number.isFinite));
}

async function loadBroadcastConfigured() {
  try {
    const res = await fetch(GREEN_FLAG_RSS_URL, {
      headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
    });
    if (!res.ok) return { configured: false, embedUrl: null };
    const xml = await res.text();
    const videoIdMatch = xml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) || xml.match(/<videoId>([^<]+)<\/videoId>/i);
    const videoId = videoIdMatch?.[1]?.trim();
    if (!videoId) return { configured: false, embedUrl: null };
    return {
      configured: true,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      videoId,
    };
  } catch {
    return { configured: false, embedUrl: null };
  }
}

function articleSearchText(article) {
  return [
    article.headline,
    article.summary,
    article.article_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function hasPublishedNewsMatch(articles, options = {}) {
  const types = options.articleTypes || null;
  const raceNumber = options.raceNumber != null ? Number(options.raceNumber) : null;
  const titleIncludes = (options.titleIncludes || []).map((value) => String(value).toLowerCase());

  return (articles || []).some((article) => {
    if (article.published === false) return false;
    if (types?.length && !types.includes(article.article_type)) return false;

    const text = articleSearchText(article);
    if (titleIncludes.length && !titleIncludes.some((needle) => text.includes(needle))) {
      return false;
    }

    if (raceNumber != null) {
      const articleRace = article.race_number != null ? Number(article.race_number) : null;
      if (articleRace != null && articleRace !== raceNumber) return false;
    }

    return true;
  });
}

function getPostRaceFromContext(ctx) {
  return ctx.postRace?.race || ctx.postRace || null;
}

function getNextRaceFromContext(ctx) {
  return ctx.nextRace?.race || ctx.nextRace || null;
}

function getNextRaceSlate(ctx) {
  const nextRaceNumber = ctx.nextRace?.raceNumber ?? ctx.fantasyProgression?.nextRaceNumber ?? null;
  const active = ctx.fantasyProgression?.activeSlateRow || null;
  if (!active || nextRaceNumber == null) return null;
  if (Number(active.race_number) !== Number(nextRaceNumber)) return null;
  if (active.status !== 'published') return null;
  return active;
}

export const MISSION_CONTROL_EVALUATORS = {
  'sun-confirm-race-results'(ctx) {
    const race = getPostRaceFromContext(ctx);
    if (!race) return { complete: false, reason: 'No completed race in schedule.' };
    return {
      complete: hasRaceResults(race),
      reason: hasRaceResults(race) ? 'Schedule reports a race winner.' : null,
    };
  },

  'mon-publish-race-recap'(ctx) {
    const raceNumber = ctx.postRace?.raceNumber;
    if (raceNumber == null) return { complete: false, reason: 'No completed race set.' };
    const complete = hasPublishedNewsMatch(ctx.newsArticles, {
      articleTypes: ['race-recap'],
      raceNumber,
    });
    return {
      complete,
      reason: complete ? 'Published race recap found for completed race.' : null,
    };
  },

  'wed-publish-power-rankings'(ctx) {
    const raceNumber = ctx.postRace?.raceNumber;
    if (raceNumber == null) return { complete: false, reason: 'No completed race set.' };
    const complete = ctx.publishedPowerRankingRaceNumbers?.has(Number(raceNumber));
    return {
      complete: Boolean(complete),
      reason: complete ? 'Published power rankings exist for completed race.' : null,
    };
  },

  'sun-score-fantasy-lineups'() {
    return { complete: false, reason: 'Fantasy scoring automation pending.' };
  },

  'thu-confirm-next-race-schedule'(ctx) {
    const next = getNextRaceFromContext(ctx);
    const complete = Boolean(next?.officialPointsRaceNumber ?? next?.raceNumber);
    return {
      complete,
      reason: complete ? 'Schedule has an upcoming points race.' : null,
    };
  },

  'thu-confirm-broadcast-link'(ctx) {
    const complete = Boolean(ctx.broadcast?.configured && ctx.broadcast?.embedUrl);
    return {
      complete,
      reason: complete ? 'Green Flag TV broadcast feed is available.' : null,
    };
  },

  'thu-publish-driver-spotlight'(ctx) {
    const complete =
      hasPublishedNewsMatch(ctx.newsArticles, {
        articleTypes: ['driver-spotlight'],
      }) ||
      hasPublishedNewsMatch(ctx.newsArticles, {
        titleIncludes: ['driver spotlight'],
      });
    return {
      complete,
      reason: complete ? 'Published driver spotlight article found.' : null,
    };
  },

  'fri-post-weekend-outlook'(ctx) {
    const raceNumber = ctx.nextRace?.raceNumber;
    const complete =
      hasPublishedNewsMatch(ctx.newsArticles, {
        articleTypes: ['weekend-preview'],
        raceNumber,
      }) ||
      hasPublishedNewsMatch(ctx.newsArticles, {
        raceNumber,
        titleIncludes: ['weekend outlook', 'weekend preview'],
      });
    return {
      complete,
      reason: complete ? 'Weekend outlook/preview article found for next race.' : null,
    };
  },

  'fri-publish-fantasy-slate'(ctx) {
    const slate = getNextRaceSlate(ctx);
    return {
      complete: Boolean(slate),
      reason: slate ? 'Published fantasy slate exists for next race.' : null,
    };
  },

  'sat-verify-fantasy-slate-published'(ctx) {
    const slate = getNextRaceSlate(ctx);
    return {
      complete: Boolean(slate),
      reason: slate ? 'Published fantasy slate exists for next race.' : null,
    };
  },

  'sat-verify-lineups-open'(ctx) {
    const slate = getNextRaceSlate(ctx);
    if (!slate) return { complete: false, reason: 'No published slate for next race.' };
    const lock = parseLockState(slate, { raceComplete: false });
    return {
      complete: Boolean(ctx.fantasyProgression?.isPlayable && lock.isPlayable),
      reason: lock.isPlayable ? 'Fantasy slate is playable before lock.' : null,
    };
  },

  'sat-lock-monitor-entries'(ctx) {
    const slate = getNextRaceSlate(ctx);
    if (!slate) return { complete: false, reason: 'No published slate for next race.' };
    const lock = parseLockState(slate, { raceComplete: false });
    return {
      complete: Boolean(lock.hasLockSchedule && lock.isLocked && !lock.raceComplete),
      reason: lock.isLocked ? 'Lineup lock time has passed.' : null,
    };
  },
};

export function evaluateAutomaticTask(taskId, ctx) {
  const evaluator = MISSION_CONTROL_EVALUATORS[taskId];
  if (!evaluator) return { complete: false, autoDetected: false, reason: null };
  const result = evaluator(ctx);
  return {
    complete: Boolean(result?.complete),
    autoDetected: true,
    reason: result?.reason || null,
  };
}

export function resolveTaskCompletionState(taskDef, ctx, manualCompletedIds = new Set()) {
  const detectionMode = taskDef.detectionMode || DETECTION_MODES.MANUAL;
  const base = {
    detectionMode,
    completionSource: null,
    autoReason: null,
    completed: false,
  };

  if (detectionMode === DETECTION_MODES.MANUAL) {
    const completed = manualCompletedIds.has(taskDef.id);
    return {
      ...base,
      completed,
      completionSource: completed ? 'manual' : null,
    };
  }

  if (detectionMode === DETECTION_MODES.PLACEHOLDER) {
    const auto = evaluateAutomaticTask(taskDef.id, ctx);
    return {
      ...base,
      completed: Boolean(auto.complete),
      completionSource: auto.complete ? 'automatic' : null,
      autoReason: auto.reason,
      autoPending: !auto.complete,
    };
  }

  const auto = evaluateAutomaticTask(taskDef.id, ctx);
  return {
    ...base,
    completed: Boolean(auto.complete),
    completionSource: auto.complete ? 'automatic' : null,
    autoReason: auto.reason,
  };
}

export async function loadMissionControlDetectionContext(options = {}) {
  const settings = options.settings || (await getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const now = options.now || new Date();

  let scheduleRaces = options.scheduleRaces || null;
  let fantasyProgression = options.fantasyProgression || null;

  if (!scheduleRaces || !fantasyProgression) {
    fantasyProgression = await resolveFantasySlateProgression(seasonId, { settings, now });
    scheduleRaces = fantasyProgression.scheduleRaces || [];
  }

  const [newsArticles, publishedPowerRankingRaceNumbers, broadcast] = await Promise.all([
    loadPublishedNewsArticles(),
    loadPublishedPowerRankingRaceNumbers(),
    loadBroadcastConfigured(),
  ]);

  const postRaceNumber = options.postRace?.raceNumber ?? null;
  const nextRaceNumber = options.nextRace?.raceNumber ?? null;

  return {
    now,
    settings,
    seasonId,
    scheduleRaces,
    fantasyProgression,
    postRace: {
      raceNumber: postRaceNumber,
      track: options.postRace?.track || null,
      date: options.postRace?.date || null,
      race:
        postRaceNumber != null
          ? getPointsRaceByNumber(scheduleRaces, Number(postRaceNumber))
          : null,
    },
    nextRace: {
      raceNumber: nextRaceNumber,
      track: options.nextRace?.track || null,
      date: options.nextRace?.date || null,
      race:
        nextRaceNumber != null
          ? getPointsRaceByNumber(scheduleRaces, Number(nextRaceNumber))
          : null,
    },
    newsArticles,
    publishedPowerRankingRaceNumbers,
    broadcast,
  };
}

export function summarizeDetectionCounts(tasks = []) {
  const automatic = tasks.filter(
    (task) =>
      task.detectionMode === DETECTION_MODES.AUTOMATIC ||
      task.detectionMode === DETECTION_MODES.PLACEHOLDER
  );
  const manual = tasks.filter((task) => task.detectionMode === DETECTION_MODES.MANUAL);
  const autoComplete = automatic.filter((task) => task.completed).length;
  const manualComplete = manual.filter((task) => task.completed).length;
  const overallComplete = tasks.filter((task) => task.completed).length;

  return {
    automatic: {
      complete: autoComplete,
      total: automatic.length,
      label: `${autoComplete} / ${automatic.length} complete`,
    },
    manual: {
      complete: manualComplete,
      total: manual.length,
      label: `${manualComplete} / ${manual.length} complete`,
    },
    overall: {
      complete: overallComplete,
      total: tasks.length,
      label: `${overallComplete} / ${tasks.length} complete`,
    },
  };
}

export async function preloadScheduleRaces(settings = null) {
  const resolvedSettings = settings || (await getSettings());
  const html = await fetchHtml(resolvedSettings.scheduleUrl);
  return enrichScheduleRaces(parseScheduleRacesFromHtml(html));
}
