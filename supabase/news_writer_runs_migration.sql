-- Phase 3b: resumable admin writer runs (preview / shadow). Additive only.
-- Apply in Supabase SQL editor before using checkpoint resume in production.

CREATE TABLE IF NOT EXISTS news_writer_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL CHECK (run_type IN ('multipass_preview', 'shadow_compare')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'partial', 'complete', 'failed', 'cancelled')
  ),
  season_id TEXT NOT NULL,
  race_number INTEGER NOT NULL,
  article_type TEXT NOT NULL DEFAULT 'race-recap',
  article_depth TEXT NOT NULL DEFAULT 'medium',
  package_fingerprint TEXT,
  current_step TEXT,
  steps_completed INTEGER NOT NULL DEFAULT 0,
  steps_total INTEGER,
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  openai_calls INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6),
  elapsed_ms BIGINT NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS news_writer_runs_season_race_idx
  ON news_writer_runs (season_id, race_number, created_at DESC);

CREATE INDEX IF NOT EXISTS news_writer_runs_status_idx
  ON news_writer_runs (status, updated_at DESC);

COMMENT ON TABLE news_writer_runs IS 'Checkpointed Phase 3b writer runs for admin preview/shadow (not production routing).';
