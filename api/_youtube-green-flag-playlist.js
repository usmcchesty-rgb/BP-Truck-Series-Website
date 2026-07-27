/**
 * Green Flag TV playlist via YouTube Data API (full pagination; RSS is capped ~15 items).
 */

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
/** Each playlistItems.list call costs 1 quota unit (default daily budget 10,000). */
export const PLAYLIST_ITEMS_LIST_QUOTA_UNITS = 1;

function parseVideoRaceNumber(title) {
  const match = String(title || "").match(/\bS(\d+)\s*R\s*(\d+)\b/i);
  if (!match) return null;
  const raceNumber = Number(match[2]);
  return Number.isFinite(raceNumber) && raceNumber > 0 ? raceNumber : null;
}

function parsePublishedTimestamp(published) {
  const ms = Date.parse(String(published || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

export function mapYouTubeDataApiPlaylistItem(item) {
  const snippet = item?.snippet || {};
  const contentDetails = item?.contentDetails || {};
  const videoId = contentDetails.videoId || snippet.resourceId?.videoId;
  if (!videoId) return null;

  const title = String(snippet.title || "").trim();
  const published =
    contentDetails.videoPublishedAt || snippet.publishedAt || "";
  const thumbnail =
    snippet.thumbnails?.maxres?.url ||
    snippet.thumbnails?.high?.url ||
    snippet.thumbnails?.medium?.url ||
    snippet.thumbnails?.default?.url ||
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return {
    videoId: String(videoId),
    title,
    published,
    publishedAtMs: parsePublishedTimestamp(published),
    link: `https://www.youtube.com/watch?v=${videoId}`,
    thumbnail,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    raceNumber: parseVideoRaceNumber(title),
    playlistItemId: item.id || null,
    position: snippet.position,
  };
}

export function sortPlaylistVideosByPublicationDesc(videos = []) {
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

export async function fetchGreenFlagPlaylistFromYouTubeApi(playlistId, apiKey) {
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured.");
  }
  if (!playlistId) {
    throw new Error("playlistId is required.");
  }

  const rawItems = [];
  let apiPagesFetched = 0;
  let pageToken = undefined;

  do {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: { "user-agent": "BP-Truck-Series-Website/1.0" },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        data?.error?.message ||
        `YouTube playlistItems.list failed (${response.status})`;
      throw new Error(message);
    }

    apiPagesFetched += 1;
    rawItems.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  const videos = sortPlaylistVideosByPublicationDesc(
    rawItems.map(mapYouTubeDataApiPlaylistItem).filter(Boolean)
  );

  const newestUpload = videos[0]
    ? {
        videoId: videos[0].videoId,
        title: videos[0].title,
        published: videos[0].published,
        publishedAtMs: videos[0].publishedAtMs,
        raceNumber: videos[0].raceNumber,
      }
    : null;

  return {
    videos,
    fetchDiagnostics: {
      dataSource: "youtube-data-api",
      totalPlaylistItems: videos.length,
      apiPagesFetched,
      quotaCostUnits: apiPagesFetched * PLAYLIST_ITEMS_LIST_QUOTA_UNITS,
      newestUpload,
    },
  };
}
