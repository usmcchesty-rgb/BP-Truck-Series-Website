import assert from 'node:assert/strict';
import {
  PLAYLIST_ITEMS_LIST_QUOTA_UNITS,
  fetchGreenFlagPlaylistFromYouTubeApi,
  mapYouTubeDataApiPlaylistItem,
  sortPlaylistVideosByPublicationDesc,
} from '../api/_youtube-green-flag-playlist.js';

const itemR15 = {
  id: 'PLitem15',
  snippet: {
    title: 'Blazing Pedals Racing League | S11R15 | Pocono',
    publishedAt: '2026-07-14T00:00:00Z',
    position: 14,
    resourceId: { videoId: 'vid15' },
    thumbnails: { high: { url: 'https://i.ytimg.com/vi/vid15/hqdefault.jpg' } },
  },
  contentDetails: {
    videoId: 'vid15',
    videoPublishedAt: '2026-07-13T18:59:18+00:00',
  },
};

const itemR17 = {
  id: 'PLitem17',
  snippet: {
    title: 'Blazing Pedals Racing League | S11R17 | Homestead',
    publishedAt: '2026-07-27T00:00:00Z',
    position: 16,
    resourceId: { videoId: 'vid17' },
  },
  contentDetails: {
    videoId: 'vid17',
    videoPublishedAt: '2026-07-26T20:00:00+00:00',
  },
};

const mapped15 = mapYouTubeDataApiPlaylistItem(itemR15);
const mapped17 = mapYouTubeDataApiPlaylistItem(itemR17);

assert.equal(mapped15.videoId, 'vid15');
assert.equal(mapped15.raceNumber, 15);
assert.equal(mapped17.raceNumber, 17);

const sorted = sortPlaylistVideosByPublicationDesc([mapped15, mapped17]);
assert.equal(sorted[0].videoId, 'vid17');

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const href = String(url);
  assert.match(href, /playlistItems/);
  assert.match(href, /part=snippet%2CcontentDetails/);
  if (href.includes('pageToken=page2')) {
    return {
      ok: true,
      json: async () => ({
        items: [itemR17],
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({
      items: [itemR15],
      nextPageToken: 'page2',
    }),
  };
};

try {
  const { videos, fetchDiagnostics } = await fetchGreenFlagPlaylistFromYouTubeApi(
    'PLtest',
    'fake-key'
  );
  assert.equal(videos.length, 2);
  assert.equal(videos[0].videoId, 'vid17');
  assert.equal(fetchDiagnostics.apiPagesFetched, 2);
  assert.equal(fetchDiagnostics.quotaCostUnits, 2 * PLAYLIST_ITEMS_LIST_QUOTA_UNITS);
  assert.equal(fetchDiagnostics.totalPlaylistItems, 2);
  console.log('youtube-green-flag-playlist-api: all scenarios passed');
} finally {
  globalThis.fetch = originalFetch;
}
