import { fetchHtml } from '../api/_lib.js';

const seasonIds = ['27987', '25227', '21817', '20761', '17647', '15704', '13228', '9334', '8703', '8313', '8232'];

for (const seasonId of seasonIds) {
  try {
    const res = await fetch(
      `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}`,
      { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
    );
    const data = await res.json();
    const drivers = Object.keys(data.rps || {}).length;
    const sample = Object.values(data.rps || {}).slice(0, 2).map((r) => ({
      drid: r.drid,
      starts: r.counted || r.starts,
      wins: r.wins,
    }));
    console.log(seasonId, data.lss?.season_name, 'drivers', drivers, 'sample', sample);
  } catch (err) {
    console.log(seasonId, 'ERR', err.message);
  }
}
