import { fetchHtml, getSettings, getDriverProfiles, guessStandings, slugify } from './_lib.js';
export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    const html = await fetchHtml(settings.standingsUrl);
    const match = html.match(/React\.createElement\(StandingsTable,\s*(\{.*?\})\s*\)\s*;/s);

if (!match) {
  return res.status(500).json({
    error: "Could not find StandingsTable JSON"
  });
}

return res.status(200).json({
  found: true,
  preview: match[1].substring(0, 1000)
});
    const profiles = await getDriverProfiles();
    const bySlug = Object.fromEntries(profiles.map(p => [p.slug, p]));
    const rows = guessStandings(html).map(r => ({ ...r, profile: bySlug[r.slug] || null, photoUrl: bySlug[r.slug]?.photo_url || `/assets/drivers/${r.slug}.png` }));
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({ settings, rows, updatedAt: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
