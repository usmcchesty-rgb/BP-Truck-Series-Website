import { getSettings, supabase } from './_lib.js';
import { getEffectivePointsRaceProgression } from './_race-date-status.js';
import { resolveMissionControlRaces } from './_admin-mission-control.js';
import { loadFantasyScheduleContext } from './_fantasy-slate-progression.js';
import {
  generateFantasyDraftSlate,
  loadFantasyDraftSlate,
} from './_fantasy-slate.js';
import { SALARY_ENGINE_VERSION } from './_fantasy-salary-guardrails.js';
import {
  compareDraftToEligiblePool,
  loadEligibleFantasyStandingsPool,
} from './_fantasy-driver-pool.js';

const automationInflight = new Map();
const automationResultCache = new Map();
const AUTOMATION_CACHE_TTL_MS = 60_000;

function parseSlateMeta(row) {
  const meta = row?.meta;
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta) || {};
    } catch {
      return {};
    }
  }
  return meta;
}

async function loadPublishedSlateForRace(seasonId, raceNumber) {
  const sb = supabase();
  if (!sb || raceNumber == null) return null;
  const { data } = await sb
    .from('fantasy_slates')
    .select('*')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(raceNumber))
    .eq('status', 'published')
    .maybeSingle();
  return data || null;
}

export function draftHasManualSalaryEdits(draftPayload = {}) {
  const meta = parseSlateMeta(draftPayload.slate);
  if (meta?.salaryDraft?.manualEditsPresent) return true;
  return (draftPayload.drivers || []).some(
    (driver) => driver.salaryOverride != null && driver.salaryOverride !== '',
  );
}

export async function patchSlateSalaryDraftMeta(slateId, patch = {}) {
  const sb = supabase();
  if (!sb || !slateId) return null;

  const { data: row } = await sb
    .from('fantasy_slates')
    .select('meta')
    .eq('id', Number(slateId))
    .maybeSingle();
  const existingMeta = parseSlateMeta(row);
  const nextMeta = {
    ...existingMeta,
    salaryDraft: {
      ...(existingMeta.salaryDraft || {}),
      ...patch,
    },
  };

  const { error } = await sb
    .from('fantasy_slates')
    .update({ meta: nextMeta, updated_at: new Date().toISOString() })
    .eq('id', Number(slateId));

  if (error) throw new Error(error.message || 'Failed to update salary draft metadata.');
  return nextMeta.salaryDraft;
}

async function loadRaceScoringModule() {
  return import('./_fantasy-race-scoring.js');
}

export function isScoreReady(status = {}) {
  return Boolean(
    status.raceComplete &&
      status.resultsReady &&
      Number(status.lineupCount || 0) > 0 &&
      (status.status === 'ready' || status.status === 'needs_review'),
  );
}

export function isCleanlyScored(status = {}) {
  return (
    status.status === 'scored' &&
    Number(status.scoringMeta?.lineupCount || status.lineupCount || 0) > 0 &&
    !(status.unresolvedDrivers || status.scoringMeta?.unresolvedDrivers || []).length
  );
}

export async function maybeAutoGenerateNextRaceSalaryDraft(seasonId, completedRaceNumber, options = {}) {
  const settings = options.settings || (await getSettings());
  const resolvedSeasonId = String(seasonId || settings.seasonId || '27987');
  const { scheduleRaces } = await loadFantasyScheduleContext({
    settings,
    now: options.now,
    scheduleRaces: options.scheduleRaces,
  });
  const races = resolveMissionControlRaces(scheduleRaces, { settings, now: options.now || new Date() });
  const nextRace = races.nextRace;

  if (!nextRace?.raceNumber) {
    return { skipped: true, reason: 'no_next_race', nextRace: null };
  }

  const nextRaceNumber = Number(nextRace.raceNumber);
  if (nextRaceNumber === Number(completedRaceNumber)) {
    return { skipped: true, reason: 'next_race_same_as_completed', nextRace };
  }

  const publishedNext = await loadPublishedSlateForRace(resolvedSeasonId, nextRaceNumber);
  if (publishedNext) {
    return {
      skipped: true,
      reason: 'next_slate_already_published',
      nextRace,
      warning: 'Next slate is already published. Salaries were not regenerated.',
    };
  }

  const existingDraft = await loadFantasyDraftSlate(resolvedSeasonId, nextRaceNumber);
  if (existingDraft?.slate && draftHasManualSalaryEdits(existingDraft) && !options.adminRegenerate) {
    await patchSlateSalaryDraftMeta(existingDraft.slate.id, {
      needsRegeneration: true,
      salaryDraftSourceRaceNumber: Number(completedRaceNumber),
      lastAutoGenerationAt: new Date().toISOString(),
      lastAutoGenerationError: null,
    });
    return {
      skipped: true,
      reason: 'manual_edits_protected',
      needsRegeneration: true,
      nextRace,
      slateId: existingDraft.slate.id,
      message: 'New official results are available. Salary draft needs regeneration.',
    };
  }

  const existingMeta = parseSlateMeta(existingDraft?.slate);
  const priorSourceRace = existingMeta?.salaryDraft?.salaryDraftSourceRaceNumber ?? null;

  let driverPoolComparison = null;
  if (existingDraft?.slate) {
    try {
      const poolContext = await loadEligibleFantasyStandingsPool({
        raceNumber: nextRaceNumber,
        settings,
        now: options.now,
        scheduleRaces: options.scheduleRaces,
      });
      driverPoolComparison = compareDraftToEligiblePool(
        existingDraft.drivers || [],
        poolContext.eligibleRows
      );
      if (driverPoolComparison.missingEligible.length > 0) {
        if (draftHasManualSalaryEdits(existingDraft) && !options.adminRegenerate) {
          await patchSlateSalaryDraftMeta(existingDraft.slate.id, {
            needsRegeneration: true,
            driverPoolChanged: true,
            missingDriverIds: driverPoolComparison.addedDriverIds,
            salaryDraftSourceRaceNumber: Number(completedRaceNumber),
            lastAutoGenerationAt: new Date().toISOString(),
            lastAutoGenerationError: null,
          });
          return {
            skipped: true,
            reason: 'driver_pool_stale_manual_edits',
            needsRegeneration: true,
            driverPoolChanged: true,
            missingDrivers: driverPoolComparison.missingEligible,
            nextRace,
            slateId: existingDraft.slate.id,
            message:
              'Newly eligible drivers are missing from the draft. Compare the driver pool and regenerate or add missing drivers.',
          };
        }
      }
    } catch (error) {
      driverPoolComparison = { error: error.message || 'driver_pool_audit_failed' };
    }
  }

  if (
    existingDraft?.slate &&
    existingMeta?.salaryDraft?.autoGenerated &&
    priorSourceRace === Number(completedRaceNumber) &&
    !existingMeta?.salaryDraft?.needsRegeneration &&
    !(driverPoolComparison?.driverPoolChanged && driverPoolComparison?.missingEligible?.length)
  ) {
    return {
      skipped: true,
      reason: 'already_generated_for_completed_race',
      nextRace,
      slateId: existingDraft.slate.id,
    };
  }

  try {
    const generated = await generateFantasyDraftSlate({ raceNumber: nextRaceNumber });
    const slateId = generated?.slate?.id;
    if (slateId) {
      await patchSlateSalaryDraftMeta(slateId, {
        salaryDraftGeneratedAt: new Date().toISOString(),
        salaryDraftSourceRaceNumber: Number(completedRaceNumber),
        salaryEngineVersion: SALARY_ENGINE_VERSION,
        autoGenerated: true,
        manualEditsPresent: false,
        needsRegeneration: false,
        driverPoolChanged: false,
        previousDraftVersion: existingDraft?.slate?.id || null,
        lastAutoGenerationAt: new Date().toISOString(),
        lastAutoGenerationError: null,
      });
    }
    return {
      generated: true,
      nextRace,
      slateId,
      raceNumber: nextRaceNumber,
      salaryEngineVersion: SALARY_ENGINE_VERSION,
    };
  } catch (error) {
    if (existingDraft?.slate?.id) {
      await patchSlateSalaryDraftMeta(existingDraft.slate.id, {
        lastAutoGenerationAt: new Date().toISOString(),
        lastAutoGenerationError: error.message || 'salary_draft_failed',
        needsRegeneration: true,
        salaryDraftSourceRaceNumber: Number(completedRaceNumber),
      }).catch(() => {});
    }
    return {
      generated: false,
      failed: true,
      nextRace,
      error: error.message || 'salary_draft_failed',
    };
  }
}

async function runFantasyPostRaceAutomationInternal(seasonId, options = {}) {
  const settings = options.settings || (await getSettings());
  const resolvedSeasonId = String(seasonId || settings.seasonId || '27987');
  const { getFantasyRaceScoringStatus, scoreFantasySlate, loadFantasyLineupScoresForSlate } =
    await loadRaceScoringModule();

  const { scheduleRaces } = await loadFantasyScheduleContext({ settings, now: options.now });
  const pointsProgression = getEffectivePointsRaceProgression(scheduleRaces, {
    settings,
    now: options.now,
  });
  const missionRaces = resolveMissionControlRaces(scheduleRaces, { settings, now: options.now });
  const completedRaceNumber =
    options.raceNumber != null
      ? Number(options.raceNumber)
      : missionRaces.postRace?.raceNumber ??
        pointsProgression.latestCompletedPointsRace?.officialPointsRaceNumber ??
        null;

  const result = {
    seasonId: resolvedSeasonId,
    completedRaceNumber,
    completedRace: missionRaces.postRace,
    nextRace: missionRaces.nextRace,
    scoring: null,
    salaryDraft: null,
    ranAt: new Date().toISOString(),
  };

  if (completedRaceNumber == null) {
    result.scoring = { skipped: true, reason: 'no_completed_race' };
    result.salaryDraft = { skipped: true, reason: 'waiting_for_completed_race_scoring' };
    return result;
  }

  let scoringStatus = await getFantasyRaceScoringStatus({
    seasonId: resolvedSeasonId,
    settings,
    raceNumber: completedRaceNumber,
  });

  if (scoringStatus.resultsReady) {
    try {
      const { syncOfficialProvisionalsForRace } = await import('./_driver-provisionals.js');
      result.provisionalLedgerSync = await syncOfficialProvisionalsForRace(
        resolvedSeasonId,
        completedRaceNumber,
        {
          settings,
          scheduleRaces,
          createdBy: 'auto-sync',
        },
      );
    } catch (error) {
      result.provisionalLedgerSync = {
        skipped: true,
        reason: 'sync_failed',
        error: error.message || 'provisional_ledger_sync_failed',
      };
    }
  }

  if (isCleanlyScored(scoringStatus)) {
    result.scoring = {
      skipped: true,
      reason: 'already_scored',
      status: scoringStatus.status,
      lineupCount: scoringStatus.lineupCount,
      scoringMeta: scoringStatus.scoringMeta,
    };
  } else if (isScoreReady(scoringStatus)) {
    try {
      const scored = await scoreFantasySlate({
        seasonId: resolvedSeasonId,
        settings,
        raceNumber: completedRaceNumber,
        source: 'auto',
      });
      result.scoring = {
        skipped: false,
        scored: true,
        status: scored.status,
        lineupCount: scored.scoredLineups,
        unresolvedDrivers: scored.unresolvedDrivers,
        warnings: scored.warnings,
      };
      scoringStatus = await getFantasyRaceScoringStatus({
        seasonId: resolvedSeasonId,
        settings,
        raceNumber: completedRaceNumber,
      });
    } catch (error) {
      result.scoring = {
        skipped: false,
        scored: false,
        error: error.message || 'auto_score_failed',
        status: 'needs_review',
      };
      result.salaryDraft = { skipped: true, reason: 'scoring_failed' };
      return result;
    }
  } else {
    result.scoring = {
      skipped: true,
      reason: scoringStatus.status || 'not_ready',
      status: scoringStatus.status,
      resultsReady: scoringStatus.resultsReady,
      resultsReason: scoringStatus.resultsReason,
      lineupCount: scoringStatus.lineupCount,
    };
    result.salaryDraft = { skipped: true, reason: 'waiting_for_completed_race_scoring' };
    return result;
  }

  result.scoring = {
    ...(result.scoring || {}),
    status: scoringStatus.status,
    lineupCount: scoringStatus.lineupCount,
    unresolvedDrivers: scoringStatus.unresolvedDrivers || [],
    scoringMeta: scoringStatus.scoringMeta,
    lineupScores: await loadFantasyLineupScoresForSlate(scoringStatus.slate?.id),
  };

  const scoredCleanly =
    scoringStatus.status === 'scored' && !(scoringStatus.unresolvedDrivers || []).length;

  if (!scoredCleanly) {
    result.salaryDraft = { skipped: true, reason: 'waiting_for_clean_scoring' };
    return result;
  }

  result.salaryDraft = await maybeAutoGenerateNextRaceSalaryDraft(
    resolvedSeasonId,
    completedRaceNumber,
    { settings, now: options.now, scheduleRaces },
  );

  return result;
}

export async function runFantasyPostRaceAutomation(seasonId, options = {}) {
  const lockKey = String(seasonId || options.seasonId || 'default');

  if (!options.force) {
    const cached = automationResultCache.get(lockKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  if (automationInflight.has(lockKey)) {
    return automationInflight.get(lockKey);
  }

  const runPromise = runFantasyPostRaceAutomationInternal(seasonId, options)
    .then((result) => {
      automationResultCache.set(lockKey, {
        result,
        expiresAt: Date.now() + AUTOMATION_CACHE_TTL_MS,
      });
      return result;
    })
    .finally(() => {
      automationInflight.delete(lockKey);
    });
  automationInflight.set(lockKey, runPromise);
  return runPromise;
}

export async function getFantasyPostRaceAutomationStatus(seasonId, options = {}) {
  const settings = options.settings || (await getSettings());
  const resolvedSeasonId = String(seasonId || settings.seasonId || '27987');
  const { getFantasyRaceScoringStatus, loadFantasyLineupScoresForSlate } = await loadRaceScoringModule();

  const { scheduleRaces } = await loadFantasyScheduleContext({ settings, now: options.now });
  const missionRaces = resolveMissionControlRaces(scheduleRaces, { settings, now: options.now });
  const completedRaceNumber = missionRaces.postRace?.raceNumber ?? null;

  let scoringStatus = null;
  let lineupScores = [];
  if (completedRaceNumber != null) {
    scoringStatus = await getFantasyRaceScoringStatus({
      seasonId: resolvedSeasonId,
      settings,
      raceNumber: completedRaceNumber,
    });
    if (scoringStatus?.slate?.id) {
      lineupScores = await loadFantasyLineupScoresForSlate(scoringStatus.slate.id);
    }
  }

  let nextDraft = null;
  let nextPublished = null;
  if (missionRaces.nextRace?.raceNumber != null) {
    nextPublished = await loadPublishedSlateForRace(resolvedSeasonId, missionRaces.nextRace.raceNumber);
    if (!nextPublished) {
      nextDraft = await loadFantasyDraftSlate(resolvedSeasonId, missionRaces.nextRace.raceNumber);
    }
  }

  const salaryDraftMeta = parseSlateMeta(nextDraft?.slate)?.salaryDraft || null;

  return {
    completedRace: missionRaces.postRace,
    nextRace: missionRaces.nextRace,
    scoring: scoringStatus,
    lineupScores,
    salaryDraft: {
      published: Boolean(nextPublished),
      draft: nextDraft?.slate
        ? {
            id: nextDraft.slate.id,
            raceNumber: nextDraft.slate.race_number,
            track: nextDraft.slate.track,
            status: nextDraft.slate.status,
          }
        : null,
      meta: salaryDraftMeta,
      manualEditsPresent: nextDraft ? draftHasManualSalaryEdits(nextDraft) : false,
      needsRegeneration: Boolean(salaryDraftMeta?.needsRegeneration),
      warning: nextPublished
        ? 'Next slate is already published. Salaries were not regenerated.'
        : null,
    },
    salaryEngineVersion: SALARY_ENGINE_VERSION,
  };
}

export function resolveStandingsDisplayState(scoringMeta, lineupScores = []) {
  const hasScores = lineupScores.length > 0;
  const status = scoringMeta?.status || null;

  if (status === 'scored' && hasScores) {
    return {
      phase: 'scored',
      scoringAvailable: true,
      showPoints: true,
      label: 'Scoring Complete',
      message: 'Fantasy scoring complete.',
    };
  }

  if (status === 'needs_review') {
    return {
      phase: 'needs_review',
      scoringAvailable: false,
      showPoints: false,
      label: 'Needs Review',
      message: 'Race scoring is under review. Standings will update after admin approval.',
    };
  }

  if (hasScores && !status) {
    return {
      phase: 'scored',
      scoringAvailable: true,
      showPoints: true,
      label: 'Scoring Complete',
      message: 'Fantasy scoring complete.',
    };
  }

  return {
    phase: 'pending',
    scoringAvailable: false,
    showPoints: false,
    label: 'Pending',
    message: 'Race scoring pending.',
  };
}

export async function refreshPublishedSlateRow(slateId) {
  const sb = supabase();
  if (!sb || !slateId) return null;
  const { data } = await sb.from('fantasy_slates').select('*').eq('id', Number(slateId)).maybeSingle();
  return data || null;
}
