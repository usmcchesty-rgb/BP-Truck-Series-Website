import { fetchHtml, getSettings, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces, getPointsRaceByNumber } from './_schedule-points-races.js';
import { getEasternDateParts, hasRaceResults, parseScheduleDateParts } from './_race-date-status.js';
import { parseLockState } from './_fantasy-lineups.js';
import { resolveFantasySlateProgression } from './_fantasy-slate-progression.js';

const GREEN_FLAG_PLAYLIST_ID = 'PL4aFms0YBw6_uE-yoYgOFDtaNcN9ozPIO';
const GREEN_FLAG_RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${GREEN_FLAG_PLAYLIST_ID}`;

export const DETECTION_MODES = {
  MANUAL: 'manual',
  AUTOMATIC: 'automatic',
  PLACEHOLDER: 'placeholder',
};

function datePartsToKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function addDaysToParts(parts, deltaDays) {
  const anchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

function resolveRaceDateParts(race) {
  const dateStr = race?.date || null;
  if (!dateStr) return null;
  return parseScheduleDateParts(dateStr);
}

function normalizeRaceRef(race) {
  if (!race) return null;
  const raceNumber =
    race.raceNumber ?? race.race_number ?? race.officialPointsRaceNumber ?? null;
  if (raceNumber == null) return null;
  return {
    raceNumber: Number(raceNumber),
    track: race.track || null,
    date: race.date || null,
    race,
  };
}

export function dateToEasternKey(date) {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(parsed.getTime())) return null;
  return datePartsToKey(getEasternDateParts(parsed));
}

export function isWithinRaceWindow(date, window) {
  if (!window?.start || !window?.end || !date) return false;
  const key = dateToEasternKey(date);
  if (!key) return false;
  return key >= window.start && key <= window.end;
}

export function matchesRaceContext(item, race) {
  const target = normalizeRaceRef(race);
  if (!target) {
    return { matched: false, byMetadata: false, targetRace: null, itemRace: null };
  }

  const itemRaceRaw = item?.race_number ?? item?.raceNumber ?? null;
  if (itemRaceRaw == null) {
    return {
      matched: null,
      byMetadata: false,
      targetRace: target.raceNumber,
      itemRace: null,
    };
  }

  const itemRace = Number(itemRaceRaw);
  return {
    matched: itemRace === target.raceNumber,
    byMetadata: true,
    targetRace: target.raceNumber,
    itemRace,
  };
}

export function getPostRaceWindow(completedRace, nextRace) {
  const startParts = resolveRaceDateParts(completedRace);
  if (!startParts) return null;

  let endParts = addDaysToParts(startParts, 3);

  const nextRef = normalizeRaceRef(nextRace);
  if (nextRef?.date) {
    const nextParts = resolveRaceDateParts(nextRef);
    if (nextParts) {
      const nextPrepStart = addDaysToParts(nextParts, -4);
      const nextPrepStartKey = datePartsToKey(nextPrepStart);
      const postRaceWedKey = datePartsToKey(endParts);
      if (nextPrepStartKey < postRaceWedKey) {
        endParts = addDaysToParts(nextParts, -5);
      }
    }
  }

  return {
    start: datePartsToKey(startParts),
    end: datePartsToKey(endParts),
    startParts,
    endParts,
  };
}

export function getNextRacePrepWindow(upcomingRace) {
  const raceParts = resolveRaceDateParts(upcomingRace);
  if (!raceParts) return null;

  const startParts = addDaysToParts(raceParts, -4);
  const endParts = addDaysToParts(raceParts, -1);

  return {
    start: datePartsToKey(startParts),
    end: datePartsToKey(endParts),
    startParts,
    endParts,
  };
}

function formatPublishedDayLabel(dateValue) {
  const parsed = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (!Number.isFinite(parsed.getTime())) return 'recently';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(parsed);
}

function articleSearchText(article) {
  return [article.headline, article.summary, article.article_type].filter(Boolean).join(' ').toLowerCase();
}

function articleMatchesTypes(article, articleTypes) {
  if (!articleTypes?.length) return true;
  return articleTypes.includes(article.article_type);
}

function articleMatchesTitle(article, titleIncludes) {
  if (!titleIncludes?.length) return true;
  const text = articleSearchText(article);
  return titleIncludes.some((needle) => text.includes(String(needle).toLowerCase()));
}

function findRaceScopedNewsMatch(articles, options = {}) {
  const race = normalizeRaceRef(options.race);
  const window = options.window || null;
  const typeLabel = options.typeLabel || 'article';
  const articleTypes = options.articleTypes || null;
  const titleIncludes = options.titleIncludes || null;

  if (!race) {
    return { complete: false, reason: `No target race set for ${typeLabel}.` };
  }

  const sorted = [...(articles || [])]
    .filter((article) => article.published !== false)
    .filter((article) => articleMatchesTypes(article, articleTypes))
    .filter((article) => articleMatchesTitle(article, titleIncludes))
    .sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime());

  let latestWrongRace = null;

  for (const article of sorted) {
    const ctx = matchesRaceContext(article, race);
    if (ctx.byMetadata) {
      if (ctx.matched) {
        return {
          complete: true,
          reason: `Found Race ${race.raceNumber} ${typeLabel}${article.published_at ? ` published ${formatPublishedDayLabel(article.published_at)}` : ''}.`,
          article,
        };
      }
      latestWrongRace = ctx.itemRace;
      continue;
    }

    if (window && isWithinRaceWindow(article.published_at, window)) {
      return {
        complete: true,
        reason: `Found ${typeLabel} published ${formatPublishedDayLabel(article.published_at)} for Race ${race.raceNumber} week.`,
        article,
      };
    }
  }

  if (latestWrongRace != null) {
    return {
      complete: false,
      reason: `Latest ${typeLabel} is from Race ${latestWrongRace}, not Race ${race.raceNumber}.`,
    };
  }

  return {
    complete: false,
    reason: `No ${typeLabel} found for Race ${race.raceNumber}${window ? ' week' : ''}.`,
  };
}

function parseVideoRaceNumber(title) {
  const match = String(title || '').match(/\bS11\s*R\s*(\d+)\b/i);
  if (!match) return null;
  const raceNumber = Number(match[1]);
  return Number.isFinite(raceNumber) && raceNumber > 0 ? raceNumber : null;
}

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

async function loadPublishedPowerRankingWeeks() {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('power_rankings_weeks')
    .select('id, race_number, published, published_date, updated_at, created_at')
    .eq('published', true)
    .order('race_number', { ascending: false });
  if (error || !Array.isArray(data)) return [];
  return data;
}

async function loadBroadcastState(nextRace) {
  try {
    const res = await fetch(GREEN_FLAG_RSS_URL, {
      headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
    });
    if (!res.ok) {
      return { configured: false, embedUrl: null, featured: null, matchedToRace: false };
    }

    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
    const videos = entries
      .map((entryXml) => {
        const videoIdMatch =
          entryXml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i) ||
          entryXml.match(/<videoId>([^<]+)<\/videoId>/i);
        const titleMatch = entryXml.match(/<title>([^<]+)<\/title>/i);
        const publishedMatch = entryXml.match(/<published>([^<]+)<\/published>/i);
        const videoId = videoIdMatch?.[1]?.trim();
        if (!videoId) return null;
        const title = titleMatch?.[1]?.trim() || '';
        return {
          videoId,
          title,
          published: publishedMatch?.[1]?.trim() || null,
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          raceNumber: parseVideoRaceNumber(title),
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime());

    const featured = videos[0] || null;
    if (!featured?.embedUrl) {
      return { configured: false, embedUrl: null, featured: null, matchedToRace: false };
    }

    const nextRaceNumber = normalizeRaceRef(nextRace)?.raceNumber ?? null;
    let matchedToRace = false;
    let matchReason = null;

    if (nextRaceNumber != null && featured.raceNumber != null) {
      matchedToRace = featured.raceNumber === nextRaceNumber;
      matchReason = matchedToRace
        ? `Green Flag TV broadcast matches Race ${nextRaceNumber}.`
        : `Broadcast link exists but latest video is Race ${featured.raceNumber}, not Race ${nextRaceNumber}.`;
    } else if (nextRaceNumber != null) {
      matchedToRace = false;
      matchReason = 'Broadcast link exists but could not be matched to this race.';
    } else {
      matchedToRace = true;
      matchReason = 'Green Flag TV broadcast feed is available.';
    }

    return {
      configured: true,
      embedUrl: featured.embedUrl,
      featured,
      matchedToRace,
      matchReason,
    };
  } catch {
    return { configured: false, embedUrl: null, featured: null, matchedToRace: false };
  }
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

function findPowerRankingsForRace(weeks, race, window) {
  const target = normalizeRaceRef(race);
  if (!target) {
    return { complete: false, reason: 'No completed race set for power rankings.' };
  }

  const exact = (weeks || []).find((week) => Number(week.race_number) === target.raceNumber);
  if (!exact) {
    const latestOther = (weeks || []).find((week) => Number(week.race_number) !== target.raceNumber);
    if (latestOther) {
      return {
        complete: false,
        reason: `Latest published Power Rankings are for Race ${latestOther.race_number}, not Race ${target.raceNumber}.`,
      };
    }
    return { complete: false, reason: `No published Power Rankings found for Race ${target.raceNumber}.` };
  }

  const ctx = matchesRaceContext(exact, target);
  if (ctx.byMetadata && ctx.matched) {
    const stamp = exact.updated_at || exact.published_date || exact.created_at;
    return {
      complete: true,
      reason: `Published Power Rankings found for Race ${target.raceNumber}${stamp ? ` (${formatPublishedDayLabel(stamp)})` : ''}.`,
    };
  }

  const stamp = exact.updated_at || exact.published_date || exact.created_at;
  if (window && isWithinRaceWindow(stamp, window)) {
    return {
      complete: true,
      reason: `Published Power Rankings for Race ${target.raceNumber} fall in the post-race window.`,
    };
  }

  return {
    complete: false,
    reason: `Power Rankings for Race ${target.raceNumber} exist but fall outside the current post-race window.`,
  };
}

export const MISSION_CONTROL_EVALUATORS = {
  'sun-confirm-race-results'(ctx) {
    const postRace = normalizeRaceRef(ctx.postRace);
    const race = getPostRaceFromContext(ctx);
    if (!postRace || !race) return { complete: false, reason: 'No completed race in schedule.' };

    const scheduleRaceNumber = Number(
      race.officialPointsRaceNumber ?? race.raceNumber ?? postRace.raceNumber
    );
    if (scheduleRaceNumber !== postRace.raceNumber) {
      return {
        complete: false,
        reason: `Schedule race mismatch for completed race (expected Race ${postRace.raceNumber}).`,
      };
    }

    const complete = hasRaceResults(race);
    return {
      complete,
      reason: complete
        ? `Race ${postRace.raceNumber} results posted (winner on schedule).`
        : `Race ${postRace.raceNumber} results not posted yet.`,
    };
  },

  'mon-publish-race-recap'(ctx) {
    const postRace = normalizeRaceRef(ctx.postRace);
    const window = getPostRaceWindow(getPostRaceFromContext(ctx), getNextRaceFromContext(ctx));
    const result = findRaceScopedNewsMatch(ctx.newsArticles, {
      race: postRace,
      window,
      articleTypes: ['race-recap'],
      typeLabel: 'race recap',
    });
    return { complete: result.complete, reason: result.reason };
  },

  'wed-publish-power-rankings'(ctx) {
    const postRace = normalizeRaceRef(ctx.postRace);
    const window = getPostRaceWindow(getPostRaceFromContext(ctx), getNextRaceFromContext(ctx));
    return findPowerRankingsForRace(ctx.publishedPowerRankingWeeks, postRace, window);
  },

  'sun-score-fantasy-lineups'() {
    return { complete: false, reason: 'Fantasy scoring automation pending.' };
  },

  'thu-confirm-next-race-schedule'(ctx) {
    const next = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace);
    const complete = Boolean(next?.raceNumber);
    return {
      complete,
      reason: complete
        ? `Schedule has upcoming Race ${next.raceNumber}${next.track ? ` — ${next.track}` : ''}.`
        : 'No upcoming points race found in schedule.',
    };
  },

  'thu-confirm-broadcast-link'(ctx) {
    const next = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace);
    const broadcast = ctx.broadcast || {};

    if (!broadcast.configured || !broadcast.embedUrl) {
      return { complete: false, reason: 'No Green Flag TV broadcast feed found.' };
    }

    if (next?.raceNumber != null) {
      if (broadcast.matchedToRace) {
        return { complete: true, reason: broadcast.matchReason };
      }
      return {
        complete: false,
        reason:
          broadcast.matchReason ||
          'Broadcast link exists but could not be matched to this race.',
      };
    }

    return { complete: true, reason: broadcast.matchReason || 'Green Flag TV broadcast feed is available.' };
  },

  'thu-publish-driver-spotlight'(ctx) {
    const nextRace = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace);
    const window = getNextRacePrepWindow(getNextRaceFromContext(ctx));

    const byType = findRaceScopedNewsMatch(ctx.newsArticles, {
      race: nextRace,
      window,
      articleTypes: ['driver-spotlight'],
      typeLabel: 'Driver Spotlight',
    });
    if (byType.complete) return { complete: true, reason: byType.reason };

    const byTitle = findRaceScopedNewsMatch(ctx.newsArticles, {
      race: nextRace,
      window,
      titleIncludes: ['driver spotlight'],
      typeLabel: 'Driver Spotlight',
    });
    return { complete: byTitle.complete, reason: byTitle.reason };
  },

  'fri-post-weekend-outlook'(ctx) {
    const nextRace = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace);
    const window = getNextRacePrepWindow(getNextRaceFromContext(ctx));

    const byType = findRaceScopedNewsMatch(ctx.newsArticles, {
      race: nextRace,
      window,
      articleTypes: ['weekend-preview'],
      typeLabel: 'Weekend Outlook',
    });
    if (byType.complete) return { complete: true, reason: byType.reason };

    const byTitle = findRaceScopedNewsMatch(ctx.newsArticles, {
      race: nextRace,
      window,
      titleIncludes: ['weekend outlook', 'weekend preview'],
      typeLabel: 'Weekend Outlook',
    });
    return { complete: byTitle.complete, reason: byTitle.reason };
  },

  'fri-publish-fantasy-slate'(ctx) {
    const nextRaceNumber = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace)?.raceNumber;
    const slate = getNextRaceSlate(ctx);
    return {
      complete: Boolean(slate),
      reason: slate
        ? `Published fantasy slate exists for Race ${nextRaceNumber}.`
        : nextRaceNumber != null
          ? `No published fantasy slate found for Race ${nextRaceNumber}.`
          : 'No upcoming race set for fantasy slate check.',
    };
  },

  'sat-verify-fantasy-slate-published'(ctx) {
    const nextRaceNumber = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace)?.raceNumber;
    const slate = getNextRaceSlate(ctx);
    return {
      complete: Boolean(slate),
      reason: slate
        ? `Published fantasy slate exists for Race ${nextRaceNumber}.`
        : nextRaceNumber != null
          ? `No published fantasy slate found for Race ${nextRaceNumber}.`
          : 'No upcoming race set for fantasy slate check.',
    };
  },

  'sat-verify-lineups-open'(ctx) {
    const nextRaceNumber = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace)?.raceNumber;
    const slate = getNextRaceSlate(ctx);
    if (!slate) {
      return {
        complete: false,
        reason:
          nextRaceNumber != null
            ? `No published slate for Race ${nextRaceNumber}.`
            : 'No published slate for next race.',
      };
    }
    const lock = parseLockState(slate, { raceComplete: false });
    return {
      complete: Boolean(ctx.fantasyProgression?.isPlayable && lock.isPlayable),
      reason: lock.isPlayable
        ? `Race ${nextRaceNumber} lineup submissions are open before lock.`
        : `Race ${nextRaceNumber} slate is not open for submissions yet.`,
    };
  },

  'sat-lock-monitor-entries'(ctx) {
    const nextRaceNumber = normalizeRaceRef(getNextRaceFromContext(ctx) || ctx.nextRace)?.raceNumber;
    const slate = getNextRaceSlate(ctx);
    if (!slate) {
      return {
        complete: false,
        reason:
          nextRaceNumber != null
            ? `No published slate for Race ${nextRaceNumber}.`
            : 'No published slate for next race.',
      };
    }
    const lock = parseLockState(slate, { raceComplete: false });
    return {
      complete: Boolean(lock.hasLockSchedule && lock.isLocked && !lock.raceComplete),
      reason: lock.isLocked
        ? `Race ${nextRaceNumber} lineup lock time has passed.`
        : `Race ${nextRaceNumber} lineups are not locked yet.`,
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

export function isTaskCalendarGated(calendarGate = {}) {
  const { dueDateKey, todayKey, hasRaceDate } = calendarGate;
  return Boolean(hasRaceDate && dueDateKey && todayKey && dueDateKey > todayKey);
}

function buildCalendarGatedCompletion(taskDef, calendarGate = {}) {
  const dayLabel = calendarGate.dayLabel || null;
  return {
    detectionMode: taskDef.detectionMode || DETECTION_MODES.MANUAL,
    completed: false,
    completionSource: null,
    autoReason: dayLabel ? `Scheduled for ${dayLabel}` : 'Scheduled for a later date',
    calendarGated: true,
  };
}

export function resolveTaskCompletionState(
  taskDef,
  ctx,
  manualCompletedIds = new Set(),
  calendarGate = {}
) {
  if (isTaskCalendarGated(calendarGate)) {
    return buildCalendarGatedCompletion(taskDef, calendarGate);
  }

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

  const postRaceNumber = options.postRace?.raceNumber ?? null;
  const nextRaceNumber = options.nextRace?.raceNumber ?? null;
  const postRaceRace =
    postRaceNumber != null ? getPointsRaceByNumber(scheduleRaces, Number(postRaceNumber)) : null;
  const nextRaceRace =
    nextRaceNumber != null ? getPointsRaceByNumber(scheduleRaces, Number(nextRaceNumber)) : null;

  const [newsArticles, publishedPowerRankingWeeks, broadcast] = await Promise.all([
    loadPublishedNewsArticles(),
    loadPublishedPowerRankingWeeks(),
    loadBroadcastState(nextRaceRace || options.nextRace),
  ]);

  const postRaceWindow = getPostRaceWindow(postRaceRace, nextRaceRace);
  const nextRacePrepWindow = getNextRacePrepWindow(nextRaceRace);

  return {
    now,
    settings,
    seasonId,
    scheduleRaces,
    fantasyProgression,
    postRace: {
      raceNumber: postRaceNumber,
      track: options.postRace?.track || postRaceRace?.track || null,
      date: options.postRace?.date || postRaceRace?.date || null,
      race: postRaceRace,
    },
    nextRace: {
      raceNumber: nextRaceNumber,
      track: options.nextRace?.track || nextRaceRace?.track || null,
      date: options.nextRace?.date || nextRaceRace?.date || null,
      race: nextRaceRace,
    },
    postRaceWindow,
    nextRacePrepWindow,
    newsArticles,
    publishedPowerRankingWeeks,
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

// Backward-compatible export used in tests
export function hasPublishedNewsMatch(articles, options = {}) {
  const result = findRaceScopedNewsMatch(articles, {
    race: { raceNumber: options.raceNumber },
    window: options.window || null,
    articleTypes: options.articleTypes || null,
    titleIncludes: options.titleIncludes || null,
    typeLabel: 'article',
  });
  return result.complete;
}
