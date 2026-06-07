import { fetchHtml, getSettings, getDriverProfiles, slugify } from './_lib.js';

function extractStandingsProps(html) {
  const marker = 'React.createElement(StandingsTable,';
  const start = html.indexOf(marker);

  if (start < 0) {
    throw new Error('Could not find StandingsTable data');
  }

  const after = html.slice(start + marker.length);

  const end = after.indexOf('\n\t);');

  if (end < 0) {
    throw new Error('Could not find end of StandingsTable data');
  }

  return JSON.parse(after.slice(0, end).trim());
}

export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    const html = await fetchHtml(settings.standingsUrl);
    const props = extractStandingsProps(html);

    const profiles = await getDriverProfiles();
    const bySlug = Object.fromEntries(profiles.map(p => [p.slug, p]));

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    res.status(200).json({
      settings: {
        ...settings,
        playoffCut: props.chase_cutoff || settings.playoffCut
      },
      raw: props,
      schedules: props.schedules || [],
      rows: [],
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
