/** Phase 3b multi-pass writer — disabled by default; does not replace legacy generator. */
export const NEWS_WRITER_MULTIPASS_VERSION = '1.0.0';

export function isNewsWriterMultipassEnabled() {
  return String(process.env.NEWS_WRITER_MULTIPASS_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

export function isNewsWriterShadowModeEnabled() {
  return String(process.env.NEWS_WRITER_SHADOW_MODE || '').trim().toLowerCase() === 'true';
}

/** Rough USD estimate for gpt-4o-mini (adjust if OPENAI_MODEL differs). */
export function estimateOpenAiCostUsd({ promptTokens = 0, completionTokens = 0, model } = {}) {
  const m = String(model || process.env.OPENAI_MODEL || 'gpt-4o-mini');
  if (m.includes('gpt-4o') && !m.includes('mini')) {
    return (promptTokens / 1e6) * 2.5 + (completionTokens / 1e6) * 10;
  }
  return (promptTokens / 1e6) * 0.15 + (completionTokens / 1e6) * 0.6;
}

/** Fixed section generation order (skip if absent from outline). */
export const SECTION_WRITE_ORDER = [
  'introduction',
  'race_summary',
  'battle_for_win',
  'strategy',
  'key_incidents',
  'driver_stories',
  'championship_picture',
  'looking_ahead',
  'controversy',
];

export const MULTIPASS_OPENAI_MAX_SECTION_TOKENS = 900;
export const MULTIPASS_OPENAI_EDITOR_MAX_TOKENS = 2800;
export const MULTIPASS_OPENAI_HEADLINE_MAX_TOKENS = 600;
