import {
  discoverSimRacerHubSeasonCatalog,
  buildDriverCareerHistory,
  validateCareerTenureClaims,
  classifyLeagueSeasonEntry,
} from '../api/_driver-career-history.js';

const catalog = await discoverSimRacerHubSeasonCatalog(
  { seasonId: '27987' },
  { season_id: 27987, season_name: 'Blazing Pedals Season 11', series_id: 13609, league_id: 1783 }
);

console.log('diagnostics', catalog.diagnostics);
console.log('classificationReliable', catalog.classificationReliable);
console.log('issues', catalog.classificationIssues);
console.log(
  'season categories',
  catalog.seasons.map((s) => ({
    seasonId: s.seasonId,
    name: s.seasonName,
    category: s.category,
    bp: s.bpSeasonNumber,
    confidence: s.confidence,
    exclude: s.excludeFromCareer,
  }))
);

const veteranDriver = buildDriverCareerHistory({
  driverId: '212',
  standingsRow: { races: 3, wins: 0, top5: 1, top10: 2 },
  seasonCatalog: catalog,
});
console.log('\nDriver 212 truck history', {
  tenureClaimsAllowed: veteranDriver.truckSeriesCareerHistory.tenureClaimsAllowed,
  firstSeason: veteranDriver.truckSeriesCareerHistory.firstSeason,
  seasonsStarted: veteranDriver.truckSeriesCareerHistory.seasonsStarted,
  isFirstTruckSeason: veteranDriver.truckSeriesCareerHistory.isFirstTruckSeason,
  isTruckSeriesVeteran: veteranDriver.truckSeriesCareerHistory.isTruckSeriesVeteran,
  starts: veteranDriver.truckSeriesCareerHistory.totalCareerStarts,
});

const rookieCandidate = Object.entries(catalog.standingsBySeason['27987'].byDriverId)
  .find(([id, row]) => row.starts > 0 && !catalog.standingsBySeason['25227']?.byDriverId?.[id]);

if (rookieCandidate) {
  const [driverId] = rookieCandidate;
  const rookieHistory = buildDriverCareerHistory({
    driverId,
    standingsRow: rookieCandidate[1],
    seasonCatalog: catalog,
  });
  console.log('\nPossible first-truck-season driver', driverId, {
    isFirstTruckSeason: rookieHistory.truckSeriesCareerHistory.isFirstTruckSeason,
    seasonsStarted: rookieHistory.truckSeriesCareerHistory.seasonsStarted,
  });

  const bad = validateCareerTenureClaims('A rookie in his first season with the truck series.', {
    truckSeriesCareerHistory: rookieHistory.truckSeriesCareerHistory,
  });
  console.log('rookie claim errors', bad.length, bad[0]?.claim);
}

const vetBad = validateCareerTenureClaims('This veteran is a longtime driver in the series.', {
  truckSeriesCareerHistory: veteranDriver.truckSeriesCareerHistory,
});
console.log('\nveteran claim on multi-season driver errors', vetBad.length);

console.log('\nclassify sample', classifyLeagueSeasonEntry({
  seriesName: 'Savage Edge Xfinity Season 8',
  seasonName: 'Savage Edge Xfinity Season 8',
}));
