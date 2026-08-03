import {
  buildWriterRunEstimate,
} from './_news-writer-cost-estimate.js';
import {
  checkNewsWriterRunsTableReady,
  createNewsWriterRun,
  getNewsWriterRun,
  updateNewsWriterRun,
  cancelNewsWriterRun,
  NEWS_WRITER_RUNS_MIGRATION_HINT,
} from './_news-writer-run-repository.js';
import {
  advanceWriterRun,
  initializeAndPersistRun,
  publicRunStatus,
} from './_news-writer-run-engine.js';
import { runMultipassWriterPipeline } from './_news-writer-orchestrator.js';
import { getSettings } from './_lib.js';

async function resolveSeasonId(seasonId) {
  if (seasonId) return String(seasonId);
  const settings = await getSettings();
  return String(settings.seasonId || '27987');
}

function parseRaceBody(body) {
  const seasonId = body.seasonId ?? body.season_id ?? null;
  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    return { error: 'Valid raceNumber is required.', status: 400 };
  }
  return { raceNumber, seasonId };
}

function requirePaidConfirmation(body) {
  const ok =
    body.confirmPaid === true ||
    body.confirm_paid === true ||
    body.confirmPaid === 'true' ||
    body.confirm_paid === 'true';
  if (!ok) {
    return {
      error:
        'Paid writer runs require confirmPaid: true after reviewing the cost estimate (Start Paid Writer Run).',
      status: 400,
      code: 'CONFIRMATION_REQUIRED',
    };
  }
  return null;
}

async function assertRunsTableReady() {
  const tables = await checkNewsWriterRunsTableReady();
  if (!tables.configured) {
    throw Object.assign(new Error('Supabase not configured.'), { status: 400, code: 'SUPABASE_MISSING' });
  }
  if (!tables.ready) {
    throw Object.assign(new Error(NEWS_WRITER_RUNS_MIGRATION_HINT), {
      status: 503,
      code: 'MIGRATION_REQUIRED',
      hint: tables.hint,
    });
  }
}

function makePersist(runId) {
  return async (patch) => {
    const rowPatch = { ...patch };
    if (rowPatch.openaiCalls != null) {
      rowPatch.openaiCalls = rowPatch.openaiCalls;
    }
    return updateNewsWriterRun(runId, rowPatch);
  };
}

async function driveRunUntilYield(run) {
  const tick = await advanceWriterRun(run, { persistRun: makePersist(run.id) });
  const latest = tick.run;
  if (tick.stale) {
    return { run: latest, stale: true, message: tick.message, progress: publicRunStatus(latest) };
  }
  if (tick.cancelled) return { run: latest, cancelled: true, progress: publicRunStatus(latest) };
  return {
    run: latest,
    done: !!tick.done,
    result: tick.result,
    progress: publicRunStatus(latest),
    nextStep: tick.nextStep,
  };
}

export async function handleResearchWriterEstimate(body) {
  const parsed = parseRaceBody(body);
  if (parsed.error) return { error: parsed.error, status: parsed.status, data: null };
  const seasonId = await resolveSeasonId(parsed.seasonId);
  const articleType = String(body.articleType ?? body.article_type ?? 'race-recap');
  const articleDepth = body.articleDepth ?? body.article_depth ?? 'medium';
  const runType =
    body.runType === 'shadow_compare' || body.run_type === 'shadow_compare'
      ? 'shadow_compare'
      : 'multipass_preview';
  const estimate = await buildWriterRunEstimate({
    seasonId,
    raceNumber: parsed.raceNumber,
    articleType,
    articleDepth,
    runType,
  });
  return {
    status: 200,
    data: {
      phase: 'writer-estimate',
      runType,
      ...estimate,
      requiresConfirmation: true,
      confirmationField: 'confirmPaid',
    },
  };
}

export async function handleResearchWriterStart(body) {
  const parsed = parseRaceBody(body);
  if (parsed.error) return { error: parsed.error, status: parsed.status, data: null };
  const confirmErr = requirePaidConfirmation(body);
  if (confirmErr) return { ...confirmErr, data: null };
  try {
    await assertRunsTableReady();
  } catch (e) {
    return { error: e.message, status: e.status || 500, data: { code: e.code, hint: e.hint } };
  }
  const seasonId = await resolveSeasonId(parsed.seasonId);
  const articleType = String(body.articleType ?? body.article_type ?? 'race-recap');
  const articleDepth = body.articleDepth ?? body.article_depth ?? 'medium';
  const manualNotes = body.manualNotes ?? body.manual_notes ?? '';
  const runType =
    body.runType === 'shadow_compare' || body.run_type === 'shadow_compare'
      ? 'shadow_compare'
      : 'multipass_preview';

  const estimate = await buildWriterRunEstimate({
    seasonId,
    raceNumber: parsed.raceNumber,
    articleType,
    articleDepth,
    runType,
  });

  const { run } = await initializeAndPersistRun({
    runType,
    seasonId,
    raceNumber: parsed.raceNumber,
    articleType,
    articleDepth,
    manualNotes,
    estimatedCostUsd: estimate.estimatedCostUsd,
    createRun: (row) => createNewsWriterRun(row),
    updateRun: updateNewsWriterRun,
  });

  const driven = await driveRunUntilYield(run);
  return {
    status: 200,
    data: {
      phase: 'writer-run-started',
      estimate,
      ...driven,
      draft: driven.result,
    },
  };
}

export async function handleResearchWriterContinue(body) {
  const runId = body.runId ?? body.run_id;
  if (!runId) return { error: 'runId is required.', status: 400, data: null };
  try {
    await assertRunsTableReady();
  } catch (e) {
    return { error: e.message, status: e.status || 500, data: { code: e.code, hint: e.hint } };
  }
  let run = await getNewsWriterRun(runId);
  if (!run) return { error: 'Writer run not found.', status: 404, data: null };
  if (run.status === 'cancelled') {
    return { status: 200, data: { phase: 'writer-run-cancelled', progress: publicRunStatus(run) } };
  }
  if (run.status === 'complete') {
    return {
      status: 200,
      data: { phase: 'writer-run-complete', progress: publicRunStatus(run), result: run.result, draft: run.result },
    };
  }
  const driven = await driveRunUntilYield(run);
  return {
    status: 200,
    data: {
      phase: driven.done ? 'writer-run-complete' : 'writer-run-continued',
      ...driven,
      draft: driven.result,
    },
  };
}

export async function handleResearchWriterStatus(body) {
  const runId = body.runId ?? body.run_id;
  if (!runId) return { error: 'runId is required.', status: 400, data: null };
  try {
    await assertRunsTableReady();
  } catch (e) {
    return { error: e.message, status: e.status || 500, data: { code: e.code, hint: e.hint } };
  }
  const run = await getNewsWriterRun(runId);
  if (!run) return { error: 'Writer run not found.', status: 404, data: null };
  return {
    status: 200,
    data: {
      phase: 'writer-run-status',
      progress: publicRunStatus(run),
      result: run.status === 'complete' ? run.result : null,
      draft: run.status === 'complete' ? run.result : null,
    },
  };
}

export async function handleResearchWriterCancel(body) {
  const runId = body.runId ?? body.run_id;
  if (!runId) return { error: 'runId is required.', status: 400, data: null };
  try {
    await assertRunsTableReady();
  } catch (e) {
    return { error: e.message, status: e.status || 500, data: { code: e.code, hint: e.hint } };
  }
  const run = await cancelNewsWriterRun(runId);
  return {
    status: 200,
    data: { phase: 'writer-run-cancelled', progress: publicRunStatus(run) },
  };
}

/** Legacy monolithic preview — blocked unless explicit escape hatch for scripts. */
export async function handleResearchWriterPreview(body) {
  if (body.allowMonolithic === true || body.allow_monolithic === true) {
    const parsed = parseRaceBody(body);
    if (parsed.error) return { error: parsed.error, status: parsed.status, data: null };
    const seasonId = await resolveSeasonId(parsed.seasonId);
    const articleType = String(body.articleType ?? body.article_type ?? 'race-recap');
    const articleDepth = body.articleDepth ?? body.article_depth ?? 'medium';
    const draft = await runMultipassWriterPipeline({
      seasonId,
      raceNumber: parsed.raceNumber,
      articleType,
      articleDepth,
      previewOnly: true,
      forceRun: true,
    });
    return { status: 200, data: draft };
  }
  return {
    error:
      'research-writer-preview no longer runs OpenAI on load. Use research-writer-estimate, then research-writer-start with confirmPaid: true, and research-writer-continue.',
    status: 400,
    data: { code: 'USE_CHECKPOINTED_WRITER' },
  };
}

export async function handleResearchWriterShadow(body) {
  if (body.allowMonolithic === true || body.allow_monolithic === true) {
    const { runWriterShadowComparison } = await import('./_news-writer-shadow.js');
    const parsed = parseRaceBody(body);
    if (parsed.error) return { error: parsed.error, status: parsed.status, data: null };
    const seasonId = await resolveSeasonId(parsed.seasonId);
    const articleType = String(body.articleType ?? body.article_type ?? 'race-recap');
    const articleDepth = body.articleDepth ?? body.article_depth ?? 'medium';
    const manualNotes = body.manualNotes ?? body.manual_notes ?? '';
    const data = await runWriterShadowComparison({
      seasonId,
      raceNumber: parsed.raceNumber,
      articleType,
      articleDepth,
      manualNotes,
    });
    return { status: 200, data };
  }
  return {
    error:
      'research-writer-shadow requires checkpointed runs. Use research-writer-estimate with runType shadow_compare, research-writer-start with confirmPaid: true, then continue until complete.',
    status: 400,
    data: { code: 'USE_CHECKPOINTED_WRITER' },
  };
}
