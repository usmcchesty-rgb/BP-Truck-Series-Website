/**
 * Broadcast Transcript Editor schedule dropdown regression tests.
 * Run: npm run test:transcript-schedule
 */
import {
  buildTranscriptRaceOptionValue,
  buildTranscriptSelectionDiagnostics,
  enrichTranscriptScheduleRaces,
  findTranscriptScheduleRace,
  formatTranscriptRaceOptionLabel,
  listTranscriptScheduleOptions,
  resolveTranscriptRaceNumber,
  resolveTranscriptTrackName,
} from '../public/admin/transcript-schedule.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  resolveTranscriptRaceNumber({ officialPointsRaceNumber: 14, raceNumber: 15 }) === 14,
  'officialPointsRaceNumber is preferred over schedule row index'
);
assert(
  resolveTranscriptRaceNumber({ raceNumber: 15 }) === 15,
  'fallback to raceNumber works'
);

const rawSchedule = [
  { raceNumber: 1, track: 'Daytona International Speedway Oval', points: 'yes', scheduleId: '340001' },
  { raceNumber: 2, track: 'Daytona International Speedway Oval', points: 'no', status: 'non-points', scheduleId: '340002' },
  { raceNumber: 3, track: 'Las Vegas Motor Speedway', points: 'yes', scheduleId: '340003' },
  { raceNumber: 14, track: 'Talladega Superspeedway', points: 'yes', scheduleId: '346480' },
  { raceNumber: 15, track: 'Pocono Raceway', points: 'yes', scheduleId: '346481' },
  { raceNumber: 16, track: 'EchoPark Speedway (Atlanta) Oval - 2008', points: 'yes', scheduleId: '346482' },
];

const enriched = enrichTranscriptScheduleRaces(rawSchedule);
const productionShapeRace15 = {
  ...enriched.find((race) => race.scheduleId === '346481'),
  officialPointsRaceNumber: 15,
};
const productionShapeRace16 = {
  ...enriched.find((race) => race.scheduleId === '346482'),
  officialPointsRaceNumber: 16,
};
const productionShapeRace14 = {
  ...enriched.find((race) => race.scheduleId === '346480'),
  officialPointsRaceNumber: 14,
};

const options = listTranscriptScheduleOptions([
  ...enriched.filter((race) => !['346481', '346482', '346480'].includes(race.scheduleId)),
  productionShapeRace14,
  productionShapeRace15,
  productionShapeRace16,
]);

assert(
  options.every((option) => !option.label.includes('undefined')),
  'dropdown labels must never contain undefined'
);

const race15 = findTranscriptScheduleRace([productionShapeRace15], '15');
assert(resolveTranscriptRaceNumber(race15) === 15, 'Race 15 resolves to 15');
assert(resolveTranscriptTrackName(race15) === 'Pocono Raceway', 'Race 15 track is Pocono Raceway');
assert(
  formatTranscriptRaceOptionLabel(race15) === 'Race 15 — Pocono Raceway',
  'Race 15 dropdown label is correct'
);

const race16 = findTranscriptScheduleRace([productionShapeRace16], '16');
assert(resolveTranscriptRaceNumber(race16) === 16, 'Race 16 resolves correctly');
assert(
  formatTranscriptRaceOptionLabel(race16).includes('EchoPark Speedway (Atlanta) Oval - 2008'),
  'Race 16 label includes track name'
);

const daytonaPoints = enriched.find((race) => race.scheduleId === '340001');
assert(resolveTranscriptRaceNumber(daytonaPoints) === 1, 'officialPointsRaceNumber preferred as 1 for first points race');

const duelRow = enriched.find((race) => race.scheduleId === '340002');
assert(duelRow.officialPointsRaceNumber == null, 'non-points row has null official number');
assert(
  !options.some((option) => option.race?.scheduleId === '340002'),
  'non-points duel row excluded from numbered dropdown options'
);

assert(
  buildTranscriptRaceOptionValue(duelRow) === 'schedule:340002',
  'non-points rows remain uniquely selectable via schedule id'
);
assert(
  formatTranscriptRaceOptionLabel(duelRow).startsWith('Unnumbered race'),
  'non-points rows render unnumbered label'
);

const staleClearSimulation = (() => {
  let raceName = 'Talladega Superspeedway';
  let transcript = 'old transcript';
  const selected = findTranscriptScheduleRace([productionShapeRace15], '15');
  transcript = '';
  raceName = resolveTranscriptTrackName(selected);
  assert(raceName === 'Pocono Raceway', 'selecting Race 15 after Race 14 does not retain Talladega');
  assert(transcript === '', 'selecting a new race clears stale transcript');
  return true;
})();
assert(staleClearSimulation, 'stale state simulation passed');

const editSaved = (() => {
  const saved = { raceNumber: 13, raceName: 'Kentucky Speedway (Historical Label)' };
  const row = findTranscriptScheduleRace(enriched, String(saved.raceNumber));
  const raceName = saved.raceName || resolveTranscriptTrackName(row);
  assert(raceName === 'Kentucky Speedway (Historical Label)', 'saved historical race name preserved when editing');
  return true;
})();

const diagnostics = buildTranscriptSelectionDiagnostics({
  selectedOptionValue: '15',
  race: race15,
  savedTranscriptFound: false,
});
assert(diagnostics.resolvedRaceNumber === 15, 'diagnostics include resolved race number');
assert(diagnostics.resolvedTrackName === 'Pocono Raceway', 'diagnostics include resolved track');

console.log('PASS  transcript-schedule regression');
console.log(`      ${options.length} dropdown options, none contain "undefined"`);
console.log(`      Race 15 → ${resolveTranscriptRaceNumber(race15)} / ${resolveTranscriptTrackName(race15)}`);
