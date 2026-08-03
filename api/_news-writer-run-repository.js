import { supabase } from './_lib.js';

export const NEWS_WRITER_RUNS_MIGRATION_HINT =
  'Phase 3b writer checkpoints require supabase/news_writer_runs_migration.sql (additive).';

let runsTableProbeCache = null;

export async function checkNewsWriterRunsTableReady(sb = supabase) {
  if (!sb) {
    return { configured: false, ready: false, hint: NEWS_WRITER_RUNS_MIGRATION_HINT };
  }
  if (runsTableProbeCache) return runsTableProbeCache;
  const { error } = await sb.from('news_writer_runs').select('id').limit(1);
  if (error) {
    const missing =
      error.code === '42P01' ||
      String(error.message || '').includes('news_writer_runs') ||
      error.code === 'PGRST205';
    runsTableProbeCache = {
      configured: true,
      ready: !missing,
      hint: missing ? NEWS_WRITER_RUNS_MIGRATION_HINT : error.message,
      error: missing ? null : error.message,
    };
    return runsTableProbeCache;
  }
  runsTableProbeCache = { configured: true, ready: true, hint: null };
  return runsTableProbeCache;
}

export function clearNewsWriterRunsTableProbeCache() {
  runsTableProbeCache = null;
}

function rowToRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    runType: row.run_type,
    status: row.status,
    seasonId: row.season_id,
    raceNumber: row.race_number,
    articleType: row.article_type,
    articleDepth: row.article_depth,
    packageFingerprint: row.package_fingerprint,
    currentStep: row.current_step,
    stepsCompleted: row.steps_completed,
    stepsTotal: row.steps_total,
    checkpoint: row.checkpoint || {},
    result: row.result,
    openaiCalls: row.openai_calls,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    elapsedMs: row.elapsed_ms,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export async function createNewsWriterRun(
  {
    runType,
    seasonId,
    raceNumber,
    articleType,
    articleDepth,
    packageFingerprint,
    currentStep,
    stepsTotal,
    checkpoint,
    estimatedCostUsd,
  },
  sb = supabase
) {
  const { data, error } = await sb
    .from('news_writer_runs')
    .insert({
      run_type: runType,
      season_id: String(seasonId),
      race_number: Number(raceNumber),
      article_type: articleType,
      article_depth: articleDepth,
      package_fingerprint: packageFingerprint,
      current_step: currentStep,
      steps_total: stepsTotal,
      checkpoint,
      estimated_cost_usd: estimatedCostUsd ?? null,
      status: 'running',
    })
    .select('*')
    .single();
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return rowToRun(data);
}

export async function getNewsWriterRun(runId, sb = supabase) {
  const { data, error } = await sb.from('news_writer_runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return rowToRun(data);
}

export async function updateNewsWriterRun(runId, patch, sb = supabase) {
  const row = {};
  if (patch.status != null) row.status = patch.status;
  if (patch.currentStep != null) row.current_step = patch.currentStep;
  if (patch.stepsCompleted != null) row.steps_completed = patch.stepsCompleted;
  if (patch.stepsTotal != null) row.steps_total = patch.stepsTotal;
  if (patch.checkpoint != null) row.checkpoint = patch.checkpoint;
  if (patch.result != null) row.result = patch.result;
  if (patch.openaiCalls != null) row.openai_calls = patch.openaiCalls;
  if (patch.promptTokens != null) row.prompt_tokens = patch.promptTokens;
  if (patch.completionTokens != null) row.completion_tokens = patch.completionTokens;
  if (patch.estimatedCostUsd != null) row.estimated_cost_usd = patch.estimatedCostUsd;
  if (patch.elapsedMs != null) row.elapsed_ms = patch.elapsedMs;
  if (patch.errorMessage != null) row.error_message = patch.errorMessage;
  if (patch.packageFingerprint != null) row.package_fingerprint = patch.packageFingerprint;
  if (patch.completedAt != null) row.completed_at = patch.completedAt;
  row.updated_at = new Date().toISOString();

  const { data, error } = await sb.from('news_writer_runs').update(row).eq('id', runId).select('*').single();
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return rowToRun(data);
}

export async function cancelNewsWriterRun(runId, sb = supabase) {
  return updateNewsWriterRun(
    runId,
    {
      status: 'cancelled',
      errorMessage: 'Cancelled by admin.',
      completedAt: new Date().toISOString(),
    },
    sb
  );
}
