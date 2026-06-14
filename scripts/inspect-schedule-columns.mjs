import { getSettings, fetchHtml } from '../api/_lib.js';
import * as cheerio from 'cheerio';

const settings = await getSettings();
const html = await fetchHtml(settings.scheduleUrl);
const $ = cheerio.load(html);
let count = 0;
$('table tr').each((_i, tr) => {
  const tds = $(tr).find('td');
  if (tds.length < 7) return;
  const cells = [];
  tds.each((j, td) => cells.push(String($(td).text() || '').trim().replace(/\s+/g, ' ').slice(0, 50)));
  const winner = String($(tds[6]).find('a').first().text() || $(tds[6]).text() || '').trim();
  const schedId = $(tr).find("a[href*='schedule_id=']").first().attr('href')?.match(/schedule_id=(\d+)/)?.[1];
  console.log(`Row ${count + 1}: cols=${cells.length} schedId=${schedId}`);
  cells.forEach((c, i) => console.log(`  [${i}] ${c}`));
  console.log(`  winner: ${winner}`);
  console.log('');
  count += 1;
  if (count >= 20) return false;
});
