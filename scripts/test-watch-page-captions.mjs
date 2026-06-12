const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

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
  for (let i = jsonStart; i < html.length; i++) {
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
    if (char === openChar) depth++;
    if (char === closeChar) {
      depth--;
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

const videoId = process.argv[2] || 'LKixVmv-QbI';
const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: FETCH_HEADERS });
const html = await watchRes.text();
const player = extractJsonAfterMarker(html, 'ytInitialPlayerResponse = ');
const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
console.log('watch page playability', player?.playabilityStatus?.status);
console.log('watch page caption tracks', tracks.length);
console.log('captionTracks marker count', (html.match(/"captionTracks":/g) || []).length);
