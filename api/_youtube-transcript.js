import * as cheerio from 'cheerio';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const GREEN_FLAG_PLAYLIST_ID = 'PL4aFms0YBw6_uE-yoYgOFDtaNcN9ozPIO';
const GREEN_FLAG_RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${GREEN_FLAG_PLAYLIST_ID}`;
export const TRANSCRIPT_FETCHER_VERSION = '2.2-login-required-bypass';

function decodeHtml(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unescapeJsonUrl(value) {
  return String(value || '')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function extractCaptionTracks(html) {
  const marker = '"captionTracks":';
  const start = html.indexOf(marker);
  if (start === -1) return [];

  const arrayStart = start + marker.length;
  if (html[arrayStart] !== '[') return [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart; i < html.length; i += 1) {
    const char = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(arrayStart, i + 1));
        } catch {
          return [];
        }
      }
    }
  }

  return [];
}

function extractInnertubeApiKey(html) {
  const match = String(html || '').match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  return match?.[1] || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
}

function extractYtInitialPlayerResponse(html) {
  return (
    extractJsonAfterMarker(String(html || ''), 'ytInitialPlayerResponse = ') ||
    extractJsonAfterMarker(String(html || ''), 'var ytInitialPlayerResponse = ')
  );
}

function extractJsonAfterMarker(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return null;

  const jsonStart = start + marker.length;
  const openChar = html[jsonStart];
  if (openChar !== '{' && openChar !== '[') return null;

  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = jsonStart; i < html.length; i += 1) {
    const char = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function buildInnertubeClientContext(client) {
  const context = {
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    hl: client.hl || 'en',
    gl: client.gl || 'US',
  };

  if (client.androidSdkVersion != null) context.androidSdkVersion = client.androidSdkVersion;
  if (client.deviceMake) context.deviceMake = client.deviceMake;
  if (client.deviceModel) context.deviceModel = client.deviceModel;
  if (client.osName) context.osName = client.osName;
  if (client.osVersion) context.osVersion = client.osVersion;
  if (client.platform) context.platform = client.platform;
  if (client.clientUserAgent) context.userAgent = client.clientUserAgent;
  if (client.contentCheckOk === true) context.contentCheckOk = true;
  if (client.racyCheckOk === true) context.racyCheckOk = true;

  return context;
}

const INNERTUBE_CLIENTS = [
  {
    name: 'ANDROID',
    clientNameHeader: '3',
    userAgent: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    androidSdkVersion: 30,
    contentCheckOk: true,
    racyCheckOk: true,
  },
  {
    name: 'IOS',
    clientNameHeader: '5',
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
    clientName: 'IOS',
    clientVersion: '20.10.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone14,3',
    osName: 'iPhone',
    osVersion: '15_6',
    clientUserAgent: 'com.google.ios.youtube/20.10.4',
    contentCheckOk: true,
    racyCheckOk: true,
  },
  {
    name: 'TVHTML5',
    clientNameHeader: '7',
    userAgent:
      'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version/glass-future/24.260000000000000',
    clientName: 'TVHTML5',
    clientVersion: '7.20250327.00.00',
    contentCheckOk: true,
    racyCheckOk: true,
  },
  {
    name: 'MWEB',
    clientNameHeader: '2',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    clientName: 'MWEB',
    clientVersion: '2.20250210.01.00',
    contentCheckOk: true,
    racyCheckOk: true,
  },
];

function summarizeCaptionTrack(track) {
  const baseUrl = unescapeJsonUrl(track?.baseUrl || '');
  const isAutoGenerated = track?.kind === 'asr' || String(track?.vssId || '').startsWith('a.');

  return {
    languageCode: track?.languageCode || null,
    name:
      track?.name?.simpleText ||
      track?.name?.runs?.map((run) => run.text).join('') ||
      null,
    kind: track?.kind || null,
    vssId: track?.vssId || null,
    isAutoGenerated,
    isManual: !isAutoGenerated,
    hasBaseUrl: Boolean(baseUrl),
    requiresPoToken: baseUrl.includes('exp=xpe'),
  };
}

function analyzeCaptionTracks(tracks) {
  const captionTracks = (Array.isArray(tracks) ? tracks : []).map(summarizeCaptionTrack);

  return {
    captionTrackCount: captionTracks.length,
    captionTrackLanguages: [
      ...new Set(captionTracks.map((track) => track.languageCode).filter(Boolean)),
    ],
    autoGeneratedTracksFound: captionTracks.filter((track) => track.isAutoGenerated).length,
    manualTracksFound: captionTracks.filter((track) => track.isManual).length,
    captionTracks,
  };
}

function selectPreferredCaptionTrack(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  const englishManual = list.find(
    (track) =>
      String(track.languageCode || '').startsWith('en') &&
      track.kind !== 'asr' &&
      !String(track.vssId || '').startsWith('a.')
  );
  const englishTrack = list.find((track) => String(track.languageCode || '').startsWith('en'));
  return englishManual || englishTrack || list[0] || null;
}

function buildCaptionDownloadUrl(baseUrl, fmt = 'json3') {
  const url = new URL(unescapeJsonUrl(baseUrl));
  url.searchParams.delete('fmt');
  url.searchParams.set('fmt', fmt);
  return url.toString();
}

function applyPlayerResponseToAttempt(attempt, playerResponse) {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  attempt.playabilityStatus = playerResponse?.playabilityStatus?.status || null;
  attempt.playabilityReason = playerResponse?.playabilityStatus?.reason || null;
  attempt.hasCaptionsObject = Boolean(playerResponse?.captions);
  attempt.tracks = tracks;
  Object.assign(attempt, analyzeCaptionTracks(tracks));
  attempt.captionsPresentDespiteLoginRequired =
    attempt.playabilityStatus === 'LOGIN_REQUIRED' && tracks.length > 0;

  if (tracks.length > 0) {
    attempt.error =
      attempt.playabilityStatus === 'LOGIN_REQUIRED'
        ? 'tracks-found-despite-login-required'
        : null;
    return;
  }

  if (attempt.playabilityStatus === 'LOGIN_REQUIRED') {
    attempt.error = `login-required-no-tracks: ${attempt.playabilityReason || 'unknown'}`;
    return;
  }

  attempt.error = `no-tracks-playability-${attempt.playabilityStatus || 'unknown'}`;
}

async function fetchInnertubeCaptionTracks(videoId, client) {
  const clientContext = buildInnertubeClientContext(client);
  const attempt = {
    source: client.name,
    playerResponseSource: client.name,
    attempted: true,
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    contentCheckOk: client.contentCheckOk === true,
    racyCheckOk: client.racyCheckOk === true,
    watchPageStatus: null,
    watchPageSucceeded: false,
    watchPageHtmlLength: 0,
    apiKeyPresent: false,
    innertubeRequestStatus: null,
    innertubeRequestSucceeded: false,
    playabilityStatus: null,
    playabilityReason: null,
    hasCaptionsObject: false,
    captionsPresentDespiteLoginRequired: false,
    error: null,
    tracks: [],
    ...analyzeCaptionTracks([]),
  };

  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: {
        ...FETCH_HEADERS,
        'User-Agent': client.userAgent,
      },
    });

    attempt.watchPageStatus = watchRes.status;
    attempt.watchPageSucceeded = watchRes.ok;

    if (!watchRes.ok) {
      attempt.error = `watch-page-http-${watchRes.status}`;
      return attempt;
    }

    const html = await watchRes.text();
    attempt.watchPageHtmlLength = html.length;
    const apiKey = extractInnertubeApiKey(html);
    attempt.apiKeyPresent = Boolean(apiKey);

    const cookieHeader = (watchRes.headers.getSetCookie?.() || [])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': client.userAgent,
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Youtube-Client-Name': client.clientNameHeader,
        'X-Youtube-Client-Version': client.clientVersion,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify({
        context: {
          client: clientContext,
        },
        videoId,
      }),
    });

    attempt.innertubeRequestStatus = playerRes.status;
    attempt.innertubeRequestSucceeded = playerRes.ok;

    if (!playerRes.ok) {
      attempt.error = `innertube-player-http-${playerRes.status}`;
      return attempt;
    }

    let data;
    try {
      data = await playerRes.json();
    } catch (error) {
      attempt.error = `innertube-player-json-parse-failed: ${error?.message || error}`;
      return attempt;
    }

    applyPlayerResponseToAttempt(attempt, data);
  } catch (error) {
    attempt.error = `exception: ${error?.message || error}`;
  }

  return attempt;
}

async function fetchWatchPagePlayerResponseCaptionTracks(videoId) {
  const attempt = {
    source: 'WEB_WATCH_PLAYER',
    playerResponseSource: 'WEB_WATCH_PLAYER',
    attempted: true,
    clientName: 'WEB',
    clientVersion: 'watch-page-embedded',
    contentCheckOk: null,
    racyCheckOk: null,
    watchPageStatus: null,
    watchPageSucceeded: false,
    watchPageHtmlLength: 0,
    captionTracksMarkerFound: false,
    apiKeyPresent: false,
    innertubeRequestStatus: null,
    innertubeRequestSucceeded: false,
    playabilityStatus: null,
    playabilityReason: null,
    hasCaptionsObject: false,
    captionsPresentDespiteLoginRequired: false,
    error: null,
    tracks: [],
    ...analyzeCaptionTracks([]),
  };

  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: FETCH_HEADERS,
    });

    attempt.watchPageStatus = watchRes.status;
    attempt.watchPageSucceeded = watchRes.ok;

    if (!watchRes.ok) {
      attempt.error = `watch-page-http-${watchRes.status}`;
      return attempt;
    }

    const html = await watchRes.text();
    attempt.watchPageHtmlLength = html.length;
    attempt.captionTracksMarkerFound = html.includes('"captionTracks":');
    attempt.apiKeyPresent = Boolean(extractInnertubeApiKey(html));

    const playerResponse = extractYtInitialPlayerResponse(html);
    if (!playerResponse) {
      attempt.error = 'ytInitialPlayerResponse-not-found';
      return attempt;
    }

    applyPlayerResponseToAttempt(attempt, playerResponse);
  } catch (error) {
    attempt.error = `exception: ${error?.message || error}`;
  }

  return attempt;
}

async function fetchWatchPageCaptionTracks(videoId) {
  const attempt = {
    source: 'WEB_WATCH_PAGE',
    playerResponseSource: 'WEB_WATCH_PAGE',
    attempted: true,
    clientName: 'WEB',
    clientVersion: 'watch-page-regex',
    contentCheckOk: null,
    racyCheckOk: null,
    watchPageStatus: null,
    watchPageSucceeded: false,
    watchPageHtmlLength: 0,
    captionTracksMarkerFound: false,
    apiKeyPresent: false,
    innertubeRequestStatus: null,
    innertubeRequestSucceeded: false,
    playabilityStatus: null,
    playabilityReason: null,
    hasCaptionsObject: false,
    captionsPresentDespiteLoginRequired: false,
    error: null,
    tracks: [],
    ...analyzeCaptionTracks([]),
  };

  try {
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: FETCH_HEADERS,
    });

    attempt.watchPageStatus = watchRes.status;
    attempt.watchPageSucceeded = watchRes.ok;

    if (!watchRes.ok) {
      attempt.error = `watch-page-http-${watchRes.status}`;
      return attempt;
    }

    const html = await watchRes.text();
    attempt.watchPageHtmlLength = html.length;
    attempt.captionTracksMarkerFound = html.includes('"captionTracks":');
    attempt.apiKeyPresent = Boolean(extractInnertubeApiKey(html));

    let tracks = extractCaptionTracks(html);
    if (!tracks.length) {
      const playerResponse = extractYtInitialPlayerResponse(html);
      tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (tracks.length) {
        attempt.playerResponseSource = 'WEB_WATCH_PAGE_FALLBACK_PLAYER';
        attempt.playabilityStatus = playerResponse?.playabilityStatus?.status || null;
        attempt.playabilityReason = playerResponse?.playabilityStatus?.reason || null;
        attempt.hasCaptionsObject = Boolean(playerResponse?.captions);
      }
    }

    attempt.tracks = tracks;
    Object.assign(attempt, analyzeCaptionTracks(tracks));
    attempt.captionsPresentDespiteLoginRequired =
      attempt.playabilityStatus === 'LOGIN_REQUIRED' && tracks.length > 0;
    attempt.error = tracks.length ? null : 'no-caption-tracks-in-watch-page';
  } catch (error) {
    attempt.error = `exception: ${error?.message || error}`;
  }

  return attempt;
}

function summarizeCaptionDiscoveryAttempt(attempt) {
  return {
    source: attempt.source,
    playerResponseSource: attempt.playerResponseSource,
    attempted: attempt.attempted === true,
    clientName: attempt.clientName ?? null,
    clientVersion: attempt.clientVersion ?? null,
    contentCheckOk: attempt.contentCheckOk ?? null,
    racyCheckOk: attempt.racyCheckOk ?? null,
    watchPageStatus: attempt.watchPageStatus ?? null,
    watchPageSucceeded: attempt.watchPageSucceeded === true,
    watchPageHtmlLength: attempt.watchPageHtmlLength ?? 0,
    captionTracksMarkerFound: attempt.captionTracksMarkerFound ?? null,
    apiKeyPresent: attempt.apiKeyPresent === true,
    innertubeRequestStatus: attempt.innertubeRequestStatus ?? null,
    innertubeRequestSucceeded: attempt.innertubeRequestSucceeded === true,
    playabilityStatus: attempt.playabilityStatus ?? null,
    playabilityReason: attempt.playabilityReason ?? null,
    hasCaptionsObject: attempt.hasCaptionsObject === true,
    captionsPresentDespiteLoginRequired: attempt.captionsPresentDespiteLoginRequired === true,
    error: attempt.error ?? null,
    captionTrackCount: attempt.captionTrackCount ?? 0,
    captionTrackLanguages: attempt.captionTrackLanguages ?? [],
    autoGeneratedTracksFound: attempt.autoGeneratedTracksFound ?? 0,
    manualTracksFound: attempt.manualTracksFound ?? 0,
    captionTracks: attempt.captionTracks ?? [],
  };
}

function buildCaptionDiscoverySummary(captionSourcesAttempted) {
  const attempts = Array.isArray(captionSourcesAttempted) ? captionSourcesAttempted : [];
  const bySource = Object.fromEntries(attempts.map((attempt) => [attempt.source, attempt]));
  const android = bySource.ANDROID;
  const ios = bySource.IOS;
  const tvhtml5 = bySource.TVHTML5;
  const mweb = bySource.MWEB;
  const webWatchPlayer = bySource.WEB_WATCH_PLAYER;
  const web = bySource.WEB_WATCH_PAGE;
  const bestAttempt = [...attempts].sort(
    (a, b) => (b.captionTrackCount || 0) - (a.captionTrackCount || 0)
  )[0];
  const successfulInnertube = attempts.find((attempt) => attempt.innertubeRequestSucceeded);
  const loginRequiredAttempts = attempts.filter(
    (attempt) => attempt.playabilityStatus === 'LOGIN_REQUIRED'
  );

  return {
    transcriptFetcherVersion: TRANSCRIPT_FETCHER_VERSION,
    attemptedANDROID: android?.attempted === true,
    attemptedIOS: ios?.attempted === true,
    attemptedTVHTML5: tvhtml5?.attempted === true,
    attemptedMWEB: mweb?.attempted === true,
    attemptedWEB:
      webWatchPlayer?.attempted === true || web?.attempted === true,
    captionDiscoverySource: bestAttempt?.captionTrackCount
      ? bestAttempt.source
      : attempts[attempts.length - 1]?.source || null,
    playerResponseSource:
      bestAttempt?.playerResponseSource || successfulInnertube?.playerResponseSource || null,
    innertubeRequestSucceeded: attempts.some((attempt) => attempt.innertubeRequestSucceeded),
    innertubeRequestStatus:
      android?.innertubeRequestStatus ??
      ios?.innertubeRequestStatus ??
      tvhtml5?.innertubeRequestStatus ??
      mweb?.innertubeRequestStatus ??
      null,
    loginRequiredSeen: loginRequiredAttempts.length > 0,
    loginRequiredTrackCount: loginRequiredAttempts.reduce(
      (max, attempt) => Math.max(max, attempt.captionTrackCount || 0),
      0
    ),
    androidClientName: android?.clientName ?? null,
    androidClientVersion: android?.clientVersion ?? null,
    iosClientName: ios?.clientName ?? null,
    iosClientVersion: ios?.clientVersion ?? null,
  };
}

function applyBestCaptionTrackAnalysis(result, attempt) {
  if ((attempt?.captionTrackCount || 0) >= (result.captionTrackCount || 0)) {
    result.captionTrackCount = attempt.captionTrackCount ?? 0;
    result.captionTrackLanguages = attempt.captionTrackLanguages ?? [];
    result.autoGeneratedTracksFound = attempt.autoGeneratedTracksFound ?? 0;
    result.manualTracksFound = attempt.manualTracksFound ?? 0;
    result.captionTracks = attempt.captionTracks ?? [];
  }
}

async function downloadCaptionTrackText(baseUrl, videoId, userAgent) {
  const formats = ['json3', 'srv3', 'vtt'];

  for (const fmt of formats) {
    const url = buildCaptionDownloadUrl(baseUrl, fmt);

    let captionRes;
    try {
      captionRes = await fetch(url, {
        headers: {
          ...FETCH_HEADERS,
          'User-Agent': userAgent,
          Referer: `https://www.youtube.com/watch?v=${videoId}`,
        },
      });
    } catch (error) {
      continue;
    }

    if (!captionRes.ok) continue;

    const body = await captionRes.text();
    const text = parseTimedText(body);
    if (text.length >= 100) {
      return {
        text,
        fmt,
        bodyLength: body.length,
        requiresPoToken: url.includes('exp=xpe'),
      };
    }
  }

  return null;
}

function parseTimedText(body) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed);
      return decodeHtml(
        (data.events || [])
          .flatMap((event) => (event.segs || []).map((seg) => seg.utf8 || ''))
          .join(' ')
      );
    } catch {
      return '';
    }
  }

  const parts = [];
  for (const match of trimmed.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)) {
    parts.push(decodeHtml(match[1]));
  }

  return parts.join(' ').trim();
}

export function parseVideoRaceNumber(title) {
  const match = String(title || '').match(/\bS11\s*R\s*(\d+)\b/i);
  if (!match) return null;
  const raceNumber = Number(match[1]);
  return Number.isFinite(raceNumber) && raceNumber > 0 ? raceNumber : null;
}

function titleMatchesOfficialRaceNumber(title, requestedRaceNumber) {
  const requested = Number(requestedRaceNumber);
  if (!Number.isFinite(requested) || requested < 1) return false;
  const pattern = new RegExp(`\\bS11\\s*R\\s*${requested}\\b`, 'i');
  return pattern.test(String(title || ''));
}

export async function fetchGreenFlagPlaylistVideos() {
  const res = await fetch(GREEN_FLAG_RSS_URL, {
    headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
  });

  if (!res.ok) return [];

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true, decodeEntities: true });
  const videos = [];

  $('entry').each((_, entry) => {
    const $entry = $(entry);
    const videoId =
      $entry.find('yt\\:videoId').first().text().trim() ||
      $entry.find('videoId').first().text().trim();
    if (!videoId) return;

    const title = $entry.find('title').first().text().trim();
    const published = $entry.find('published').first().text().trim();

    videos.push({
      videoId,
      title,
      published,
      raceNumber: parseVideoRaceNumber(title),
    });
  });

  return videos.sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
  );
}

export function selectBroadcastVideoForRankings(videos, requestedRaceNumber) {
  const requested = Number(requestedRaceNumber);
  const baseSelection = {
    video: null,
    requestedRaceNumber: Number.isFinite(requested) ? requested : null,
    selectedVideoRaceNumber: null,
    selectedVideoTitle: null,
    selectionMethod: 'not-found',
    nonPointsAdjustmentApplied: false,
  };

  if (!Number.isFinite(requested) || requested < 1) {
    return { ...baseSelection, selectionMethod: 'invalid-race-number' };
  }

  const list = Array.isArray(videos) ? videos : [];

  const exactRaceNumber = list.find(
    (video) => Number(video.raceNumber) === requested
  );
  if (exactRaceNumber) {
    return {
      video: exactRaceNumber,
      requestedRaceNumber: requested,
      selectedVideoRaceNumber: exactRaceNumber.raceNumber,
      selectedVideoTitle: exactRaceNumber.title || null,
      selectionMethod: 'exact-race-number',
      nonPointsAdjustmentApplied: false,
    };
  }

  const exactTitle = list.find((video) =>
    titleMatchesOfficialRaceNumber(video.title, requested)
  );
  if (exactTitle) {
    return {
      video: exactTitle,
      requestedRaceNumber: requested,
      selectedVideoRaceNumber: parseVideoRaceNumber(exactTitle.title) ?? requested,
      selectedVideoTitle: exactTitle.title || null,
      selectionMethod: 'exact-title-match',
      nonPointsAdjustmentApplied: false,
    };
  }

  return baseSelection;
}

export async function fetchYouTubeTranscript(videoId) {
  const logTag = '[power-rankings-transcript]';
  const result = {
    transcript: null,
    transcriptLength: 0,
    fetchAttempted: false,
    failureReason: null,
    debugReason: 'transcript-fetch-failed',
    captionTrackCount: 0,
    captionTrackLanguages: [],
    autoGeneratedTracksFound: 0,
    manualTracksFound: 0,
    captionTracks: [],
    hasEnglishTrack: false,
    selectedLanguageCode: null,
    selectedTrackSource: null,
    selectedTrackIsAutoGenerated: null,
    captionDownloadFormat: null,
    requiresPoToken: false,
    captionSourcesAttempted: [],
  };

  if (!videoId) {
    result.failureReason = 'missing-video-id';
    result.debugReason = 'transcript-fetch-failed';
    return result;
  }

  result.fetchAttempted = true;

  const sourceAttempts = [
    {
      type: 'watch-player',
      client: {
        name: 'WEB_WATCH_PLAYER',
        userAgent: FETCH_HEADERS['User-Agent'],
      },
      loader: () => fetchWatchPagePlayerResponseCaptionTracks(videoId),
    },
    ...INNERTUBE_CLIENTS.map((client) => ({
      type: 'innertube',
      client,
      loader: () => fetchInnertubeCaptionTracks(videoId, client),
    })),
    {
      type: 'watch-page',
      client: {
        name: 'WEB_WATCH_PAGE',
        userAgent: FETCH_HEADERS['User-Agent'],
      },
      loader: () => fetchWatchPageCaptionTracks(videoId),
    },
  ];

  let lastSelectedTrack = null;

  for (const attempt of sourceAttempts) {
    const sourceResult = await attempt.loader();
    const attemptSummary = summarizeCaptionDiscoveryAttempt(sourceResult);
    const selectedTrack = selectPreferredCaptionTrack(sourceResult.tracks);

    result.captionSourcesAttempted.push(attemptSummary);

    console.log(logTag, 'caption discovery attempt', {
      videoId,
      ...attemptSummary,
    });

    applyBestCaptionTrackAnalysis(result, attemptSummary);

    if (!sourceResult.tracks.length) {
      continue;
    }

    lastSelectedTrack = selectedTrack;
    result.hasEnglishTrack = sourceResult.tracks.some((track) =>
      String(track.languageCode || '').startsWith('en')
    );
    result.selectedLanguageCode = selectedTrack?.languageCode || null;
    result.selectedTrackSource = sourceResult.source;
    result.selectedTrackIsAutoGenerated =
      selectedTrack?.kind === 'asr' || String(selectedTrack?.vssId || '').startsWith('a.');

    const baseUrl = unescapeJsonUrl(selectedTrack?.baseUrl || '');
    if (!baseUrl) {
      result.failureReason = 'caption-base-url-missing';
      continue;
    }

    result.requiresPoToken = baseUrl.includes('exp=xpe');

    const downloaded = await downloadCaptionTrackText(
      baseUrl,
      videoId,
      attempt.client.userAgent
    );

    console.log(logTag, 'caption download attempt', {
      videoId,
      source: sourceResult.source,
      selectedLanguageCode: result.selectedLanguageCode,
      selectedTrackIsAutoGenerated: result.selectedTrackIsAutoGenerated,
      requiresPoToken: result.requiresPoToken,
      downloaded: downloaded
        ? {
            fmt: downloaded.fmt,
            bodyLength: downloaded.bodyLength,
            parsedLength: downloaded.text.length,
          }
        : null,
    });

    if (downloaded?.text) {
      Object.assign(result, buildCaptionDiscoverySummary(result.captionSourcesAttempted));
      result.transcript = downloaded.text;
      result.transcriptLength = downloaded.text.length;
      result.captionDownloadFormat = downloaded.fmt;
      result.failureReason = downloaded.requiresPoToken ? 'used-po-token-protected-url' : null;
      result.debugReason = null;
      console.log(logTag, 'caption discovery summary', {
        videoId,
        ...buildCaptionDiscoverySummary(result.captionSourcesAttempted),
        captionTrackCount: result.captionTrackCount,
        transcriptLength: result.transcriptLength,
      });
      return result;
    }

    if (result.requiresPoToken) {
      result.failureReason = 'po-token-required-exp-xpe-empty-body';
      result.debugReason = 'transcript-disabled';
    } else {
      result.failureReason = 'caption-text-empty';
      result.debugReason = 'transcript-too-short';
    }
  }

  Object.assign(result, buildCaptionDiscoverySummary(result.captionSourcesAttempted));

  if (result.captionTrackCount === 0) {
    result.failureReason = result.failureReason || 'no-caption-tracks-found';
    result.debugReason = 'transcript-disabled';
  } else if (!result.failureReason) {
    result.failureReason = lastSelectedTrack ? 'caption-download-empty' : 'caption-track-unusable';
    result.debugReason = result.requiresPoToken ? 'transcript-disabled' : 'transcript-too-short';
  }

  console.warn(logTag, 'caption extraction failed', {
    videoId,
    failureReason: result.failureReason,
    debugReason: result.debugReason,
    requiresPoToken: result.requiresPoToken,
    selectedTrackSource: result.selectedTrackSource,
    ...buildCaptionDiscoverySummary(result.captionSourcesAttempted),
    captionSourcesAttempted: result.captionSourcesAttempted,
    captionTracks: result.captionTracks,
  });

  return result;
}

const KEYWORD_PATTERNS = [
  /\bwreck/i,
  /\bcrash/i,
  /\bincident/i,
  /\bspin/i,
  /\bdamage/i,
  /\bcaution/i,
  /\brestart/i,
  /\blead(?:er|ing)?\b/i,
  /\bpass(?:ing|ed|es)?\b/i,
  /\bwinner/i,
  /\bwon\b/i,
  /\bwin(?:s|ning)?\b/i,
  /\bdominat/i,
  /\bplayoff/i,
  /\bcutline/i,
  /\bpoints\b/i,
  /\bfast/i,
  /\bunlucky/i,
  /\bbad luck/i,
  /\brun(?:ning)? well/i,
  /\btop\s+(?:five|5|ten|10)/i,
  /\bpole\b/i,
  /\bstage/i,
  /\bfinal lap/i,
];

function driverMatchScore(sentence, driver) {
  const lower = sentence.toLowerCase();
  const fullName = String(driver.driverName || '').toLowerCase().trim();
  if (!fullName) return 0;

  if (lower.includes(fullName)) return 6;

  const tokens = fullName.split(/\s+/).filter((part) => part.length > 2);
  return tokens.reduce((score, token) => (lower.includes(token) ? score + 2 : score), 0);
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 18);
}

export function summarizeTranscriptForRankings(transcript, drivers, maxChars = 2800) {
  if (!transcript) {
    return {
      summary: '',
      highlightCount: 0,
      fullLength: 0,
    };
  }

  const sentences = splitSentences(transcript);
  const scored = sentences.map((sentence) => {
    let score = 0;

    for (const pattern of KEYWORD_PATTERNS) {
      if (pattern.test(sentence)) score += 2;
    }

    for (const driver of drivers || []) {
      score += driverMatchScore(sentence, driver);
    }

    return { sentence, score };
  });

  const selected = [];
  const seen = new Set();
  let length = 0;

  const addSentence = (sentence) => {
    const normalized = sentence.trim();
    if (!normalized || seen.has(normalized)) return false;
    if (length + normalized.length > maxChars) return false;
    seen.add(normalized);
    selected.push(normalized);
    length += normalized.length + 1;
    return true;
  };

  for (const item of scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score)) {
    addSentence(item.sentence);
    if (length >= maxChars) break;
  }

  if (selected.length < 8) {
    for (const sentence of sentences.slice(-30)) {
      if (selected.length >= 12) break;
      if (KEYWORD_PATTERNS.some((pattern) => pattern.test(sentence))) {
        addSentence(sentence);
      }
    }
  }

  if (selected.length < 6) {
    for (const sentence of sentences) {
      if (selected.length >= 10) break;
      addSentence(sentence);
    }
  }

  return {
    summary: selected.join(' '),
    highlightCount: selected.length,
    fullLength: transcript.length,
  };
}
