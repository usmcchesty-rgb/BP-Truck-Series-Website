const CACHE_TTL_MS = 60_000;

const htmlCache = new Map();
const standingsCache = new Map();
const scheduleRacesCache = new Map();

function readCache(store, key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(store, key, value) {
  store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function fetchCachedHtml(url, fetcher) {
  const cacheKey = String(url || '');
  const cached = readCache(htmlCache, cacheKey);
  if (cached != null) return cached;

  const html = await fetcher(url);
  writeCache(htmlCache, cacheKey, html);
  return html;
}

export function getCachedStandings(cacheKey) {
  return readCache(standingsCache, String(cacheKey || ''));
}

export function setCachedStandings(cacheKey, value) {
  writeCache(standingsCache, String(cacheKey || ''), value);
}

export function getCachedScheduleRaces(seasonId) {
  return readCache(scheduleRacesCache, String(seasonId || 'default'));
}

export function setCachedScheduleRaces(seasonId, scheduleRaces) {
  writeCache(scheduleRacesCache, String(seasonId || 'default'), scheduleRaces);
}

export function buildStandingsCacheKey(seasonId, scheduleId) {
  return `${String(seasonId || '27987')}:${String(scheduleId || 'latest')}`;
}
