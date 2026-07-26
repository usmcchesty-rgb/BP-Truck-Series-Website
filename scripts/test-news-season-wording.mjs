import assert from 'node:assert/strict';
import {
  buildLeagueCareerSummary,
  buildChampionshipSeasonWordingGuide,
  validateInProgressSeasonCompletedWording,
  validateDriverSpotlightField,
} from '../api/_driver-career-history.js';

const DRIVER = '1001';

function seasonEntry(bp, seasonId, category = 'bp-truck-series') {
  return {
    seasonId: String(seasonId),
    seasonName: `Season ${bp}`,
    bpSeasonNumber: bp,
    category,
    excludeFromCareer: false,
  };
}

function standingsRow(position, starts = 8) {
  return {
    byDriverId: {
      [DRIVER]: { position, starts, points: 100, wins: 0, top5s: 0, top10s: 0 },
    },
  };
}

function buildCatalog({ currentSeasonId, rows }) {
  const seasons = rows.map(({ bp, seasonId }) => seasonEntry(bp, seasonId));
  const standingsBySeason = {};
  for (const { seasonId, position } of rows) {
    standingsBySeason[seasonId] = standingsRow(position);
  }
  return {
    currentSeasonId,
    currentSeasonName: 'Season 11',
    classificationReliable: true,
    seasons,
    standingsBySeason,
  };
}

function schedule(total, completed) {
  return Array.from({ length: total }, (_, i) => ({
    nonPoints: false,
    officialPointsRaceNumber: i + 1,
    winner: i < completed ? 'Someone' : null,
    date: '2026-03-01',
  }));
}

function summaryFor(rowSpecs, { total = 10, completed = 6, currentId = '27911', currentPos = 5 } = {}) {
  const rows = rowSpecs.map(({ bp, position, seasonId = String(27800 + bp) }) => ({
    bp,
    position,
    seasonId,
  }));
  const catalog = buildCatalog({ currentSeasonId: currentId, rows });
  return buildLeagueCareerSummary(DRIVER, catalog, {
    scheduleRaces: schedule(total, completed),
    currentSeasonPointsPosition: currentPos,
  });
}

// Current season is career best (P5 beats P6 and P8)
const currentBest = summaryFor(
  [
    { bp: 9, position: 8 },
    { bp: 10, position: 6 },
    { bp: 11, position: 5, seasonId: '27911' },
  ],
  { currentId: '27911', currentPos: 5 }
);
assert.equal(currentBest.seasonWording.currentSeasonIsCareerBestPositionSoFar, true);
assert.equal(currentBest.bestSeasonName, 'Season 11');
assert.equal(currentBest.bestCompletedSeasonName, 'Season 10');
assert.equal(currentBest.seasonWording.forbidCompletedSeasonWordingForCurrentSeason, true);

const badPhrase =
  'His best season finish came in Season 11, where he placed fifth overall.';
const badErrors = validateInProgressSeasonCompletedWording(badPhrase, {
  leagueCareerSummary: currentBest,
  currentSeasonBpNumber: 11,
});
assert.ok(badErrors.length > 0, 'reject completed wording for in-progress current season');

const goodPhrase =
  "He's currently enjoying the best season of his career while sitting fifth in the standings.";
const goodErrors = validateInProgressSeasonCompletedWording(goodPhrase, {
  leagueCareerSummary: currentBest,
  currentSeasonBpNumber: 11,
});
assert.equal(goodErrors.length, 0);

// Current season not career best
const notBest = summaryFor(
  [
    { bp: 9, position: 3 },
    { bp: 10, position: 4 },
    { bp: 11, position: 8, seasonId: '27911' },
  ],
  { currentId: '27911', currentPos: 8 }
);
assert.equal(notBest.seasonWording.currentSeasonIsCareerBestPositionSoFar, false);
assert.equal(notBest.bestCompletedSeasonFinish, 3);
assert.equal(notBest.seasonWording.canStillBeatCompletedBest, true);

// Completed season career best (full schedule)
const completedSeason = summaryFor(
  [
    { bp: 9, position: 3 },
    { bp: 10, position: 2 },
    { bp: 11, position: 5, seasonId: '27911' },
  ],
  { currentId: '27911', completed: 10, total: 10, currentPos: 5 }
);
assert.equal(completedSeason.currentSeasonComplete, true);
assert.equal(completedSeason.seasonWording.currentSeasonInProgress, false);
assert.equal(completedSeason.bestCompletedSeasonFinish, 2);

const completedPhrase =
  'His best championship finish came in Season 10 where he finished second.';
const completedErrors = validateInProgressSeasonCompletedWording(completedPhrase, {
  leagueCareerSummary: completedSeason,
  currentSeasonBpNumber: 11,
});
assert.equal(completedErrors.length, 0);

// Rookie first season
const rookie = summaryFor([{ bp: 11, position: 12, seasonId: '27911' }], {
  currentId: '27911',
  currentPos: 12,
});
assert.equal(rookie.seasonsAppeared, 1);
assert.equal(rookie.bestCompletedSeasonFinish, null);
assert.equal(rookie.seasonWording.currentSeasonIsCareerBestPositionSoFar, true);

// Returning driver (multiple seasons, current not first)
const returning = summaryFor(
  [
    { bp: 8, position: 15 },
    { bp: 10, position: 9 },
    { bp: 11, position: 7, seasonId: '27911' },
  ],
  { currentId: '27911', currentPos: 7 }
);
assert.equal(returning.seasonsAppeared, 3);
assert.equal(returning.seasonWording.currentSeasonIsCareerBestPositionSoFar, true);

// Champion defending title (prior title in completed season, current leader)
const defending = summaryFor(
  [
    { bp: 9, position: 1 },
    { bp: 10, position: 4 },
    { bp: 11, position: 1, seasonId: '27911' },
  ],
  { currentId: '27911', currentPos: 1 }
);
assert.equal(defending.championships, 1);
assert.equal(defending.seasonWording.isChampionshipLeader, true);
assert.equal(defending.seasonWording.defendingPriorChampionship, true);
assert.ok(
  defending.seasonWording.suggestedPhrasing.some((p) => /leads the standings/i.test(p))
);

// Current season leader (no prior championships, career best)
const leader = summaryFor(
  [
    { bp: 9, position: 6 },
    { bp: 10, position: 4 },
    { bp: 11, position: 1, seasonId: '27911' },
  ],
  { currentId: '27911', currentPos: 1 }
);
assert.equal(leader.seasonWording.isChampionshipLeader, true);
assert.equal(leader.seasonWording.currentSeasonIsCareerBestPositionSoFar, true);

// Current outside previous best
const outside = summaryFor(
  [
    { bp: 9, position: 2 },
    { bp: 10, position: 3 },
    { bp: 11, position: 9, seasonId: '27911' },
  ],
  { currentId: '27911', currentPos: 9 }
);
assert.equal(outside.seasonWording.currentSeasonIsCareerBestPositionSoFar, false);
assert.equal(outside.bestCompletedSeasonFinish, 2);
assert.equal(outside.seasonWording.canStillBeatCompletedBest, true);

const guide = buildChampionshipSeasonWordingGuide({
  currentSeasonInProgress: true,
  currentSeasonComplete: false,
  currentSeasonStanding: { position: 5, label: 'Season 11' },
  bestCompletedSeason: { position: 3, label: 'Season 9' },
  bestOverallSeason: { position: 5, label: 'Season 11', seasonState: 'current' },
  remainingPointsRaces: 4,
  currentSeasonPointsPosition: 5,
  priorChampionships: 0,
});
assert.equal(guide.canStillBeatCompletedBest, true);
assert.equal(guide.currentSeasonIsCareerBestPositionSoFar, false);

const fieldErrors = validateDriverSpotlightField(badPhrase, {
  leagueCareerSummary: currentBest,
  currentSeasonBpNumber: 11,
});
assert.ok(fieldErrors.some((e) => e.type === 'inprogress-season-completed-wording'));

console.log('news-season-wording: all scenarios passed');
