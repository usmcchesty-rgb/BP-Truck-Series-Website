/**
 * Performance probe: time schedule HTML, caution scrape, race results, warm cache.
 * Run: node scripts/probe-page-load-performance.mjs
 */
import { performance } from 'node:perf_hooks';
import { getSettings, fetchHtml } from '../api/_lib.js';
import {
  parseScheduleRacesFromHtml,
  computeSeasonCautionStatsFromRaces,
  parseCautionCountFromRaceHtml,
  resolveRaceResultUrl,
  fetchCautionCountForRace,
} from '../api/_caution-stats.js';
import { enrichScheduleRaces } from '../api/_schedule-points-races.js';
import { buildRaceResultsPayload } from '../api/_race-results-page.js';
import { SRH_CACHE_TTL } from '../api/_fantasy-srh-cache.js';

function ms(start) {
  return Math.round(performance.now() - start);
}

const settings = await getSettings();
const report = {
  cacheTtls: SRH_CACHE_TTL,
  cold: {},
  warm: {},
};

{
  const t0 = performance.now();
  const html = await fetchHtml(settings.scheduleUrl);
  report.cold.scheduleHtmlMs = ms(t0);
  report.cold.scheduleHtmlBytes = html.length;

  const races = parseScheduleRacesFromHtml(html);
  const enriched = enrichScheduleRaces(races);
  const completedWithLinks = enriched.filter((r) => !r.nonPoints && r.winner && r.link);
  report.completedPointsWithLinks = completedWithLinks.length;
  report.totalScheduleEvents = enriched.length;

  const t1 = performance.now();
  const cautionStats = await computeSeasonCautionStatsFromRaces(races, {
    now: new Date(),
    settings,
  });
  report.cold.fullCautionScrapeMs = ms(t1);
  report.cautionRacesCounted = cautionStats.cautionRacesCounted;
  report.cautionSample = (cautionStats.racesParsed || []).slice(0, 3);
  report.rockinghamCautions = (cautionStats.racesParsed || []).find((r) =>
    /rockingham/i.test(r.track || '')
  );
  report.martinsvilleCautions = (cautionStats.racesParsed || []).find((r) =>
    /martinsville/i.test(r.track || '')
  );

  const rockingham = enriched.find(
    (r) => !r.nonPoints && /rockingham/i.test(r.track || '')
  );
  const martinsville = enriched.find(
    (r) => !r.nonPoints && /martinsville/i.test(r.track || '')
  );
  const charlotte = enriched.find(
    (r) => !r.nonPoints && /charlotte/i.test(r.track || '')
  );
  const texas = enriched.find((r) => !r.nonPoints && /texas/i.test(r.track || ''));
  const duel = enriched.find((r) => r.isOpeningDuel);
  const daytonaRace1 = enriched.find(
    (r) => !r.nonPoints && r.officialPointsRaceNumber === 1
  );

  if (rockingham?.link) {
    const t2 = performance.now();
    const raceHtml = await fetchHtml(resolveRaceResultUrl(rockingham.link));
    report.cold.singleRaceHtmlMs = ms(t2);
    report.singleRaceCautions = parseCautionCountFromRaceHtml(raceHtml);
    report.rockinghamScheduleId = rockingham.scheduleId;
    report.rockinghamTrack = rockingham.track;
    report.rockinghamLabel = rockingham.displayRaceLabel;
  }

  const t3 = performance.now();
  const raceResults = await buildRaceResultsPayload({
    enrichedRaces: enriched,
    scheduleHtml: html,
    settings,
    requestedScheduleId: rockingham?.scheduleId || null,
    progressionOptions: { now: new Date(), settings },
  });
  report.cold.buildRaceResultsPayloadMs = ms(t3);
  report.selectedRaceName = raceResults.selectedRaceName;
  report.selectedScheduleId = raceResults.selectedScheduleId;
  report.selectedDisplayRaceLabel = raceResults.selectedDisplayRaceLabel;
  report.selectedCautionCount = raceResults.cautionCount;

  const tParallel = performance.now();
  await Promise.all([
    computeSeasonCautionStatsFromRaces(races, { now: new Date(), settings }),
    buildRaceResultsPayload({
      enrichedRaces: enriched,
      scheduleHtml: html,
      settings,
      requestedScheduleId: rockingham?.scheduleId || null,
      progressionOptions: { now: new Date(), settings },
    }),
  ]);
  report.warm.parallelCautionAndResultsMs = ms(tParallel);

  const tOmit = performance.now();
  const omitResults = await buildRaceResultsPayload({
    enrichedRaces: enriched,
    scheduleHtml: html,
    settings,
    requestedScheduleId: martinsville?.scheduleId || rockingham?.scheduleId || null,
    progressionOptions: { now: new Date(), settings },
  });
  report.warm.resultsOnlyPathMs = ms(tOmit);
  report.martinsvilleSelected = {
    scheduleId: omitResults.selectedScheduleId,
    track: omitResults.selectedRaceName,
    label: omitResults.selectedDisplayRaceLabel,
    cautionCount: omitResults.cautionCount,
  };

  report.lookupSamples = {
    duel: duel
      ? { scheduleId: duel.scheduleId, label: duel.displayRaceLabel, track: duel.track }
      : null,
    daytonaRace1: daytonaRace1
      ? {
          scheduleId: daytonaRace1.scheduleId,
          label: daytonaRace1.displayRaceLabel,
          track: daytonaRace1.track,
        }
      : null,
    charlotte: charlotte
      ? {
          scheduleId: charlotte.scheduleId,
          label: charlotte.displayRaceLabel,
          track: charlotte.track,
        }
      : null,
    texas: texas
      ? { scheduleId: texas.scheduleId, label: texas.displayRaceLabel, track: texas.track }
      : null,
  };

  if (rockingham) {
    const tCachedCaution = performance.now();
    report.warm.cachedRockinghamCaution = await fetchCautionCountForRace(rockingham);
    report.warm.cachedRockinghamCautionMs = ms(tCachedCaution);
  }

  report.cold.estimatedScheduleApiSequentialMs =
    report.cold.scheduleHtmlMs +
    report.cold.fullCautionScrapeMs +
    report.cold.buildRaceResultsPayloadMs;

  report.warm.estimatedResultsPagePathMs =
    report.cold.scheduleHtmlMs + report.warm.resultsOnlyPathMs;
}

console.log(JSON.stringify(report, null, 2));
