import assert from 'node:assert/strict';
import {
  buildBroadcastPresentation,
  formatScheduleRaceBroadcastLabel,
} from '../api/youtube-broadcasts.js';

const featured = {
  title: 'Blazing Pedals Racing League | S11R15 | Pocono',
  videoId: 'abc123',
};

const nextRace = {
  officialPointsRaceNumber: 16,
  raceNumber: 16,
  track: 'New Hampshire Motor Speedway',
  date: '2026-08-09',
};

const latest = buildBroadcastPresentation(featured, nextRace, 'last-completed-race');
assert.equal(latest.heading, 'Latest Broadcast');
assert.equal(latest.videoTitle, featured.title);
assert.equal(latest.represents, 'latest-upload');

const raceDay = buildBroadcastPresentation(
  { title: 'Live from NHMS', videoId: 'live1' },
  nextRace,
  'race-day-current'
);
assert.match(raceDay.heading, /Race Day Broadcast/);
assert.match(raceDay.heading, /Race 16/);
assert.match(raceDay.heading, /New Hampshire/);
assert.equal(raceDay.represents, 'race-day-current');

const label = formatScheduleRaceBroadcastLabel(nextRace);
assert.equal(label, 'Race 16 — New Hampshire Motor Speedway');

console.log('youtube-broadcast-presentation: all scenarios passed');
