import { getSettings, getDriverProfiles, slugify } from './_lib.js';

export default async function handler(req, res) {
  try {
    const settings = await getSettings();
    const seasonId = settings.seasonId || '27987';
const scheduleId = settings.scheduleId || '346493';

const response = await fetch(
  `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${scheduleId}`
);

    const data = await response.json();
    const profiles = await getDriverProfiles();
    const byDriverId = Object.fromEntries(profiles.map(p => [String(p.driver_id), p]));

    const rows = Object.values(data.rps || {})
      .map(r => {
        const driver = data.drivers?.[r.drid] || {};
        const rawName = driver.name || r.name || `Driver ${r.drid}`;
        const name = rawName.includes(',')
          ? rawName.split(',').reverse().map(s => s.trim()).join(' ')
          : rawName;

        const slug = slugify(name);
        const profile = byDriverId[String(r.drid)] || null;
        const displayName = profile?.display_name || name;
        const finishes = [];

for (const schedule of Object.values(data.schedules || {})) {
  const drivers = schedule?.drivers || {};

  for (const race of Object.values(drivers)) {
    const result = race?.[r.drid];

    if (result?.finish_pos) {
      finishes.push(Number(result.finish_pos));
    }
  }
}

const avgFinish =
  finishes.length > 0
    ? Number(
        (finishes.reduce((a, b) => a + b, 0) / finishes.length).toFixed(1)
      )
    : null;

        return {
          position: Number(r.pos1),
          previousPosition: Number(r.pos2),
          gainLoss: Number(r.pos2 || r.pos1) - Number(r.pos1 || r.pos2),
          driver: displayName,
          driverId: r.drid,
          carNumber: profile?.car_number || '',
          points: Number(r.tpts || 0),
          races: Number(r.counted || r.starts || 0),
          starts: Number(r.starts || 0),
          wins: Number(r.wins || 0),
          top5: Number(r.t5 || 0),
          top10: Number(r.t10 || 0),
          poles: Number(r.poles || 0),
          lapsLed: Number(r.led || 0),
          incidents: Number(r.inc || 0),
          avgFinish,
          profile,
          photoUrl: profile?.photo_url || `/assets/drivers/${slug}.png`,
          active: profile?.active ?? true
        };
      })
      .filter(r => r.position >= 1)
      .sort((a, b) => a.position - b.position);

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
    return res.status(200).json({
      settings: {
        seriesName: 'Blazing Pedals Truck Series',
        seasonName: data.lss?.season_name || 'Season 11',
        playoffCut: 16
      },
      rows,
      schedules: data.schedules || [],
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}