import { fetchHtml, getSettings, getDriverProfiles, slugify } from './_lib.js';

function extractStandingsProps(html) {
  const marker = 'React.createElement(StandingsTable,';
  const start = html.indexOf(marker);

  if (start < 0) {
    throw new Error('Could not find StandingsTable data');
  }

  const jsonStart = html.indexOf('{', start);
  if (jsonStart < 0) {
    throw new Error('Could not find JSON start');
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;

      if (depth === 0) {
        return JSON.parse(html.slice(jsonStart, i + 1));
      }
    }
  }

  throw new Error('Could not find JSON end');
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
