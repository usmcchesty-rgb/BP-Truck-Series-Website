import * as cheerio from 'cheerio';
import { getDriverProfiles } from './_lib.js';

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

async function detectLatestScheduleId(settings) {
  const fallbackScheduleId = settings.scheduleId || '346493';

  try {
    const scheduleHtml = await fetch(settings.scheduleUrl, {
      headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
    }).then((r) => (r.ok ? r.text() : ''));

    if (!scheduleHtml) return fallbackScheduleId;

    const $ = cheerio.load(scheduleHtml);
    const completedScheduleIds = [];

    $('table')
      .find('tr')
      .each((_i, tr) => {
        const tds = $(tr).find('td');
        if (!tds || tds.length < 7) return;

        const winnerText = cleanText(
          tds.eq(6).find('a').first().text() || tds.eq(6).text(),
        );
        if (!winnerText) return;

        $(tr)
          .find("a[href*='race']")
          .each((_idx, a) => {
            const href = String($(a).attr('href') || '');
            const match = href.match(/schedule_id=(\d+)/);
            if (match?.[1]) completedScheduleIds.push(String(match[1]));
          });
      });

    const seen = new Set();
    const orderedUnique = completedScheduleIds.filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return orderedUnique.length
      ? orderedUnique[orderedUnique.length - 1]
      : fallbackScheduleId;
  } catch {
    return fallbackScheduleId;
  }
}

export async function fetchStandingsRows(settings, scheduleId = null) {
  const seasonId = settings.seasonId || '27987';
  const resolvedScheduleId = scheduleId || (await detectLatestScheduleId(settings));

  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${resolvedScheduleId}`,
    { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } },
  );

  if (!response.ok) {
    throw new Error(`Standings fetch failed (${response.status})`);
  }

  const data = await response.json();
  const profiles = await getDriverProfiles();
  const byDriverId = Object.fromEntries(
    profiles.map((p) => [String(p.driver_id), p]),
  );

  const rows = Object.values(data.rps || {})
    .map((r) => {
      const driver = data.drivers?.[r.drid] || {};
      const rawName = driver.name || r.name || `Driver ${r.drid}`;
      const name = rawName.includes(',')
        ? rawName
            .split(',')
            .reverse()
            .map((s) => s.trim())
            .join(' ')
        : rawName;

      const profile = byDriverId[String(r.drid)] || null;
      const displayName = profile?.display_name || name;

      return {
        driverId: String(r.drid),
        driverName: displayName,
        carNumber: profile?.car_number || '',
        position: Number(r.pos2),
        previousPosition: Number(r.pos1),
        points: Number(r.tpts || 0),
        wins: Number(r.wins || 0),
        top5: Number(r.t5 || 0),
        top10: Number(r.t10 || 0),
        races: Number(r.counted || r.starts || 0),
      };
    })
    .filter((r) => r.position >= 1)
    .sort((a, b) => a.position - b.position);

  return {
    rows,
    scheduleId: resolvedScheduleId,
    seasonName: data.lss?.season_name || null,
    schedules: data.schedules || {},
    lss: data.lss || null,
  };
}

export function buildDriverLookup(standings, profiles) {
  const lookup = new Map();

  for (const row of standings) {
    lookup.set(String(row.driverId), row);
  }

  for (const profile of profiles) {
    const id = String(profile.driver_id);
    if (!lookup.has(id)) {
      lookup.set(id, {
        driverId: id,
        driverName: profile.display_name || profile.iracing_name,
        carNumber: profile.car_number || '',
      });
    }
  }

  return lookup;
}
