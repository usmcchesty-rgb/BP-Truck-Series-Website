const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function unescapeJsonUrl(value) {
  return String(value || '')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
}

function extractInnertubeApiKey(html) {
  const match = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  return match?.[1] || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
}

async function fetchPlayerResponse(videoId, clientName, clientVersion, userAgent) {
  const watchRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { ...FETCH_HEADERS, 'User-Agent': userAgent },
  });
  const html = await watchRes.text();
  const apiKey = extractInnertubeApiKey(html);

  const playerRes = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Youtube-Client-Name': clientName === 'ANDROID' ? '3' : '1',
      'X-Youtube-Client-Version': clientVersion,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName,
          clientVersion,
          hl: 'en',
          gl: 'US',
        },
      },
      videoId,
    }),
  });

  const data = await playerRes.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  return { status: playerRes.status, apiKey, tracks, playability: data?.playabilityStatus?.status };
}

function buildCaptionUrl(baseUrl, fmt = 'json3') {
  const url = new URL(unescapeJsonUrl(baseUrl));
  url.searchParams.delete('fmt');
  url.searchParams.set('fmt', fmt);
  return url.toString();
}

const videoId = process.argv[2] || 'LKixVmv-QbI';

for (const client of [
  { clientName: 'WEB', clientVersion: '2.20250210.01.00', userAgent: FETCH_HEADERS['User-Agent'] },
  {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    userAgent:
      'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
  },
  {
    clientName: 'IOS',
    clientVersion: '20.10.4',
    userAgent:
      'com.google.ios.youtube/20.10.4 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
  },
]) {
  const result = await fetchPlayerResponse(
    videoId,
    client.clientName,
    client.clientVersion,
    client.userAgent
  );
  console.log('\nCLIENT', client.clientName, 'status', result.status, 'playability', result.playability, 'tracks', result.tracks.length);

  for (const track of result.tracks.slice(0, 3)) {
    const baseUrl = track.baseUrl || '';
    console.log(
      ' track',
      JSON.stringify({
        languageCode: track.languageCode,
        kind: track.kind,
        vssId: track.vssId,
        hasExpXpe: baseUrl.includes('exp=xpe'),
        hasBaseUrl: Boolean(baseUrl),
      })
    );

    if (!baseUrl) continue;

    for (const fmt of ['json3', 'srv3', 'vtt']) {
      const url = buildCaptionUrl(baseUrl, fmt);
      const res = await fetch(url, {
        headers: {
          'User-Agent': client.userAgent,
          Referer: `https://www.youtube.com/watch?v=${videoId}`,
        },
      });
      const body = await res.text();
      console.log(`  fmt=${fmt} status=${res.status} len=${body.length} exp=${url.includes('exp=xpe')}`);
    }
  }
}
