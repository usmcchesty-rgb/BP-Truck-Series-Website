import {
  fetchSimRacerHubLeagueCareerStats,
  buildDriverCareerHistory,
  validateDriverSpotlightCareerStats,
  validateDriverSpotlightStyleClaims,
} from '../api/_driver-career-history.js';
import { validateNewsArticle } from '../api/_news-validation.js';

const catalog = {
  leagueId: '1783',
  seasons: [
    { seasonId: '27987', seriesId: '13609', seasonName: 'S11', category: 'bp-truck-series', bpSeasonNumber: 11, excludeFromCareer: false },
    { seasonId: '25227', seriesId: '12415', seasonName: 'S10', category: 'bp-truck-series', bpSeasonNumber: 10, excludeFromCareer: false },
    { seasonId: '21817', seriesId: '11068', seasonName: 'S9', category: 'bp-truck-series', bpSeasonNumber: 9, excludeFromCareer: false },
    { seasonId: '17647', seriesId: '9286', seasonName: 'S8', category: 'bp-truck-series', bpSeasonNumber: 8, excludeFromCareer: false },
    { seasonId: '15704', seriesId: '8366', seasonName: 'S7', category: 'bp-truck-series', bpSeasonNumber: 7, excludeFromCareer: false },
    { seasonId: '13228', seriesId: '7066', seasonName: 'S6', category: 'bp-truck-series', bpSeasonNumber: 6, excludeFromCareer: false },
  ],
  classificationReliable: true,
};

const leagueCareerStats = await fetchSimRacerHubLeagueCareerStats('12987', catalog);
console.log('Mark Arthur leagueCareerStats', {
  careerStatsScope: leagueCareerStats.careerStatsScope,
  careerStatsSourceUrl: leagueCareerStats.careerStatsSourceUrl,
  parsedCareerStats: leagueCareerStats.parsedCareerStats,
  careerStarts: leagueCareerStats.careerStarts,
  careerWins: leagueCareerStats.careerWins,
  careerTop5s: leagueCareerStats.careerTop5s,
  careerTop10s: leagueCareerStats.careerTop10s,
});

const career = buildDriverCareerHistory({
  driverId: '12987',
  seasonCatalog: catalog,
  leagueCareerStats,
});

const badBody = `Mark Arthur has been a model of calm under pressure across his truck series career, compiling 133 starts, 8 wins, and 41 top-five finishes while showing tactical acumen and a deep understanding of track dynamics.`;

const goodBody = `Across his Blazing Pedals league career, Mark Arthur has compiled 167 starts, 17 wins, and 67 top-five finishes.`;

const ctx = {
  leagueCareerStats: career.leagueCareerStats,
  truckSeriesCareerHistory: career.truckSeriesCareerHistory,
  allowedSeasonStats: { winsTotal: 1 },
  manualRaceNotes: '',
  transcriptSummary: '',
};

console.log('bad career stat errors', validateDriverSpotlightCareerStats(badBody, ctx));
console.log('good career stat errors', validateDriverSpotlightCareerStats(goodBody, ctx));
console.log('style errors', validateDriverSpotlightStyleClaims(badBody, ctx));

const validation = validateNewsArticle(
  { headline: 'Arthur Rising', body: badBody },
  {
    articleType: 'driver-spotlight',
    spotlightDriverId: '12987',
    factualGrounding: {
      drivers: {
        '12987': {
          driverName: 'Mark Arthur',
          truckSeriesCareerHistory: career.truckSeriesCareerHistory,
          leagueCareerStats: career.leagueCareerStats,
          allowedSeasonStats: { winsTotal: 1 },
        },
      },
    },
  }
);

console.log('validation valid', validation.valid);
console.log('error types', validation.errors.map((e) => e.type));

const expected = { starts: 167, wins: 17, top5s: 67, top10s: 100 };
const actual = leagueCareerStats;
const pass =
  actual.careerStarts === expected.starts &&
  actual.careerWins === expected.wins &&
  actual.careerTop5s === expected.top5s &&
  actual.careerTop10s === expected.top10s;

console.log('MARK ARTHUR PARSE PASS', pass);
if (!pass) process.exit(1);
