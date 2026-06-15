import { validateNewsArticle } from '../api/_news-validation.js';
import {
  validateDriverSpotlightMixedScopeStats,
  validateDriverSpotlightHistoricalSeasonStats,
} from '../api/_driver-career-history.js';

const leagueCareerStats = {
  careerStatsVerified: true,
  careerStarts: 80,
  careerWins: 5,
  careerTop5s: 87,
  careerTop10s: 166,
  careerAverageFinish: 10.2,
  careerPoles: 3,
  careerLapsLed: 400,
};

const allowedSeasonStats = {
  winsTotal: 1,
  top5Total: 4,
  top10Total: 8,
  pointsTotal: 595,
  pointsPosition: 6,
};

const leagueCareerSummary = {
  careerSummaryVerified: true,
  bestSeasonFinish: 2,
  bestSeasonName: 'Season 8',
  championships: 0,
  seasonsAppeared: 6,
  seasonsStarted: [6, 7, 8, 9, 10, 11],
  runnerUpSeasons: [
    { label: 'Season 8', bpSeasonNumber: 8, position: 2, points: 412 },
  ],
  participatedSeasons: [
    { label: 'Season 8', bpSeasonNumber: 8, position: 2, points: 412 },
    { label: 'Season 11', bpSeasonNumber: 11, position: 6, points: 595 },
  ],
  championshipSeasons: [],
  top3SeasonFinishes: [{ label: 'Season 8', bpSeasonNumber: 8, position: 2 }],
};

const ctx = {
  leagueCareerStats,
  allowedSeasonStats,
  leagueCareerSummary,
  currentSeasonBpNumber: 11,
};

const mixedBad = validateDriverSpotlightMixedScopeStats('five wins this season', ctx);
console.log('mixed bad', mixedBad[0]?.type);
if (mixedBad[0]?.type !== 'career-stat-labeled-as-season') process.exit(1);

const histBad = validateDriverSpotlightHistoricalSeasonStats(
  'Season 8 runner-up with 595 points',
  ctx
);
console.log('historical bad', histBad[0]?.type, histBad[0]?.message);
if (histBad[0]?.type !== 'historical-season-points-mismatch') process.exit(1);

const histGood = validateDriverSpotlightHistoricalSeasonStats(
  'His best season came in Season 8, when he finished second in the championship standings.',
  ctx
);
console.log('historical good', histGood.length ? 'FAIL' : 'pass');
if (histGood.length) process.exit(1);

const article = {
  headline: 'Taylor Butcher-Benjamin Climbing',
  subheadline: 'Season 8 runner-up with 595 points',
  summary: 'Taylor has five wins this season and a career-best points season in Season 8.',
  body: 'Taylor Butcher-Benjamin has one win this season and five career wins across his Blazing Pedals career.',
};

const validation = validateNewsArticle(article, {
  articleType: 'driver-spotlight',
  spotlightDriverId: '99',
  currentSeasonBpNumber: 11,
  factualGrounding: {
    drivers: {
      '99': {
        driverName: 'Taylor Butcher-Benjamin',
        leagueCareerStats,
        allowedSeasonStats,
        leagueCareerSummary,
      },
    },
  },
});

console.log('subheadline errors', validation.subheadlineValidationErrors.map((e) => e.type));
console.log('summary errors', validation.summaryValidationErrors.map((e) => e.type));
console.log('mixedScopeClaims', validation.mixedScopeClaims.length);

const pass =
  validation.subheadlineValidationErrors.some((e) => e.type === 'historical-season-points-mismatch') &&
  validation.summaryValidationErrors.some((e) => e.type === 'career-stat-labeled-as-season');

console.log('HISTORICAL + MIXED PASS', pass);
if (!pass) process.exit(1);
