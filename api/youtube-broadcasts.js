import * as cheerio from "cheerio";

const PLAYLIST_ID = "PL4aFms0YBw6_uE-yoYgOFDtaNcN9ozPIO";
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`;
const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`;
const PLAYLIST_EMBED = `https://www.youtube.com/embed/videoseries?list=${PLAYLIST_ID}`;

function parsePlaylistRss(xml) {
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

  return videos.sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
  );
}

function sameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function parseVideoRaceNumber(title) {
  // Green Flag TV titles use official points race numbers (e.g. S11R12).
  // Do not apply schedule non-points adjustments to these values.
  const match = String(title || "").match(/\bS11\s*R\s*(\d+)\b/i);
  if (!match) return null;
  const raceNumber = Number(match[1]);
  return Number.isFinite(raceNumber) && raceNumber > 0 ? raceNumber : null;
}

function parseRaceDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRaceDay(raceDateStr) {
  const raceDate = parseRaceDate(raceDateStr);
  if (!raceDate) return false;
  return sameCalendarDay(raceDate, new Date());
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

function videoMatchesRace(video, race) {
  if (!video?.title || !race) return false;

  const nextNum = Number(race.raceNumber);
  if (Number.isFinite(nextNum) && nextNum > 0 && video.raceNumber === nextNum) {
    return true;
  }

  return videoMatchesRaceTrack(video, race);
}

function isUpcomingRaceVideo(video, nextRace) {
  if (!nextRace || !video) return false;

  const nextNum = Number(nextRace.raceNumber);
  if (Number.isFinite(nextNum) && nextNum > 0) {
    if (video.raceNumber != null && video.raceNumber >= nextNum) return true;
  }

  return videoMatchesRaceTrack(video, nextRace);
}

function pickLastCompletedRace(videos, nextRace) {
  const nextNum = Number(nextRace?.raceNumber);
  const hasNextNum = Number.isFinite(nextNum) && nextNum > 0;

  if (hasNextNum) {
    const completed = videos.filter(
      (video) => video.raceNumber != null && video.raceNumber < nextNum
    );
    if (completed.length) return completed[0];
  }

  const withoutUpcoming = videos.filter((video) => !isUpcomingRaceVideo(video, nextRace));
  return withoutUpcoming[0] || null;
}

function selectFeaturedVideo(videos, nextRace) {
  if (!videos.length) {
    return { featured: null, selectionReason: "newest-fallback" };
  }

  const raceDay = nextRace && isRaceDay(nextRace.date);
  const nextNum = Number(nextRace?.raceNumber);
  const hasNextNum = Number.isFinite(nextNum) && nextNum > 0;

  if (raceDay && nextRace) {
    const current = videos.find((video) => videoMatchesRace(video, nextRace));
    if (current) {
      return { featured: current, selectionReason: "race-day-current" };
    }

    const completed = pickLastCompletedRace(videos, nextRace);
    if (completed) {
      return { featured: completed, selectionReason: "last-completed-race" };
    }

    return { featured: videos[0], selectionReason: "newest-fallback" };
  }

  if (hasNextNum) {
    const completed = videos.filter(
      (video) => video.raceNumber != null && video.raceNumber < nextNum
    );
    if (completed.length) {
      return { featured: completed[0], selectionReason: "last-completed-race" };
    }
  }

  const withoutUpcoming = nextRace
    ? videos.filter((video) => !isUpcomingRaceVideo(video, nextRace))
    : videos;

  if (withoutUpcoming.length) {
    return {
      featured: withoutUpcoming[0],
      selectionReason: hasNextNum ? "last-completed-race" : "newest-fallback",
    };
  }

  return { featured: videos[0], selectionReason: "newest-fallback" };
}

const NON_POINTS_LABEL_PATTERN = /\b(duel|duels|non-points|exhibition|clash)\b/i;

function isNonPointsRace(race) {
  const points = String(race?.points ?? "")
    .trim()
    .toLowerCase();
  const status = String(race?.status ?? "")
    .trim()
    .toLowerCase();
  const label = String(race?.track ?? "");

  if (points === "no" || status === "non-points") return true;
  return NON_POINTS_LABEL_PATTERN.test(label);
}

function buildPointsRaceIndex(races) {
  let officialPointsRaceNumber = 0;
  const excludedNonPointsRaces = [];
  const enriched = (races || []).map((race) => {
    const nonPoints = isNonPointsRace(race);
    if (nonPoints) {
      excludedNonPointsRaces.push({
        rawScheduleIndex: race.raceNumber,
        track: race.track,
        date: race.date,
        points: race.points,
        status: race.status,
      });
      return {
        ...race,
        nonPoints: true,
        officialPointsRaceNumber: null,
      };
    }

    officialPointsRaceNumber += 1;
    return {
      ...race,
      nonPoints: false,
      officialPointsRaceNumber,
    };
  });

  return {
    races: enriched,
    excludedNonPointsCount: excludedNonPointsRaces.length,
    excludedNonPointsRaces,
  };
}

function findUpcomingPointsRace(enrichedRaces) {
  const now = new Date();
  return (
    enrichedRaces.find((race) => {
      if (race.nonPoints) return false;
      const date = parseRaceDate(race.date);
      if (!date || Number.isNaN(date.getTime())) return false;
      return date >= now && !String(race.winner ?? "").trim();
    }) || null
  );
}

function buildScheduleContext(scheduleData) {
  const { races: enriched, excludedNonPointsCount, excludedNonPointsRaces } =
    buildPointsRaceIndex(scheduleData?.races || []);
  const rawNext = scheduleData?.next || null;

  const debug = {
    rawScheduleIndex: null,
    officialPointsRaceNumber: null,
    excludedNonPointsCount,
    excludedNonPointsRaces,
  };

  if (!rawNext) {
    return { nextRace: null, debug };
  }

  let row =
    enriched.find((race) => race.raceNumber === rawNext.raceNumber) ||
    enriched.find((race) => race.track === rawNext.track && race.date === rawNext.date) ||
    null;

  if (row?.nonPoints) {
    row = findUpcomingPointsRace(enriched);
  }

  if (!row || row.nonPoints || row.officialPointsRaceNumber == null) {
    return { nextRace: null, debug };
  }

  debug.rawScheduleIndex = rawNext.raceNumber;
  debug.officialPointsRaceNumber = row.officialPointsRaceNumber;

  const nextRace = {
    ...rawNext,
    rawScheduleIndex: rawNext.raceNumber,
    officialPointsRaceNumber: row.officialPointsRaceNumber,
    raceNumber: row.officialPointsRaceNumber,
    track: row.track || rawNext.track,
    date: row.date || rawNext.date,
    nonPoints: false,
  };

  return { nextRace, debug };
}

async function getScheduleContext(req) {
  try {
    const host = req.headers.host || "localhost:3000";
    const proto = req.headers["x-forwarded-proto"] || "http";
    const res = await fetch(`${proto}://${host}/api/schedule`, {
      headers: { "user-agent": "BP-Truck-Series-Website/1.0" },
    });
    if (!res.ok) return { nextRace: null, debug: null };
    const data = await res.json();
    return buildScheduleContext(data);
  } catch {
    return { nextRace: null, debug: null };
  }
}

export default async function handler(req, res) {
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
    const [rssRes, scheduleContext] = await Promise.all([
      fetch(RSS_URL, { headers: { "user-agent": "BP-Truck-Series-Website/1.0" } }),
      getScheduleContext(req),
    ]);

    const nextRace = scheduleContext.nextRace;
    const raceDebug = scheduleContext.debug;

    if (!rssRes.ok) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({
        ...fallbackPayload,
        error: `RSS fetch failed (${rssRes.status})`,
      });
    }

    const xml = await rssRes.text();
    const videos = parsePlaylistRss(xml);

    if (!videos.length) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({
        ...fallbackPayload,
        error: "No videos found in playlist feed",
      });
    }

    const { featured, selectionReason } = selectFeaturedVideo(videos, nextRace);

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      fallback: false,
      playlistId: PLAYLIST_ID,
      playlistUrl: PLAYLIST_URL,
      embedUrl: featured?.embedUrl || PLAYLIST_EMBED,
      featured,
      videos,
      nextRace: nextRace
        ? {
            rawScheduleIndex: nextRace.rawScheduleIndex,
            officialPointsRaceNumber: nextRace.officialPointsRaceNumber,
            raceNumber: nextRace.officialPointsRaceNumber,
            track: nextRace.track,
            date: nextRace.date,
            isRaceDay: isRaceDay(nextRace.date),
          }
        : null,
      debug: raceDebug,
      selectionReason,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({
      ...fallbackPayload,
      error: e.message || "YouTube broadcasts fetch failed",
    });
  }
}
