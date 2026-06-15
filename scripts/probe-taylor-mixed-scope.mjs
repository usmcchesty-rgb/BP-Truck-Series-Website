import { validateNewsArticle } from '../api/_news-validation.js';
import { validateDriverSpotlightMixedScopeStats } from '../api/_driver-career-history.js';

const leagueCareerStats = {
  careerStatsVerified: true,
  careerStarts: 100,
  careerWins: 5,
  careerTop5s: 87,
  careerTop10s: 166,
  careerAverageFinish: 10.2,
};

const allowedSeasonStats = {
  winsTotal: 1,
  top5Total: 4,
  top10Total: 8,
  pointsTotal: 312,
  pointsPosition: 6,
};

const ctx = {
  leagueCareerStats,
  allowedSeasonStats,
  manualRaceNotes: '',
  transcriptSummary: '',
};

const badPhrases = [
  'five wins this season',
  'five victories this season',
  'with five wins already',
  '87 top 5s this season',
  '166 top 10s this season',
];

for (const phrase of badPhrases) {
  const errors = validateDriverSpotlightMixedScopeStats(phrase, ctx);
  console.log(`BAD "${phrase}" =>`, errors[0]?.type || 'NOT CAUGHT', errors[0]?.message || '');
  if (!errors.length) process.exit(1);
}

const goodPhrases = [
  'one win this season',
  'five wins across his Blazing Pedals career',
  'four top-five finishes this season',
  '87 career top-five finishes',
];

for (const phrase of goodPhrases) {
  const errors = validateDriverSpotlightMixedScopeStats(phrase, ctx);
  console.log(`GOOD "${phrase}" =>`, errors.length ? `FAIL ${errors[0].type}` : 'pass');
  if (errors.length) process.exit(1);
}

const article = {
  headline: 'Taylor Butcher-Benjamin Building Momentum',
  subheadline: 'Five wins this season highlight his rise',
  summary: 'Taylor has five wins this season with 87 top 5s this season in Blazing Pedals.',
  body: 'Taylor Butcher-Benjamin has one win this season and five wins across his Blazing Pedals career.',
};

const validation = validateNewsArticle(article, {
  articleType: 'driver-spotlight',
  spotlightDriverId: '1',
  factualGrounding: {
    drivers: {
      '1': { driverName: 'Taylor Butcher-Benjamin', leagueCareerStats, allowedSeasonStats },
    },
  },
});

console.log('article valid', validation.valid);
console.log('subheadline mixed', validation.subheadlineValidationErrors.filter((e) => e.type === 'career-stat-labeled-as-season'));
console.log('summary mixed', validation.summaryValidationErrors.filter((e) => e.type === 'career-stat-labeled-as-season'));
console.log('body mixed', validation.bodyValidationErrors.filter((e) => e.type === 'career-stat-labeled-as-season'));
console.log('mixedScopeClaims', validation.mixedScopeClaims.length);

const subCaught = validation.subheadlineValidationErrors.some((e) => e.type === 'career-stat-labeled-as-season');
const summaryCaught = validation.summaryValidationErrors.some((e) => e.type === 'career-stat-labeled-as-season');
const bodyClean = validation.bodyValidationErrors.length === 0;

console.log('TAYLOR MIXED SCOPE PASS', subCaught && summaryCaught);
if (!subCaught || !summaryCaught) process.exit(1);
