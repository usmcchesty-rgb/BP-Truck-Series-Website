import {
  buildDriverCareerRaceResultsByDriver,
  buildCareerTrackHistoryForDriver,
  matchTrackToCatalog,
  resolveTrackType,
} from '../api/_fantasy-track-history.js';

const daltonId = '39623';
const leagueId = '1783';
const upcomingTrack = 'Talladega Superspeedway';

const rows =
  (await buildDriverCareerRaceResultsByDriver([daltonId], leagueId)).get(daltonId) || [];
const history = buildCareerTrackHistoryForDriver(rows, upcomingTrack);

function bucketRows(filterFn) {
  return rows.filter(filterFn).map((row) => ({
    seasonId: row.seasonId,
    track: row.track,
    matchLabel: row.matchLabel,
    catalog: row.matchedTrackName,
    type: row.matchedTrackType,
    finish: row.finish,
    simracerTypeName: row.simracerTypeName,
    trackConfigName: row.trackConfigName,
  }));
}

const talladegaExact = bucketRows(
  (row) => row.matchedTrackName === 'Talladega Superspeedway'
);
const daytonaOval = bucketRows(
  (row) => row.matchedTrackName === 'Daytona International Speedway Oval Night'
);
const daytonaRoad = bucketRows((row) => row.matchedTrackName === 'Daytona Road Course');
const charlotteOval = bucketRows(
  (row) => row.matchedTrackName === 'Charlotte Motor Speedway Oval Night'
);
const charlotteRoval = bucketRows((row) => row.matchedTrackName === 'Charlotte Roval');
const indyOval = bucketRows(
  (row) => row.matchedTrackName === 'Indianapolis Motor Speedway NASCAR Oval'
);
const indyRoad = bucketRows((row) => row.matchedTrackName === 'Indianapolis Road Course');
const superspeedwayRows = bucketRows((row) => resolveTrackType(row.matchLabel || row.track) === 'superspeedway');

const layoutClassificationCheck = [
  'Daytona International Speedway Oval Night',
  'Daytona International Speedway Road Course',
  'Daytona Road Course',
  'Charlotte Motor Speedway Oval Night',
  'Charlotte Roval',
  'Indianapolis Motor Speedway NASCAR Oval',
  'Indianapolis Motor Speedway Road Course',
  'Daytona International Speedway',
  'Charlotte Motor Speedway',
  'Indianapolis Motor Speedway',
].map((track) => ({
  track,
  ...matchTrackToCatalog(track),
}));

const excludedFromSuperspeedway = [...daytonaRoad];
const excludedFromIntermediate = [...charlotteRoval, ...indyRoad];

console.log(
  JSON.stringify(
    {
      phase: 'dalton-track-layout-race14',
      upcomingTrack,
      layoutClassificationCheck,
      daltonKilroe: {
        exactTalladegaStarts: talladegaExact.length,
        daytonaOvalStarts: daytonaOval.length,
        daytonaRoadCourseStartsExcludedFromSuperspeedway: daytonaRoad.length,
        charlotteOvalStarts: charlotteOval.length,
        charlotteRovalStartsExcludedFromIntermediate: charlotteRoval.length,
        indianapolisOvalStarts: indyOval.length,
        indianapolisRoadCourseStartsExcludedFromIntermediate: indyRoad.length,
        totalSuperspeedwayStartsAfterFix: superspeedwayRows.length,
        careerTrackTypeStarts: history.careerTrackTypeStarts,
        historyScope: history.historyScope,
        exactTrackStarts: history.careerExactTrackStarts,
      },
      everySuperspeedwayRace: superspeedwayRows,
      everyRoadCourseLayoutExcludedFromSuperspeedwayOrIntermediate: [
        ...excludedFromSuperspeedway.map((row) => ({
          ...row,
          excludedFrom: 'superspeedway',
        })),
        ...excludedFromIntermediate.map((row) => ({
          ...row,
          excludedFrom: 'intermediate',
        })),
      ],
    },
    null,
    2
  )
);
