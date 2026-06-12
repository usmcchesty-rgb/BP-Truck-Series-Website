const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

function extractInnertubeApiKey(html) {
  const match = String(html || '').match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  return match?.[1] || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
}

const CLIENTS = [
  ['ANDROID', '3', 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip', { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en', gl: 'US', androidSdkVersion: 30 }],
  ['ANDROID_CREATOR', '14', 'com.google.android.apps.youtube.creator/22.43.101 (Linux; U; Android 11) gzip', { clientName: 'ANDROID_CREATOR', clientVersion: '22.43.101', hl: 'en', gl: 'US', androidSdkVersion: 30 }],
  ['ANDROID_TESTSUITE', '30', 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip', { clientName: 'ANDROID_TESTSUITE', clientVersion: '1.9', hl: 'en', gl: 'US', androidSdkVersion: 30 }],
  ['ANDROID_MUSIC', '21', 'com.google.android.apps.youtube.music/5.16.51 (Linux; U; Android 11) gzip', { clientName: 'ANDROID_MUSIC', clientVersion: '5.16.51', hl: 'en', gl: 'US', androidSdkVersion: 30 }],
  ['IOS+checks', '5', 'com.google.ios.youtube/20.10.4 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)', { clientName: 'IOS', clientVersion: '20.10.4', hl: 'en', gl: 'US', deviceMake: 'Apple', deviceModel: 'iPhone14,3', userAgent: 'com.google.ios.youtube/20.10.4', osName: 'iPhone', osVersion: '15_6', contentCheckOk: true, racyCheckOk: true }],
  ['MWEB+checks', '2', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', { clientName: 'MWEB', clientVersion: '2.20250210.01.00', hl: 'en', gl: 'US', contentCheckOk: true, racyCheckOk: true }],
  ['TVHTML5+checks', '7', 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version/glass-future/24.260000000000000', { clientName: 'TVHTML5', clientVersion: '7.20250327.00.00', hl: 'en', gl: 'US', contentCheckOk: true, racyCheckOk: true }],
  ['WEB_CREATOR', '62', FETCH_HEADERS['User-Agent'], { clientName: 'WEB_CREATOR', clientVersion: '1.20250210.01.00', hl: 'en', gl: 'US' }],
  ['MEDIA_CONNECT', '95', FETCH_HEADERS['User-Agent'], { clientName: 'MEDIA_CONNECT_FRONTEND', clientVersion: '0.1', hl: 'en', gl: 'US' }],
];

const videoId = process.argv[2] || 'LKixVmv-QbI';
const html = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: FETCH_HEADERS }).then((r) => r.text());
const apiKey = extractInnertubeApiKey(html);

for (const [label, header, ua, client] of CLIENTS) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ua,
      'X-Youtube-Client-Name': header,
      'X-Youtube-Client-Version': client.clientVersion,
    },
    body: JSON.stringify({ context: { client }, videoId }),
  });
  const data = await res.json();
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  console.log(label, 'playability=', data?.playabilityStatus?.status, 'tracks=', tracks.length, 'reason=', data?.playabilityStatus?.reason || '-');
}
