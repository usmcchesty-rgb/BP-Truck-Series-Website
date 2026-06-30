import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

export const DEFAULTS = {
  seriesName: 'Blazing Pedals Truck Series',
  seasonName: 'Season 11',
  standingsUrl: 'https://www.simracerhub.com/scoring/season_standings.php?season_id=27987',
  scheduleUrl: 'https://www.simracerhub.com/scoring/season_schedule.php?season_id=27987',
  seasonId: '27987',
  scheduleId: '346493',
  playoffCut: 16,
  refreshSeconds: 60,
  raceStartTime: '9:00 PM EST',
  raceCompletionBufferMinutes: 180,
  leagueFacebookUrl: 'https://www.facebook.com/blazingpedalsracingleague/',
  headerLogoUrl: '',
  headerLogoAltText: 'Blazing Pedals Truck Series',
  headerLogoUpdatedAt: null,
  milesApexImageUrl: '',
  milesApexImageUpdatedAt: null,
  milesApexImageZoom: 1,
  milesApexImageX: 50,
  milesApexImageY: 50,
  powerRankingsFormulaImageUrl: '',
  powerRankingsFormulaImageUpdatedAt: null,
  fantasyHeroBackgroundUrl: '',
  fantasyHeroBackgroundUpdatedAt: null,
  fantasyHeaderLogoUrl: '',
  fantasyHeaderLogoUpdatedAt: null,
  fantasyHeaderLogoTopPercent: 21,
  fantasyHeaderLogoWidthVw: 32,
  fantasyHeaderLogoMaxWidthPx: 560,
};

export function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export function buildTrackImagesSettings() {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const configured = Boolean(base && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return {
    trackImagesStorageConfigured: configured,
    trackImagesPublicBaseUrl: configured
      ? `${base}/storage/v1/object/public/track-images/tracks`
      : null,
    trackImageVersions: {},
  };
}

export async function buildTrackImagesSettingsAsync() {
  const baseSettings = buildTrackImagesSettings();
  if (!baseSettings.trackImagesStorageConfigured) {
    return baseSettings;
  }
  const { loadTrackImageVersions } = await import('./_track-image-versions.js');
  const trackImageVersions = await loadTrackImageVersions();
  return { ...baseSettings, trackImageVersions };
}

export async function getSettings() {
  const { SOCIAL_SHARE_DEFAULTS } = await import('./_social-share-settings.js');
  const trackImages = await buildTrackImagesSettingsAsync();
  const base = { ...DEFAULTS, ...SOCIAL_SHARE_DEFAULTS, ...trackImages };
  const sb = supabase();
  if (!sb) return base;
  const { data, error } = await sb.from('site_settings').select('*').eq('id', 1).maybeSingle();
  if (error || !data) return base;
  const mergedVersions = {
    ...(trackImages.trackImageVersions || {}),
    ...(data.trackImageVersions && typeof data.trackImageVersions === 'object'
      ? data.trackImageVersions
      : {}),
  };
  return {
    ...base,
    ...data,
    ...buildTrackImagesSettings(),
    trackImageVersions: mergedVersions,
  };
}

export async function getDriverProfiles() {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb.from('driver_profiles').select('*').order('iracing_name');
  if (error) return [];
  return data || [];
}

export async function fetchHtml(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } });
  if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
  return await r.text();
}

export function slugify(name='') {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function stripPhotoUrlQuery(photoUrl) {
  const url = String(photoUrl || '').trim();
  if (!url) return '';
  return url.split('?')[0].split('#')[0];
}

export function photoCacheVersion(updatedAt) {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function withPhotoCacheBust(photoUrl, version) {
  const clean = stripPhotoUrlQuery(photoUrl);
  if (!clean) return clean;
  if (version == null || version === '') return clean;
  return `${clean}?v=${encodeURIComponent(version)}`;
}

export const DEFAULT_LEAGUE_FACEBOOK_URL = 'https://www.facebook.com/blazingpedalsracingleague/';

export function resolveLeagueFacebookUrl(settings = {}) {
  if (settings.leagueFacebookUrl === '') return '';
  return String(settings.leagueFacebookUrl || DEFAULT_LEAGUE_FACEBOOK_URL).trim();
}

export const DEFAULT_HEADER_LOGO_URL = '/assets/logos/New%20Clean%20Logo.png';

export function resolveHeaderLogoUrl(settings = {}) {
  const custom = stripPhotoUrlQuery(settings.headerLogoUrl || '');
  return custom || DEFAULT_HEADER_LOGO_URL;
}

export function resolveHeaderLogoAlt(settings = {}) {
  const alt = String(settings.headerLogoAltText || '').trim();
  return alt || DEFAULTS.headerLogoAltText;
}

export function resolveHeaderLogoDisplayUrl(settings = {}) {
  const url = resolveHeaderLogoUrl(settings);
  if (!settings.headerLogoUrl) return url;
  const version = photoCacheVersion(settings.headerLogoUpdatedAt) || Date.now();
  return withPhotoCacheBust(url, version);
}

export function resolveMilesApexImageUrl(settings = {}) {
  return stripPhotoUrlQuery(settings.milesApexImageUrl || '');
}

export function resolveMilesApexCrop(settings = {}) {
  const zoom = Number(settings.milesApexImageZoom);
  const x = Number(settings.milesApexImageX);
  const y = Number(settings.milesApexImageY);
  return {
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
    y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
  };
}

export function resolveMilesApexImageDisplayUrl(settings = {}) {
  const url = resolveMilesApexImageUrl(settings);
  if (!url) return '';
  const version = photoCacheVersion(settings.milesApexImageUpdatedAt) || Date.now();
  return withPhotoCacheBust(url, version);
}

export const DEFAULT_POWER_RANKINGS_FORMULA_IMAGE_URL =
  '/assets/power-rankings/formula.png';

export function resolvePowerRankingsFormulaImageUrl(settings = {}) {
  const custom = stripPhotoUrlQuery(settings.powerRankingsFormulaImageUrl || '');
  return custom || DEFAULT_POWER_RANKINGS_FORMULA_IMAGE_URL;
}

export function resolvePowerRankingsFormulaImageDisplayUrl(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.powerRankingsFormulaImageUrl || '');
  const url = stored || DEFAULT_POWER_RANKINGS_FORMULA_IMAGE_URL;
  const version = stored
    ? photoCacheVersion(settings.powerRankingsFormulaImageUpdatedAt) || Date.now()
    : null;
  return version ? withPhotoCacheBust(url, version) : url;
}

export const DEFAULT_FANTASY_HERO_BACKGROUND_URL = '/assets/fantasy/hero-background.jpg';
export const DEFAULT_FANTASY_HEADER_LOGO_URL = '/assets/fantasy/fantasy-logo.png';

export function resolveFantasyHeroBackgroundUrl(settings = {}) {
  const custom = stripPhotoUrlQuery(settings.fantasyHeroBackgroundUrl || '');
  return custom || DEFAULT_FANTASY_HERO_BACKGROUND_URL;
}

export function resolveFantasyHeroBackgroundDisplayUrl(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeroBackgroundUrl || '');
  const url = stored || DEFAULT_FANTASY_HERO_BACKGROUND_URL;
  const version = stored
    ? photoCacheVersion(settings.fantasyHeroBackgroundUpdatedAt) || Date.now()
    : null;
  return version ? withPhotoCacheBust(url, version) : url;
}

export function resolveFantasyHeaderLogoUrl(settings = {}) {
  const custom = stripPhotoUrlQuery(settings.fantasyHeaderLogoUrl || '');
  return custom || DEFAULT_FANTASY_HEADER_LOGO_URL;
}

export function resolveFantasyHeaderLogoDisplayUrl(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeaderLogoUrl || '');
  const url = stored || DEFAULT_FANTASY_HEADER_LOGO_URL;
  const version = stored
    ? photoCacheVersion(settings.fantasyHeaderLogoUpdatedAt) || Date.now()
    : null;
  return version ? withPhotoCacheBust(url, version) : url;
}

export function num(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,/g,'').trim();
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export function parseTables(html) {
  const $ = cheerio.load(html);
  const tables = [];
  $('table').each((_, table) => {
    const headers = [];
    $(table).find('tr').first().find('th,td').each((_, c) => headers.push($(c).text().replace(/\s+/g,' ').trim()));
    const rows = [];
    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = [];
      $(tr).find('td,th').each((_, c) => cells.push($(c).text().replace(/\s+/g,' ').trim()));
      if (cells.length) rows.push(cells);
    });
    tables.push({ headers, rows });
  });
  return tables;
}

export function guessStandings(html) {
  const tables = parseTables(html);
  let best = tables.find(t => t.headers.join(' ').match(/driver/i) && t.headers.join(' ').match(/points/i));
  if (!best) best = tables.find(t => t.rows.length > 5);
  if (!best) return [];
  const h = best.headers.map(x => x.toLowerCase());
  const find = (...keys) => h.findIndex(x => keys.some(k => x.includes(k)));
  const posI = find('place','pos','rank');
  const driverI = find('driver');
  const gainI = find('gain','loss','change');
  const ptsI = find('points','pts');
  const behindI = find('behind','back');
  const racesI = find('races','completed','starts');
  const avgI = find('avg','average');
  const winsI = find('wins','win');
  const top5I = find('top 5','top5');
  const top10I = find('top 10','top10');
  return best.rows.map((r, i) => ({
    position: num(r[posI]) || i + 1,
    driver: r[driverI] || r[1] || `Driver ${i+1}`,
    gainLoss: gainI >= 0 ? r[gainI] : '',
    points: ptsI >= 0 ? num(r[ptsI]) : null,
    behind: behindI >= 0 ? r[behindI] : '',
    races: racesI >= 0 ? num(r[racesI]) : null,
    avgFinish: avgI >= 0 ? num(r[avgI]) : null,
    wins: winsI >= 0 ? num(r[winsI]) : null,
    top5: top5I >= 0 ? num(r[top5I]) : null,
    top10: top10I >= 0 ? num(r[top10I]) : null,
    slug: slugify(r[driverI] || r[1] || `Driver ${i+1}`)
  })).filter(x => x.driver && !/driver/i.test(x.driver));
}

export function guessSchedule(html) {
  const $ = cheerio.load(html);
  const text = $('body').text().replace(/\s+/g,' ');
  const rows = [];
  // Fallback regex based on SimRacerHub text layout
  const re = /(\d+)\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s+(Yes|No)\s+(.+?)\s+(\d+\s+Laps)(?:\s+([A-Z][A-Za-z0-9 '\-]+?))?(?=\s+\d+\s+[A-Z][a-z]{2}|\s+Round of|\s*$)/g;
  let m;
  while ((m = re.exec(text)) && rows.length < 60) {
    let eventTrack = m[4].replace(/NASCAR Truck (Chevrolet Silverado|Ford F150|RAM|Toyota Tundra TRD Pro)\s*/g,'').trim();
    rows.push({ race: Number(m[1]), date: m[2], points: m[3], track: eventTrack, length: m[5], winner: (m[6] || '').trim() });
  }
  const completed = rows.filter(r => r.winner).length;
  const next = rows.find(r => !r.winner && r.points === 'Yes') || rows.find(r => !r.winner) || null;
  return { races: rows, completed, totalPointsRaces: rows.filter(r => r.points === 'Yes').length, next };
}
