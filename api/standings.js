import { fetchHtml, getSettings, getDriverProfiles, guessStandings, slugify } from './_lib.js';
export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    const html = await fetchHtml(settings.standingsUrl);
    const marker = 'React.createElement(StandingsTable,';
const start = html.indexOf(marker);

if (start < 0) {
  return res.status(500).json({
    error: "Could not find StandingsTable marker",
    hasStandingsTable: html.includes('StandingsTable'),
    hasReactCreate: html.includes('React.createElement'),
    tail: html.slice(-2000)
  });
}

const after = html.slice(start + marker.length);
const end = after.indexOf(');');

return res.status(200).json({
  found: true,
  preview: after.slice(0, 3000),
  endIndex: end
});
    const profiles = await getDriverProfiles();
    const bySlug = Object.fromEntries(profiles.map(p => [p.slug, p]));
    const rows = guessStandings(html).map(r => ({ ...r, profile: bySlug[r.slug] || null, photoUrl: bySlug[r.slug]?.photo_url || `/assets/drivers/${r.slug}.png` }));
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({ settings, rows, updatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
