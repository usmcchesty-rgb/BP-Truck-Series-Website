import * as cheerio from 'cheerio';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

const GREEN_FLAG_PLAYLIST_ID = 'PL4aFms0YBw6_uE-yoYgOFDtaNcN9ozPIO';
const GREEN_FLAG_RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${GREEN_FLAG_PLAYLIST_ID}`;

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
  const result = {
    transcript: null,
    transcriptLength: 0,
    fetchAttempted: false,
    failureReason: null,
    debugReason: 'transcript-fetch-failed',
    captionTrackCount: 0,
    hasEnglishTrack: false,
    selectedLanguageCode: null,
  };

  if (!videoId) {
    result.failureReason = 'missing-video-id';
    result.debugReason = 'transcript-fetch-failed';
    return result;
  }

  result.fetchAttempted = true;

  let watchRes;
  try {
    watchRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: FETCH_HEADERS,
    });
  } catch (error) {
    result.failureReason = `watch-page-error: ${error?.message || error}`;
    result.debugReason = 'transcript-fetch-failed';
    return result;
  }

  if (!watchRes.ok) {
    result.failureReason = `watch-page-http-${watchRes.status}`;
    result.debugReason = 'transcript-fetch-failed';
    return result;
  }

  const html = await watchRes.text();
  const captionTracks = extractCaptionTracks(html);
  result.captionTrackCount = captionTracks.length;

  if (!captionTracks.length) {
    result.failureReason = 'no-caption-tracks-in-watch-page';
    result.debugReason = 'transcript-disabled';
    return result;
  }

  const englishTrack = captionTracks.find((item) =>
    String(item.languageCode || '').startsWith('en')
  );
  result.hasEnglishTrack = Boolean(englishTrack);

  const track = englishTrack || captionTracks[0];
  result.selectedLanguageCode = track?.languageCode || null;

  const baseUrl = unescapeJsonUrl(track?.baseUrl);
  if (!baseUrl) {
    result.failureReason = englishTrack
      ? 'english-caption-base-url-missing'
      : 'caption-base-url-missing';
    result.debugReason = englishTrack ? 'transcript-disabled' : 'transcript-language-not-found';
    return result;
  }

  const captionUrl = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;

  let captionRes;
  try {
    captionRes = await fetch(captionUrl, { headers: FETCH_HEADERS });
  } catch (error) {
    result.failureReason = `caption-download-error: ${error?.message || error}`;
    result.debugReason = 'transcript-fetch-failed';
    return result;
  }

  if (!captionRes.ok) {
    result.failureReason = `caption-download-http-${captionRes.status}`;
    result.debugReason = 'transcript-fetch-failed';
    return result;
  }

  const text = parseTimedText(await captionRes.text());
  result.transcriptLength = text.length;

  if (!text) {
    result.failureReason = englishTrack
      ? 'caption-text-empty'
      : 'non-english-caption-text-empty';
    result.debugReason = englishTrack ? 'transcript-too-short' : 'transcript-language-not-found';
    return result;
  }

  if (text.length < 100) {
    result.failureReason = `caption-text-too-short-${text.length}-chars`;
    result.debugReason = 'transcript-too-short';
    return result;
  }

  if (!englishTrack) {
    result.failureReason = 'used-non-english-caption-track';
  }

  result.transcript = text;
  result.debugReason = null;
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
