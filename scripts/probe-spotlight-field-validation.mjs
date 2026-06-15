import { validateNewsArticle } from '../api/_news-validation.js';

const leagueCareerStats = {
  careerStatsVerified: true,
  careerStarts: 167,
  careerWins: 17,
  careerTop5s: 67,
  careerTop10s: 100,
  careerAverageFinish: 9.8,
  careerPoles: 25,
  careerLapsLed: 2721,
  careerIncidents: 1163,
};

const allowedSeasonStats = { winsTotal: 1, pointsPosition: 5, pointsTotal: 420 };

const article = {
  headline: 'Mark Arthur: Blazing Pedals Veteran',
  subheadline: 'One career win and rising form',
  summary: 'Mark Arthur has one career win across his Blazing Pedals league career while chasing points this season.',
  body: 'Across his Blazing Pedals league career, Mark Arthur has compiled 167 starts and 17 wins.',
};

const validation = validateNewsArticle(article, {
  articleType: 'driver-spotlight',
  spotlightDriverId: '12987',
  factualGrounding: {
    drivers: {
      '12987': {
        driverName: 'Mark Arthur',
        leagueCareerStats,
        allowedSeasonStats,
      },
    },
  },
});

console.log('valid', validation.valid);
console.log('summary errors', validation.summaryValidationErrors);
console.log('subheadline errors', validation.subheadlineValidationErrors);
console.log('body errors', validation.bodyValidationErrors);

const summaryCaught = validation.summaryValidationErrors.some((e) => e.field === 'careerWins');
const bodyClean = validation.bodyValidationErrors.length === 0;

console.log('SUMMARY WIN MISMATCH CAUGHT', summaryCaught);
console.log('BODY CLEAN', bodyClean);

if (!summaryCaught || !bodyClean) process.exit(1);
