const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

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

export async function fetchYouTubeTranscript(videoId) {
  if (!videoId) return null;

  const watchRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: FETCH_HEADERS,
  });

  if (!watchRes.ok) return null;

  const html = await watchRes.text();
  const captionTracks = extractCaptionTracks(html);
  if (!captionTracks.length) return null;

  const track =
    captionTracks.find((item) => String(item.languageCode || '').startsWith('en')) ||
    captionTracks[0];

  const baseUrl = unescapeJsonUrl(track.baseUrl);
  if (!baseUrl) return null;

  const captionUrl = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;
  const captionRes = await fetch(captionUrl, { headers: FETCH_HEADERS });
  if (!captionRes.ok) return null;

  const text = parseTimedText(await captionRes.text());
  return text || null;
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

export async function fetchYoutubeBroadcasts(req) {
  try {
    const host = req.headers.host || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const res = await fetch(`${proto}://${host}/api/youtube-broadcasts`, {
      headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export function selectBroadcastVideo(broadcastsData, raceNumber) {
  const videos = broadcastsData?.videos || [];
  if (!videos.length) return broadcastsData?.featured || null;

  const exact = videos.find((video) => Number(video.raceNumber) === Number(raceNumber));
  if (exact) return exact;

  const completed = videos
    .filter(
      (video) =>
        video.raceNumber != null && Number(video.raceNumber) <= Number(raceNumber)
    )
    .sort((a, b) => Number(b.raceNumber) - Number(a.raceNumber));

  if (completed.length) return completed[0];

  return broadcastsData?.featured || videos[0] || null;
}
