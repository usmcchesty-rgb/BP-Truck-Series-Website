import { fetchHtml } from '../api/_lib.js';

const html = await fetchHtml('https://www.simracerhub.com/league_series.php?league_id=1783');

const series = [];
for (const match of html.matchAll(/series\.push\(\{([^}]+)\}\)/g)) {
  const block = match[1];
  const sid = block.match(/sid:(\d+)/)?.[1];
  const sname = block.match(/sname:"([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
  const act = block.match(/act:(true|false)/)?.[1];
  if (sid && sname) series.push({ seriesId: sid, seriesName: sname, active: act === 'true' });
}

function parseSeasonsFromSeriesPage(html) {
  const seasons = [];
  const blockMatch = String(html || '').match(/seasons=\[(.*?)\];/s);
  if (!blockMatch) return seasons;
  for (const match of blockMatch[1].matchAll(/id:(\d+),sname:"([^"]+)"/g)) {
    seasons.push({ seasonId: match[1], seasonName: match[2] });
  }
  return seasons;
}

const catalog = [];
for (const s of series) {
  const page = await fetchHtml(`https://www.simracerhub.com/scoring/series_seasons.php?series_id=${s.seriesId}`);
  const seasons = parseSeasonsFromSeriesPage(page);
  catalog.push({ ...s, seasons });
}

console.log(JSON.stringify(catalog, null, 2));
