/** Phase 3a deterministic planner — frozen after final cleanup; bump only for planner bugfixes. */
export const NEWS_WRITER_PLANNER_VERSION = '1.2.0';

export const STORY_CATEGORY_ORDER = [
  'lead_story',
  'secondary_story',
  'championship_story',
  'human_story',
  'technical_story',
  'feature_story',
  'hidden_story',
  'momentum_story',
  'strategy_story',
  'controversy_story',
];

export const RACE_TEMPERATURE_TAGS = [
  'routine',
  'competitive',
  'chaotic',
  'historic',
  'championship_defining',
  'emotional',
  'controversial',
  'technical',
  'fuel_mileage',
  'rain_affected',
];

export const TAKEAWAY_MAX_BY_DEPTH = {
  short: 3,
  medium: 6,
  'in-depth': 10,
};

export const OUTLINE_SECTION_TYPES = [
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

/** Primary planning-quality targets (canonical event coverage). */
export const CANONICAL_COVERAGE_TARGETS = {
  short: { critical: 60, high: 40 },
  medium: { critical: 85, high: 65 },
  'in-depth': { critical: 95, high: 80 },
};
