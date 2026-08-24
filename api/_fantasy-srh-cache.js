const DEFAULT_CACHE_TTL_MS = 60_000;
const SCHEDULE_HTML_TTL_MS = 5 * 60_000;
const STANDINGS_JSON_TTL_MS = 2 * 60_000;
const RACE_RESULT_HTML_TTL_MS = 60 * 60_000;
const CAUTION_SEASON_TTL_MS = 30 * 60_000;
const CAUTION_RACE_TTL_MS = 60 * 60_000;

const htmlCache = new Map();
const standingsCache = new Map();
const scheduleRacesCache = new Map();
const cautionSeasonCache = new Map();
const cautionRaceCache = new Map();

function readCache(store, key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(store, key, value, ttlMs = DEFAULT_CACHE_TTL_MS) {
  store.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1_000, Number(ttlMs) || DEFAULT_CACHE_TTL_MS),
  });
}

/** Choose HTML cache TTL from URL shape. Historical race pages are effectively immutable. */
export function resolveHtmlCacheTtl(url) {
  const text = String(url || '');
  if (/season_schedule\.php/i.test(text)) return SCHEDULE_HTML_TTL_MS;
  if (/season_race\.php|\/race\.php/i.test(text)) return RACE_RESULT_HTML_TTL_MS;
  return DEFAULT_CACHE_TTL_MS;
}

export async function fetchCachedHtml(url, fetcher, ttlMs = null) {
  const cacheKey = String(url || '');
  const cached = readCache(htmlCache, cacheKey);
  if (cached != null) return cached;

  const html = await fetcher(url);
  writeCache(
    htmlCache,
    cacheKey,
    html,
    ttlMs == null ? resolveHtmlCacheTtl(cacheKey) : ttlMs
  );
  return html;
}

export function getCachedStandings(cacheKey) {
  return readCache(standingsCache, String(cacheKey || ''));
}

export function setCachedStandings(cacheKey, value) {
  writeCache(
    standingsCache,
    String(cacheKey || ''),
    value,
    STANDINGS_JSON_TTL_MS
  );
}

export function getCachedScheduleRaces(seasonId) {
  return readCache(scheduleRacesCache, String(seasonId || 'default'));
}

export function setCachedScheduleRaces(seasonId, scheduleRaces) {
  writeCache(
    scheduleRacesCache,
    String(seasonId || 'default'),
    scheduleRaces,
    SCHEDULE_HTML_TTL_MS
  );
}

export function buildStandingsCacheKey(seasonId, scheduleId) {
  return `${String(seasonId || '27987')}:${String(scheduleId || 'latest')}`;
}

export function buildCautionSeasonCacheKey(completedRaceKeys = []) {
  return `caution-season:${completedRaceKeys.join('|')}`;
}

export function getCachedCautionSeason(cacheKey) {
  return readCache(cautionSeasonCache, String(cacheKey || ''));
}

export function setCachedCautionSeason(cacheKey, value) {
  writeCache(
    cautionSeasonCache,
    String(cacheKey || ''),
    value,
    CAUTION_SEASON_TTL_MS
  );
}

export function getCachedRaceCautionCount(scheduleId) {
  return readCache(cautionRaceCache, String(scheduleId || ''));
}

export function setCachedRaceCautionCount(scheduleId, value) {
  writeCache(
    cautionRaceCache,
    String(scheduleId || ''),
    value,
    CAUTION_RACE_TTL_MS
  );
}

export const SRH_CACHE_TTL = {
  DEFAULT_CACHE_TTL_MS,
  SCHEDULE_HTML_TTL_MS,
  STANDINGS_JSON_TTL_MS,
  RACE_RESULT_HTML_TTL_MS,
  CAUTION_SEASON_TTL_MS,
  CAUTION_RACE_TTL_MS,
};
