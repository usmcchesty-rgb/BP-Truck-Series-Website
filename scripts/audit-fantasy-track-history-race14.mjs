import { fetchHtml, getDriverProfiles, getSettings } from '../api/_lib.js';
import { parseScheduleRacesFromHtml } from '../api/_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getCompletedPointsRaces,
} from '../api/_schedule-points-races.js';
import { buildFactualGroundingContext } from '../api/_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from '../api/_power-rankings-results-audit.js';
import {
  buildDriverLookup,
  fetchStandingsRows,
} from '../api/power-rankings-generate.js';
import {
  alignAllCompletedPointsRaces,
  buildDriverRaceResultsByDriver,
  buildCareerTrackHistoryForDriver,
  matchTrackToCatalog,
  resolveTrackType,
} from '../api/_fantasy-track-history.js';

const raceNumber = 14;
const upcomingTrack = 'Talladega Superspeedway';
const TARGETS = [
  { id: '39628', label: 'Ty Marasco' },
  { id: '39623', label: 'Dalton Kilroe' },
];

const settings = await getSettings();
const now = new Date();
const scheduleHtml = await fetchHtml(settings.scheduleUrl);
const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
const raceDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { now, settings });
const standingsResult = await fetchStandingsRows(settings, raceDebug.standingsScheduleId);
const standings = standingsResult.rows.filter(
  (r) => Number(r.races) > 0 && Number(r.position) <= 30
);
const profiles = await getDriverProfiles();
const driverLookup = buildDriverLookup(standings, profiles);
const alignedRaces = getAlignedRaceFinishes(
  scheduleRaces,
  raceNumber,
  standingsResult.schedules,
  driverLookup
);
const allAligned = alignAllCompletedPointsRaces(
  scheduleRaces,
  standingsResult.schedules,
  driverLookup,
  { now, settings }
);
const driverIdsList = standings.map((r) => String(r.driverId));
const byDriver = buildDriverRaceResultsByDriver(
  allAligned,
  standingsResult.schedules,
  driverIdsList
);

const talladegaMatch = matchTrackToCatalog(upcomingTrack);
const classificationCheck = [
  'Michigan International Speedway',
  'EchoPark Speedway (Atlanta) Oval Night',
  'Indianapolis Motor Speedway NASCAR Oval',
  'Daytona International Speedway Oval Night',
  'Talladega Superspeedway',
].map((track) => ({
  track,
  ...matchTrackToCatalog(track),
}));

async function auditDriver({ id, label }) {
  const rows = byDriver.get(id) || [];
  const history = buildCareerTrackHistoryForDriver(rows, upcomingTrack, {
    alignedRaces: allAligned,
    driverId: id,
  });

  return {
    driverName: label,
    exactStarts: history.exactStarts,
    similarStarts: history.similarStarts,
    historyScope: history.historyScope,
    scoringScope: history.scoringScope,
    upcomingTrackMatch: history.upcomingTrackMatch,
    similarRacesContributing: (history.diagnostics?.racesIncluded || []).filter(
      (r) => r.countsAsSimilar
    ),
    allRacesIncluded: history.diagnostics?.racesIncluded,
    racesSkippedCount: history.diagnostics?.racesSkipped?.length ?? 0,
  };
}

const drivers = {};
for (const target of TARGETS) {
  drivers[target.label] = await auditDriver(target);
}

console.log(
  JSON.stringify(
    {
      phase: 'track-history-phase-1',
      talladegaMatch,
      superspeedwayClassificationCheck: classificationCheck,
      ty: drivers['Ty Marasco'],
      dalton: drivers['Dalton Kilroe'],
      michiganIsSuperspeedway:
        resolveTrackType('Michigan International Speedway') === 'superspeedway',
      atlantaIsSuperspeedway:
        resolveTrackType('EchoPark Speedway (Atlanta) Oval Night') === 'superspeedway',
      indyIsSuperspeedway:
        resolveTrackType('Indianapolis Motor Speedway NASCAR Oval') === 'superspeedway',
    },
    null,
    2
  )
);
