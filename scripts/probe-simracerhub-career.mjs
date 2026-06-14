import * as cheerio from 'cheerio';

const standingsHtml = await fetch(
  'https://www.simracerhub.com/scoring/season_standings.php?season_id=27987',
  { headers: { 'user-agent': 'BP/1.0' } }
).then((r) => r.text());

const $ = cheerio.load(standingsHtml);
console.log('title:', $('title').text());
console.log(
  'select count:',
  $('select')
    .map((_i, el) => ({
      id: $(el).attr('id'),
      name: $(el).attr('name'),
      options: $(el)
        .find('option')
        .map((_j, opt) => ({ value: $(opt).attr('value'), text: $(opt).text().trim() }))
        .get(),
    }))
    .get()
);

const links = [];
$('a[href*="season_id="]').each((_i, el) => {
  links.push({ href: $(el).attr('href'), text: $(el).text().trim() });
});
console.log('season links sample:', links.slice(0, 20));

const scripts = [];
$('script').each((_i, el) => {
  const text = $(el).html() || '';
  if (/season/i.test(text) && text.length < 5000) scripts.push(text.slice(0, 500));
});
console.log('script snippets with season:', scripts.slice(0, 5));

const data = await fetch(
  'https://www.simracerhub.com/scoring/get_standings.php?season_id=27987&schedule_id=346493',
  { headers: { 'user-agent': 'BP/1.0' } }
).then((r) => r.json());

console.log('lss league_id:', data.lss?.league_id, 'season_ids:', data.lss?.season_ids);

for (const url of [
  'https://www.simracerhub.com/scoring/season_standings.php?league_id=1783',
  'https://www.simracerhub.com/scoring/league.php?league_id=1783',
  'https://www.simracerhub.com/scoring/season_list.php?league_id=1783',
]) {
  const res = await fetch(url, { headers: { 'user-agent': 'BP/1.0' } });
  const text = await res.text();
  const ids = [...text.matchAll(/season_id=(\d+)/g)].map((m) => m[1]);
  console.log('\n', url, res.status, 'unique season ids:', [...new Set(ids)].slice(0, 20));
}
