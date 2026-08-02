/**
 * Race Intelligence Package configuration.
 * Feature flag defaults OFF — existing news generation is unchanged until enabled.
 */

export const RACE_RESEARCH_PACKAGE_VERSION = '1.0';

export const TRANSCRIPT_CHUNK_TARGET_CHARACTERS = 10000;
export const TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS = 1000;

export const RACE_RESEARCH_EXTRACTION_VERSION = '2.0';

/** deterministic | hybrid | ai — default deterministic until verification complete */
export function getRaceResearchTranscriptMode() {
  const raw = String(process.env.RACE_RESEARCH_TRANSCRIPT_MODE || 'deterministic')
    .trim()
    .toLowerCase();
  if (raw === 'hybrid' || raw === 'ai' || raw === 'deterministic') return raw;
  return 'deterministic';
}

/** Explicit opt-in for diagnostic paid AI (compare-extractors --allow-ai). */
export function isRaceResearchDiagnosticAiAllowed(options = {}) {
  if (options.allowAi === true) return isRaceResearchAiExtractionEnabled();
  return false;
}

/** Max chunks processed per source without explicit admin force (cost protection). */
export const RACE_RESEARCH_MAX_CHUNKS_PER_SOURCE_DEFAULT = 24;

export const RACE_RESEARCH_SOURCE_TYPES = [
  'youtube_transcript',
  'saved_transcript',
  'race_control',
  'official_results',
  'qualifying',
  'standings',
  'schedule',
  'manual_notes',
  'previous_article',
  'power_rankings',
  'driver_profiles',
  'historical_results',
  'fantasy',
  'other',
];

export const RACE_RESEARCH_COVERAGE_WEIGHTS = {
  officialResults: 20,
  standings: 12,
  qualifying: 8,
  transcript: 15,
  raceControl: 15,
  historicalResults: 8,
  driverStats: 7,
  scheduleMetadata: 5,
  previousArticles: 3,
  manualNotes: 3,
  derivedFacts: 4,
};

export const ARTICLE_DEPTH_VALUES = ['short', 'medium', 'in-depth'];

export const ARTICLE_DEPTH_WORD_RANGES = {
  short: { minimum: 500, maximum: 800 },
  medium: { minimum: 1200, maximum: 1800 },
  'in-depth': { minimum: 2500, maximum: 4000 },
};

export const ARTICLE_DEPTH_EVIDENCE_GUIDELINES = {
  short: { factMin: 20, factMax: 35, driversMin: 3, driversMax: 5, quotesMax: 2 },
  medium: { factMin: 50, factMax: 90, driversMin: 6, driversMax: 10, quotesMax: 4 },
  'in-depth': { factMin: 100, factMax: 220, driversMin: 10, driversMax: 24, quotesMax: 12 },
};

export const ARTICLE_DEPTH_INPUT_TOKEN_BUDGET = {
  short: { min: 8000, max: 12000 },
  medium: { min: 16000, max: 28000 },
  'in-depth': { min: 35000, max: 60000 },
};

export const ARTICLE_DEPTH_OUTPUT_TOKEN_BUDGET = {
  short: { min: 1200, max: 1800 },
  medium: { min: 2500, max: 3500 },
  'in-depth': { min: 5000, max: 7000 },
};

/**
 * When true, news generation may supplement prompts with the Race Intelligence Package.
 * Default false unless env explicitly enables.
 */
export function isNewsIntelligencePackageEnabled() {
  const raw = String(process.env.NEWS_INTELLIGENCE_PACKAGE_ENABLED || '')
    .trim()
    .toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  return false;
}

/**
 * When true, transcript chunks may call OpenAI for structured extraction.
 * Tests should leave this false and inject extractors instead.
 */
export function isRaceResearchAiExtractionEnabled() {
  const raw = String(process.env.RACE_RESEARCH_AI_EXTRACTION_ENABLED || '')
    .trim()
    .toLowerCase();
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return Boolean(process.env.OPENAI_API_KEY);
}

export function normalizeArticleDepth(value) {
  const raw = String(value || 'medium')
    .trim()
    .toLowerCase();
  if (raw === 'indepth' || raw === 'in_depth') return 'in-depth';
  if (ARTICLE_DEPTH_VALUES.includes(raw)) return raw;
  return 'medium';
}
