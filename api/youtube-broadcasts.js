import { buildPointsRaceIndex } from "./_schedule-points-races.js";
import {
  findEffectiveNextPointsRace,
  getEffectiveRaceDateStatus,
} from "./_race-date-status.js";
import { fetchGreenFlagPlaylistFromYouTubeApi } from "./_youtube-green-flag-playlist.js";
import * as cheerio from "cheerio";

const PLAYLIST_ID = "PL4aFms0YBw6_uE-yoYgOFDtaNcN9ozPIO";
export const GREEN_FLAG_PLAYLIST_RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`;
const RSS_URL = GREEN_FLAG_PLAYLIST_RSS_URL;
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
const PLAYLIST_EMBED = `https://www.youtube.com/embed/videoseries?list=${PLAYLIST_ID}`;

const REJECT_TITLE_PATTERNS = [
  { pattern: /#shorts|\byoutube shorts\b/i, reason: "short-form" },
  { pattern: /\btrailer\b/i, reason: "trailer" },
  { pattern: /\bteaser\b/i, reason: "teaser" },
  { pattern: /\btest stream\b/i, reason: "test-stream" },
  { pattern: /\bsetup video\b|\bwheel setup\b|\bcar setup\b/i, reason: "setup-video" },
];

export function parseVideoSeasonAndRace(title) {
  const match = String(title || "").match(/\bS(\d+)\s*R\s*(\d+)\b/i);
  if (!match) {
    return { seasonNumber: null, raceNumber: null };
  }
  const seasonNumber = Number(match[1]);
  const raceNumber = Number(match[2]);
  return {
    seasonNumber: Number.isFinite(seasonNumber) && seasonNumber > 0 ? seasonNumber : null,
    raceNumber: Number.isFinite(raceNumber) && raceNumber > 0 ? raceNumber : null,
  };
}

export function parseVideoRaceNumber(title) {
  return parseVideoSeasonAndRace(title).raceNumber;
}

export function parsePublishedTimestamp(published) {
  const ms = Date.parse(String(published || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

export function classifyLeagueBroadcastVideo(video) {
  const title = String(video?.title || "");
  const lower = title.toLowerCase();

  for (const rule of REJECT_TITLE_PATTERNS) {
    if (rule.pattern.test(title)) {
      return {
        valid: false,
        rejectionReason: rule.reason,
        seasonNumber: null,
        raceNumber: null,
        publishedAtMs: parsePublishedTimestamp(video?.published),
      };
    }
  }

  const { seasonNumber, raceNumber } = parseVideoSeasonAndRace(title);
  const hasBlazingPedals = /\bblazing\s*pedals\b/i.test(title);
  const hasLeagueContext =
    /\bracing league\b/i.test(title) ||
    /\btruck series\b/i.test(title) ||
    (seasonNumber != null && raceNumber != null);

  if (!hasBlazingPedals) {
    return {
      valid: false,
      rejectionReason: "missing-blazing-pedals-league-signal",
      seasonNumber,
      raceNumber,
      publishedAtMs: parsePublishedTimestamp(video?.published),
    };
  }

  if (/\b(iRacing league|nascar league|other league)\b/i.test(lower) && !hasBlazingPedals) {
    return {
      valid: false,
      rejectionReason: "other-league",
      seasonNumber,
      raceNumber,
      publishedAtMs: parsePublishedTimestamp(video?.published),
    };
  }

  if (!hasLeagueContext && !seasonNumber) {
    return {
      valid: false,
      rejectionReason: "not-race-broadcast-title",
      seasonNumber,
      raceNumber,
      publishedAtMs: parsePublishedTimestamp(video?.published),
    };
  }

  return {
    valid: true,
    rejectionReason: null,
    seasonNumber,
    raceNumber,
    publishedAtMs: parsePublishedTimestamp(video?.published),
  };
}

export function enrichPlaylistVideos(videos = []) {
  return (videos || []).map((video) => {
    const classification = classifyLeagueBroadcastVideo(video);
    return {
      ...video,
      seasonNumber: classification.seasonNumber,
      raceNumber: classification.raceNumber ?? video.raceNumber ?? null,
      publishedAtMs: classification.publishedAtMs,
      validLeagueBroadcast: classification.valid,
      rejectionReason: classification.rejectionReason,
    };
  });
}

export function sortVideosByPublicationDesc(videos = []) {
  return [...videos].sort((a, b) => {
    const aMs = a.publishedAtMs ?? parsePublishedTimestamp(a.published);
    const bMs = b.publishedAtMs ?? parsePublishedTimestamp(b.published);
    const aValid = Number.isFinite(aMs);
    const bValid = Number.isFinite(bMs);
    if (aValid && bValid && aMs !== bMs) return bMs - aMs;
    if (aValid && !bValid) return -1;
    if (!aValid && bValid) return 1;
    return 0;
  });
}

function videoMatchesRaceTrack(video, race) {
  if (!video?.title || !race) return false;

  const title = video.title.toLowerCase();
  const track = String(race.track || "").trim().toLowerCase();
  if (!track) return false;

  const trackWords = track.split(/\s+/).filter((word) => word.length > 2);
  const matches = trackWords.filter((word) => title.includes(word));
  return matches.length >= Math.min(2, trackWords.length);
}

export function videoMatchesScheduledRace(video, race) {
  if (!video?.title || !race) return false;

  const nextNum = Number(race.raceNumber ?? race.officialPointsRaceNumber);
  if (Number.isFinite(nextNum) && nextNum > 0 && video.raceNumber === nextNum) {
    return true;
  }

  return videoMatchesRaceTrack(video, race);
}

function isRaceDay(raceDateStr, now = new Date(), settings = null) {
  const status = getEffectiveRaceDateStatus({
    raceDate: raceDateStr,
    hasResults: false,
    now,
    settings,
  });
  return status.isRaceDay;
}

/** @deprecated Diagnostic only — documents why Race 15 could win under old logic. */
export function legacyScheduleFeaturedPick(videos, nextRace) {
  const enriched = enrichPlaylistVideos(videos);
  const sorted = sortVideosByPublicationDesc(enriched);
  if (!sorted.length) return null;

  const nextNum = Number(nextRace?.raceNumber);
  const hasNextNum = Number.isFinite(nextNum) && nextNum > 0;

  if (hasNextNum) {
    const completed = sorted.filter(
      (video) => video.raceNumber != null && video.raceNumber < nextNum
    );
    if (completed.length) return completed[0];
  }

  return sorted[0] || null;
}

export function selectFeaturedVideo(videos, nextRace, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const settings = options.settings || null;
  const playlistFetch = options.playlistFetch || null;

  const enriched = enrichPlaylistVideos(videos);
  const sorted = sortVideosByPublicationDesc(enriched);
  const validCandidates = sorted.filter((video) => video.validLeagueBroadcast);

  const diagExtras = { nextRace, playlistFetch };

  if (!sorted.length) {
    return {
      featured: null,
      selectionReason: "no-broadcast",
      diagnostics: buildSelectionDiagnostics([], [], null, "no-broadcast", {
        ...diagExtras,
        legacySchedulePick: null,
      }),
    };
  }

  const raceDay = nextRace && isRaceDay(nextRace.date, now, settings);
  if (raceDay && nextRace) {
    const current = validCandidates.find((video) => videoMatchesScheduledRace(video, nextRace));
    if (current) {
      return {
        featured: current,
        selectionReason: "race-day-current",
        diagnostics: buildSelectionDiagnostics(sorted, validCandidates, current, "race-day-current", {
          ...diagExtras,
          legacySchedulePick: legacyScheduleFeaturedPick(sorted, nextRace),
        }),
      };
    }
  }

  if (validCandidates.length) {
    const newest = validCandidates[0];
    return {
      featured: newest,
      selectionReason: "newest-valid-playlist-upload",
      diagnostics: buildSelectionDiagnostics(
        sorted,
        validCandidates,
        newest,
        "newest-valid-playlist-upload",
        {
          ...diagExtras,
          legacySchedulePick: legacyScheduleFeaturedPick(sorted, nextRace),
        }
      ),
    };
  }

  const fallback = sorted[0];
  return {
    featured: fallback,
    selectionReason: "newest-fallback",
    diagnostics: buildSelectionDiagnostics(sorted, validCandidates, fallback, "newest-fallback", {
      ...diagExtras,
      legacySchedulePick: legacyScheduleFeaturedPick(sorted, nextRace),
    }),
  };
}

function buildSelectionDiagnostics(
  allEntries,
  validCandidates,
  selected,
  selectionReason,
  { nextRace, legacySchedulePick, playlistFetch } = {}
) {
  const newestValid = validCandidates[0] || allEntries[0] || null;
  return {
    totalRssEntries: allEntries.length,
    totalPlaylistItems: allEntries.length,
    validLeagueBroadcastCount: validCandidates.length,
    candidates: allEntries.map((video) => ({
      title: video.title,
      videoId: video.videoId,
      published: video.published,
      publishedAtMs: video.publishedAtMs,
      seasonNumber: video.seasonNumber,
      raceNumber: video.raceNumber,
      validLeagueBroadcast: video.validLeagueBroadcast,
      rejectionReason: video.rejectionReason,
    })),
    validCandidates: validCandidates.map((video) => ({
      title: video.title,
      videoId: video.videoId,
      published: video.published,
      publishedAtMs: video.publishedAtMs,
      seasonNumber: video.seasonNumber,
      raceNumber: video.raceNumber,
    })),
    selectedVideoId: selected?.videoId ?? null,
    selectedTitle: selected?.title ?? null,
    selectionReason,
    scheduleNextRaceNumber: nextRace?.officialPointsRaceNumber ?? nextRace?.raceNumber ?? null,
    legacyScheduleWouldSelect: legacySchedulePick
      ? {
          videoId: legacySchedulePick.videoId,
          title: legacySchedulePick.title,
          raceNumber: legacySchedulePick.raceNumber,
          reason: "last-completed-race-by-schedule",
        }
      : null,
    playlistFetch: playlistFetch || null,
    newestUpload: playlistFetch?.newestUpload ??
      (newestValid
        ? {
            videoId: newestValid.videoId,
            title: newestValid.title,
            published: newestValid.published,
            publishedAtMs: newestValid.publishedAtMs,
            raceNumber: newestValid.raceNumber,
          }
        : null),
    selectedUpload: selected
      ? {
          videoId: selected.videoId,
          title: selected.title,
          published: selected.published,
          publishedAtMs: selected.publishedAtMs,
          raceNumber: selected.raceNumber,
        }
      : null,
  };
}

export function parsePlaylistRss(xml) {
  const $ = cheerio.load(xml, { xmlMode: true, decodeEntities: true });
  const videos = [];

  $("entry").each((_, entry) => {
    const $entry = $(entry);
    const videoId =
      $entry.find("yt\\:videoId").first().text().trim() ||
      $entry.find("videoId").first().text().trim();
    if (!videoId) return;

    const title = $entry.find("title").first().text().trim();
    const published = $entry.find("published").first().text().trim();
    const link =
      $entry.find('link[rel="alternate"]').attr("href") ||
      `https://www.youtube.com/watch?v=${videoId}`;
    const thumbnail =
      $entry.find("media\\:thumbnail").attr("url") ||
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    videos.push({
      videoId,
      title,
      published,
      link,
      thumbnail,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      raceNumber: parseVideoRaceNumber(title),
    });
  });

  return sortVideosByPublicationDesc(videos);
}

export function formatScheduleRaceBroadcastLabel(nextRace) {
  if (!nextRace) return null;
  const raceNumber = nextRace.officialPointsRaceNumber ?? nextRace.raceNumber;
  const track = String(nextRace.track || "").trim();
  if (Number.isFinite(Number(raceNumber)) && Number(raceNumber) > 0 && track) {
    return `Race ${Number(raceNumber)} — ${track}`;
  }
  return track || null;
}

export function buildBroadcastPresentation(featured, nextRace, selectionReason) {
  if (!featured) {
    return {
      heading: "Green Flag TV Broadcasts",
      videoTitle: null,
      represents: "playlist",
    };
  }

  if (selectionReason === "race-day-current") {
    const scheduleLabel = formatScheduleRaceBroadcastLabel(nextRace);
    return {
      heading: scheduleLabel ? `Race Day Broadcast · ${scheduleLabel}` : "Race Day Broadcast",
      videoTitle: featured.title,
      represents: "race-day-current",
    };
  }

  return {
    heading: "Latest Broadcast",
    videoTitle: featured.title,
    represents: "latest-upload",
  };
}

function buildScheduleContext(scheduleData, now = new Date()) {
  const settings = scheduleData?.settings || {};
  const progressionOptions = { now, settings };
  const { races: enriched, excludedNonPointsCount, excludedNonPointsRaces } =
    buildPointsRaceIndex(scheduleData?.races || []);
  const effectiveNext = findEffectiveNextPointsRace(enriched, progressionOptions);
  const row = effectiveNext.race;
  const nextStatus = effectiveNext.status;

  const debug = {
    rawScheduleIndex: null,
    officialPointsRaceNumber: null,
    excludedNonPointsCount,
    excludedNonPointsRaces,
    currentEasternTime: nextStatus?.currentEasternTime ?? null,
    raceDate: nextStatus?.raceDate ?? row?.date ?? null,
    configuredRaceStartTime: nextStatus?.configuredRaceStartTime ?? null,
    completionBufferMinutes: nextStatus?.completionBufferMinutes ?? null,
    effectiveAdvanceTime: nextStatus?.effectiveAdvanceTime ?? null,
    raceStatus: nextStatus?.raceStatus ?? null,
    canAdvanceToNextRace: nextStatus?.canAdvanceToNextRace ?? null,
    advanceReason: nextStatus?.advanceReason ?? null,
  };

  if (!row || row.nonPoints || row.officialPointsRaceNumber == null) {
    return { nextRace: null, debug, settings };
  }

  debug.rawScheduleIndex = row.scheduleRow ?? row.raceNumber ?? null;
  debug.officialPointsRaceNumber = row.officialPointsRaceNumber;

  const nextRace = {
    rawScheduleIndex: row.scheduleRow ?? row.raceNumber,
    officialPointsRaceNumber: row.officialPointsRaceNumber,
    raceNumber: row.officialPointsRaceNumber,
    track: row.track,
    date: row.date,
    points: row.points,
    winner: row.winner,
    nonPoints: false,
  };

  return { nextRace, debug, settings };
}

async function getScheduleContext(req) {
  try {
    const host = req.headers.host || "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] || "http";
    const res = await fetch(`${proto}://${host}/api/schedule`, {
      headers: { "user-agent": "BP-Truck-Series-Website/1.0" },
    });
    if (!res.ok) return { nextRace: null, debug: null, settings: null };
    const data = await res.json();
    return buildScheduleContext(data);
  } catch {
    return { nextRace: null, debug: null, settings: null };
  }
}

export default async function handler(req, res) {
  const forceFresh =
    String(req.query?.fresh || "") === "1" || String(req.query?.debug || "") === "1";

  const fallbackPayload = {
    fallback: true,
    playlistId: PLAYLIST_ID,
    playlistUrl: PLAYLIST_URL,
    embedUrl: PLAYLIST_EMBED,
    featured: null,
    videos: [],
    selectionReason: "playlist_fallback",
    updatedAt: new Date().toISOString(),
  };

  try {
    const apiKey = process.env.YOUTUBE_API_KEY || "";
    const scheduleContext = await getScheduleContext(req);

    const nextRace = scheduleContext.nextRace;
    const raceDebug = scheduleContext.debug;
    const scheduleSettings = scheduleContext.settings || {};

    if (!apiKey) {
      res.setHeader(
        "Cache-Control",
        forceFresh ? "no-store" : "s-maxage=60, stale-while-revalidate=120"
      );
      return res.status(200).json({
        ...fallbackPayload,
        error: "YOUTUBE_API_KEY is not configured in Vercel environment variables.",
        rssUrl: RSS_URL,
        playlistDataSource: "youtube-data-api",
      });
    }

    let videos = [];
    let playlistFetchDiagnostics = null;

    try {
      const playlistResult = await fetchGreenFlagPlaylistFromYouTubeApi(PLAYLIST_ID, apiKey);
      videos = playlistResult.videos;
      playlistFetchDiagnostics = playlistResult.fetchDiagnostics;
    } catch (playlistError) {
      res.setHeader(
        "Cache-Control",
        forceFresh ? "no-store" : "s-maxage=60, stale-while-revalidate=120"
      );
      return res.status(200).json({
        ...fallbackPayload,
        error: playlistError.message || "YouTube Data API playlist fetch failed",
        rssUrl: RSS_URL,
        playlistDataSource: "youtube-data-api",
        selectionDiagnostics: {
          totalRssEntries: 0,
          totalPlaylistItems: 0,
          validLeagueBroadcastCount: 0,
          candidates: [],
          selectedVideoId: null,
          selectionReason: "no-broadcast",
          playlistFetch: playlistFetchDiagnostics,
        },
      });
    }

    if (!videos.length) {
      res.setHeader(
        "Cache-Control",
        forceFresh ? "no-store" : "s-maxage=60, stale-while-revalidate=120"
      );
      return res.status(200).json({
        ...fallbackPayload,
        error: "No videos found in playlist",
        rssUrl: RSS_URL,
        playlistDataSource: "youtube-data-api",
        selectionDiagnostics: {
          totalRssEntries: 0,
          totalPlaylistItems: 0,
          validLeagueBroadcastCount: 0,
          candidates: [],
          selectedVideoId: null,
          selectionReason: "no-broadcast",
          playlistFetch: playlistFetchDiagnostics,
        },
      });
    }

    const { featured, selectionReason, diagnostics } = selectFeaturedVideo(videos, nextRace, {
      settings: scheduleSettings,
      playlistFetch: playlistFetchDiagnostics,
    });
    const broadcastPresentation = buildBroadcastPresentation(
      featured,
      nextRace,
      selectionReason
    );

    res.setHeader(
      "Cache-Control",
      forceFresh ? "no-store" : "s-maxage=300, stale-while-revalidate=600"
    );
    return res.status(200).json({
      fallback: false,
      playlistId: PLAYLIST_ID,
      playlistUrl: PLAYLIST_URL,
      rssUrl: RSS_URL,
      playlistDataSource: "youtube-data-api",
      embedUrl: featured?.embedUrl || PLAYLIST_EMBED,
      featured,
      broadcastPresentation,
      videos,
      nextRace: nextRace
        ? {
            rawScheduleIndex: nextRace.rawScheduleIndex,
            officialPointsRaceNumber: nextRace.officialPointsRaceNumber,
            raceNumber: nextRace.officialPointsRaceNumber,
            track: nextRace.track,
            date: nextRace.date,
            isRaceDay: isRaceDay(nextRace.date, new Date(), scheduleSettings),
          }
        : null,
      debug: raceDebug,
      selectionReason,
      selectionDiagnostics: diagnostics,
      forceFresh,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.setHeader(
      "Cache-Control",
      forceFresh ? "no-store" : "s-maxage=60, stale-while-revalidate=120"
    );
    return res.status(200).json({
      ...fallbackPayload,
      error: e.message || "YouTube broadcasts fetch failed",
      rssUrl: RSS_URL,
      playlistDataSource: "youtube-data-api",
    });
  }
}
