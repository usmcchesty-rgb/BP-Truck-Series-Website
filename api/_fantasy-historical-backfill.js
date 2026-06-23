import { fetchHtml, getSettings, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import { enrichScheduleRaces, getCompletedPointsRaces } from './_schedule-points-races.js';
import { findEffectiveNextPointsRace } from './_race-date-status.js';
import {
  buildFantasyDriversForRace,
  simulatedNowForRace,
} from './_fantasy-backtest.js';
import {
  enrichFantasySlateDrivers,
  summarizeFantasySlateAnalytics,
} from './_fantasy-admin-analytics.js';
import {
  extractScheduleIdFromRace,
  loadPriorFantasySlateMaps,
} from './_fantasy-slate.js';
import { resolveTrackType } from './_fantasy-track-history.js';
import { FANTASY_MODEL_VERSION, summarizeFantasySlateMeta } from './_fantasy-salary-scoring.js';

const BACKFILL_NOTICE =
  'Historical backfill generated with current fantasy model; not a locked pre-race simulation.';

async function loadExistingSlatesForRace(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('fantasy_slates')
    .select('id, status, meta, race_number')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber));

  if (error) throw new Error(error.message || 'Failed to load existing fantasy slates.');
  return data || [];
}

function evaluateSkip(existingSlates = [], overwrite = false) {
  const published = existingSlates.find((row) => row.status === 'published');
  if (published) {
    return { skip: true, reason: 'Published slate exists', replaceDraftId: null };
  }

  const draft = existingSlates.find((row) => row.status === 'draft');
  if (!draft) {
    return { skip: false, reason: null, replaceDraftId: null };
  }

  if (!overwrite) {
    return { skip: true, reason: 'Draft slate already exists', replaceDraftId: null };
  }

  const meta = draft.meta || {};
  if (!meta.backfilled) {
    return { skip: true, reason: 'Live draft exists (not backfilled)', replaceDraftId: null };
  }

  return { skip: false, reason: null, replaceDraftId: draft.id };
}

async function deleteSlateById(slateId) {
  const sb = supabase();
  if (!sb || !slateId) return;

  await sb.from('fantasy_slate_drivers').delete().eq('slate_id', slateId);
  await sb.from('fantasy_slates').delete().eq('id', slateId);
}

async function insertBackfillDraftSlate(slateRow, driverRows) {
  const sb = supabase();
  if (!sb) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const now = new Date().toISOString();
  const { data: inserted, error } = await sb
    .from('fantasy_slates')
    .insert({
      ...slateRow,
      status: 'draft',
      generated_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to save backfill fantasy slate.');
  }

  const payload = driverRows.map((row) => ({
    slate_id: inserted.id,
    driver_id: row.driverId,
    driver_name: row.driverName,
    car_number: row.carNumber,
    computed_tier: row.computedTier,
    fantasy_tier_score: row.fantasyTierScore,
    score_breakdown: row.scoreBreakdown,
    generated_salary: row.generatedSalary,
    salary_override: row.salaryOverride,
    final_salary: row.finalSalary,
    track_history_summary: row.trackHistorySummary,
    track_adjustment: row.trackAdjustment,
    salary_reasons: row.salaryReasons,
    prior_salary: row.priorSalary,
  }));

  const { error: driversError } = await sb.from('fantasy_slate_drivers').insert(payload);
  if (driversError) {
    await sb.from('fantasy_slates').delete().eq('id', inserted.id);
    throw new Error(driversError.message || 'Failed to save backfill fantasy slate drivers.');
  }

  return inserted;
}

export async function generateFantasyHistoricalSlateForRace(raceNumber, options = {}) {
  const settings = options.settings || (await getSettings());
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const scheduleRaces =
    options.scheduleRaces ||
    enrichScheduleRaces(parseScheduleRacesFromHtml(await fetchHtml(settings.scheduleUrl)));

  const race = scheduleRaces.find(
    (row) => !row.nonPoints && Number(row.officialPointsRaceNumber) === Number(raceNumber)
  );
  if (!race) {
    throw new Error(`Race ${raceNumber} not found on schedule.`);
  }

  const simulatedNow = simulatedNowForRace(race, options.now || new Date());
  const priorMaps = await loadPriorFantasySlateMaps(seasonId, raceNumber);

  const built = await buildFantasyDriversForRace({
    scheduleRaces,
    raceNumber: Number(raceNumber),
    settings,
    now: simulatedNow,
    priorSalariesByDriver: priorMaps.priorSalariesByDriver,
    priorTierScoresByDriver: priorMaps.priorTierScoresByDriver,
  });

  if (!built?.drivers?.length) {
    throw new Error(`No eligible drivers for race ${raceNumber}.`);
  }

  const enrichedDrivers = enrichFantasySlateDrivers(
    built.drivers,
    priorMaps.priorSalariesByDriver
  );

  const generatedAt = new Date().toISOString();
  const meta = {
    ...summarizeFantasySlateMeta(enrichedDrivers),
    priorSlateRaceNumber: priorMaps.priorRaceNumber,
    backfilled: true,
    backfillGeneratedAt: generatedAt,
    approximationNotice: BACKFILL_NOTICE,
    historicalRaceDate: race.date || null,
  };

  const slateRow = {
    season_id: seasonId,
    race_number: Number(raceNumber),
    schedule_id: extractScheduleIdFromRace(race),
    track: race.track || 'TBD',
    track_type: resolveTrackType(race.track),
    lock_time: null,
    model_version: FANTASY_MODEL_VERSION,
    meta,
  };

  return {
    slateRow,
    drivers: enrichedDrivers,
    meta,
    race: {
      raceNumber: Number(raceNumber),
      track: race.track || 'TBD',
      date: race.date || null,
    },
    analytics: summarizeFantasySlateAnalytics(enrichedDrivers),
  };
}

export async function backfillFantasyHistoricalSlates(options = {}) {
  const settings = await getSettings();
  const seasonId = String(options.seasonId || settings.seasonId || '27987');
  const overwrite = options.overwrite === true;
  const now = options.now || new Date();

  const scheduleHtml = await fetchHtml(settings.scheduleUrl);
  const scheduleRaces = enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));
  const completedRaces = getCompletedPointsRaces(scheduleRaces, { now, settings })
    .filter((race) => race.winner && race.officialPointsRaceNumber != null)
    .sort((a, b) => Number(a.officialPointsRaceNumber) - Number(b.officialPointsRaceNumber));

  const nextRace = findEffectiveNextPointsRace(scheduleRaces, { now, settings })?.race;
  const nextRaceNumber =
    nextRace?.officialPointsRaceNumber != null ? Number(nextRace.officialPointsRaceNumber) : null;

  const targetRaces = completedRaces.filter((race) => {
    const raceNumber = Number(race.officialPointsRaceNumber);
    if (nextRaceNumber != null && raceNumber >= nextRaceNumber) return false;
    return true;
  });

  const result = {
    approximationNotice: BACKFILL_NOTICE,
    warning: 'Historical backfill uses current model and is approximate.',
    racesAttempted: targetRaces.length,
    racesCreated: 0,
    racesSkipped: 0,
    racesFailed: 0,
    generatedRaceNumbers: [],
    skipped: [],
    failures: [],
    latestCompletedRaceNumber:
      targetRaces.length > 0
        ? Number(targetRaces[targetRaces.length - 1].officialPointsRaceNumber)
        : null,
    excludedUpcomingRaceNumber: nextRaceNumber,
  };

  for (const race of targetRaces) {
    const raceNumber = Number(race.officialPointsRaceNumber);

    try {
      const existing = await loadExistingSlatesForRace(seasonId, raceNumber);
      const skipEval = evaluateSkip(existing, overwrite);
      if (skipEval.skip) {
        result.racesSkipped += 1;
        result.skipped.push({ raceNumber, reason: skipEval.reason });
        continue;
      }

      if (skipEval.replaceDraftId) {
        await deleteSlateById(skipEval.replaceDraftId);
      }

      const generated = await generateFantasyHistoricalSlateForRace(raceNumber, {
        settings,
        seasonId,
        scheduleRaces,
        now,
      });

      await insertBackfillDraftSlate(generated.slateRow, generated.drivers);

      result.racesCreated += 1;
      result.generatedRaceNumbers.push(raceNumber);
    } catch (error) {
      result.racesFailed += 1;
      result.failures.push({
        raceNumber,
        error: error.message || 'Backfill failed',
      });
    }
  }

  return result;
}
