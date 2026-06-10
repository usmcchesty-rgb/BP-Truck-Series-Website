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
  raceStartTime: '9:00 PM EST'
};

export function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getSettings() {
  const sb = supabase();
  if (!sb) return DEFAULTS;
  const { data, error } = await sb.from('site_settings').select('*').eq('id', 1).maybeSingle();
  if (error || !data) return DEFAULTS;
  return { ...DEFAULTS, ...data };
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
