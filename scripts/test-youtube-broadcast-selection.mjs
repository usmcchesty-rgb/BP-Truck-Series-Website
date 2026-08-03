import assert from 'node:assert/strict';
import {
  buildBroadcastPresentation,
  classifyLeagueBroadcastVideo,
  legacyScheduleFeaturedPick,
  parsePlaylistRss,
  parsePublishedTimestamp,
  selectFeaturedVideo,
  sortVideosByPublicationDesc,
  videoMatchesScheduledRace,
} from '../api/youtube-broadcasts.js';
import { getEffectiveRaceDateStatus } from '../api/_race-date-status.js';

function makeEasternInstant({ year, month, day, hour, minute = 0 }) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  for (let offsetHours = -8; offsetHours <= 12; offsetHours += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, 0));
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value])
    );
    if (
      Number(parts.year) === year &&
      Number(parts.month) === month &&
      Number(parts.day) === day &&
      Number(parts.hour) === hour &&
      Number(parts.minute) === minute
    ) {
      return candidate;
    }
  }

  throw new Error(`Unable to build Eastern instant for ${year}-${month}-${day} ${hour}:${minute}`);
}

function bpVideo(id, title, published, overrides = {}) {
  return {
    videoId: id,
    title,
    published,
    embedUrl: `https://www.youtube.com/embed/${id}`,
    raceNumber: null,
    ...overrides,
  };
}

const r15 = bpVideo(
  'r15',
  'Blazing Pedals Racing League | S11R15 | Pocono',
  '2026-07-01T12:00:00Z'
);
const r16 = bpVideo(
  'r16',
  'Blazing Pedals Racing League | S11R16 | New Hampshire',
  '2026-07-08T12:00:00Z'
);

const nextRace = {
  officialPointsRaceNumber: 16,
  raceNumber: 16,
  track: 'New Hampshire Motor Speedway',
  date: '2026-08-09',
};

// 1. Playlist contains Race 15 and newer Race 16 — select Race 16.
{
  const { featured, selectionReason } = selectFeaturedVideo([r15, r16], nextRace);
  assert.equal(featured.videoId, 'r16');
  assert.equal(selectionReason, 'newest-valid-playlist-upload');
}

// 2. Schedule says last completed Race 15 but playlist contains Race 16 — select Race 16.
{
  const scheduleLagNext = { ...nextRace, raceNumber: 16, officialPointsRaceNumber: 16 };
  const { featured, selectionReason, diagnostics } = selectFeaturedVideo(
    [r15, r16],
    scheduleLagNext
  );
  assert.equal(featured.videoId, 'r16');
  assert.equal(diagnostics.legacyScheduleWouldSelect?.videoId, 'r15');
  assert.equal(selectionReason, 'newest-valid-playlist-upload');
}

// 3. Oldest-first source order — still select newest by timestamp.
{
  const { featured } = selectFeaturedVideo([r15, r16].reverse(), nextRace);
  assert.equal(featured.videoId, 'r16');
}

// 4. Newest-first source order — select newest.
{
  const { featured } = selectFeaturedVideo([r16, r15], nextRace);
  assert.equal(featured.videoId, 'r16');
}

// 5. Newest item unrelated — select newest valid league broadcast.
{
  const unrelated = bpVideo(
    'other',
    'Some Other Sim League | S11R20 | Track',
    '2026-07-20T12:00:00Z'
  );
  const { featured } = selectFeaturedVideo([r16, unrelated, r15], nextRace);
  assert.equal(featured.videoId, 'r16');
}

// 6. Newest item is a trailer — skip it.
{
  const trailer = bpVideo(
    'trailer',
    'Blazing Pedals Racing League Season Trailer',
    '2026-07-20T12:00:00Z'
  );
  const { featured } = selectFeaturedVideo([trailer, r16, r15], nextRace);
  assert.equal(featured.videoId, 'r16');
  assert.equal(classifyLeagueBroadcastVideo(trailer).valid, false);
}

// 7. No race number in title but valid league broadcast — use publication date.
{
  const noRaceNum = bpVideo(
    'live1',
    'Blazing Pedals Racing League | Live Broadcast',
    '2026-07-09T12:00:00Z'
  );
  const { featured } = selectFeaturedVideo([r16, noRaceNum, r15], nextRace);
  assert.equal(featured.videoId, 'live1');
}

// 8. Verified race-day broadcast overrides newest completed upload.
{
  const raceDaySettings = {
    raceStartTime: '6:30 PM ET',
    raceCompletionBufferMinutes: 180,
  };
  const raceDayDate = 'Jul 8, 2026';
  const raceDayNow = makeEasternInstant({ year: 2026, month: 7, day: 8, hour: 16 });
  const raceDayStatus = getEffectiveRaceDateStatus({
    raceDate: raceDayDate,
    hasResults: false,
    now: raceDayNow,
    settings: raceDaySettings,
  });
  assert.equal(raceDayStatus.isRaceDay, true);

  const raceDayNext = {
    raceNumber: 16,
    officialPointsRaceNumber: 16,
    track: 'New Hampshire Motor Speedway',
    date: raceDayDate,
  };
  const olderButRaceDay = bpVideo(
    'r15-raceday',
    'Blazing Pedals Racing League | S11R15 | Pocono',
    '2026-07-20T12:00:00Z'
  );
  const raceDayVideo = bpVideo(
    'r16-raceday',
    'Blazing Pedals Racing League | S11R16 | New Hampshire',
    '2026-07-01T12:00:00Z'
  );
  assert.equal(videoMatchesScheduledRace(raceDayVideo, raceDayNext), true);

  const { featured, selectionReason } = selectFeaturedVideo(
    [olderButRaceDay, raceDayVideo],
    raceDayNext,
    {
      now: raceDayNow,
      settings: raceDaySettings,
    }
  );
  assert.equal(featured.videoId, 'r16-raceday');
  assert.equal(selectionReason, 'race-day-current');
}

// 9. Invalid publication date does not beat a valid newer timestamp.
{
  const badDate = bpVideo(
    'bad',
    'Blazing Pedals Racing League | S11R99 | Future',
    'not-a-date'
  );
  const sorted = sortVideosByPublicationDesc([badDate, r16]);
  assert.equal(sorted[0].videoId, 'r16');
  const { featured } = selectFeaturedVideo([badDate, r16], nextRace);
  assert.equal(featured.videoId, 'r16');
}

// 10. Empty playlist fallback.
{
  const { featured, selectionReason } = selectFeaturedVideo([], nextRace);
  assert.equal(featured, null);
  assert.equal(selectionReason, 'no-broadcast');
}

// RSS parse sorts by publication date regardless of entry order.
{
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <title>Blazing Pedals Racing League | S11R15 | Pocono</title>
    <published>2026-07-01T12:00:00Z</published>
    <yt:videoId>vid15</yt:videoId>
  </entry>
  <entry>
    <title>Blazing Pedals Racing League | S11R16 | New Hampshire</title>
    <published>2026-07-08T12:00:00Z</published>
    <yt:videoId>vid16</yt:videoId>
  </entry>
</feed>`;
  const parsed = parsePlaylistRss(xml);
  assert.equal(parsed[0].videoId, 'vid16');
  assert.equal(parsePublishedTimestamp(parsed[0].published), Date.parse('2026-07-08T12:00:00Z'));
}

assert.equal(
  legacyScheduleFeaturedPick([r16, r15], { raceNumber: 16 }).videoId,
  'r15',
  'legacy logic would pick last completed under schedule'
);

const presentation = buildBroadcastPresentation(r16, nextRace, 'newest-valid-playlist-upload');
assert.equal(presentation.heading, 'Latest Broadcast');

console.log('youtube-broadcast-selection: all scenarios passed');
