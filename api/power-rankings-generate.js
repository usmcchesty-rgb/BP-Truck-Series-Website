import * as cheerio from 'cheerio';
import { fetchHtml, getDriverProfiles, getSettings, slugify, supabase } from './_lib.js';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function parseScheduleRaces(html) {
  const $ = cheerio.load(html);
  const races = [];

  $('table').each((_tableIndex, table) => {
    $(table)
      .find('tr')
      .each((_rowIndex, row) => {
        const cells = $(row).find('td');
        if (cells.length < 7) return;

        const raceNumber = cleanText(cells.eq(0).text());
        if (!/^\d+$/.test(raceNumber)) return;

        const winner = cleanText(
          cells.eq(6).find('a').first().text() || cells.eq(6).text()
        );

        races.push({
          raceNumber: Number(raceNumber),
          date: cleanText(cells.eq(1).text()),
          track: cleanText(cells.eq(4).find('a').first().text() || cells.eq(4).text()),
          winner: winner || null,
        });
      });
  });

  return races;
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
          tds.eq(6).find('a').first().text() || tds.eq(6).text()
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

async function fetchStandingsRows(settings) {
  const seasonId = settings.seasonId || '27987';
  const scheduleId = await detectLatestScheduleId(settings);

  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}&schedule_id=${scheduleId}`,
    { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
  );

  if (!response.ok) {
    throw new Error(`Standings fetch failed (${response.status})`);
  }

  const data = await response.json();
  const profiles = await getDriverProfiles();
  const byDriverId = Object.fromEntries(
    profiles.map((p) => [String(p.driver_id), p])
  );

  return Object.values(data.rps || {})
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
}

async function loadPreviousPowerRankings(beforeRaceNumber) {
  const sb = supabase();
  if (!sb) return null;

  const { data: weeks, error } = await sb
    .from('power_rankings_weeks')
    .select('*')
    .eq('published', true)
    .lt('race_number', beforeRaceNumber)
    .order('race_number', { ascending: false })
    .limit(1);

  if (error || !weeks?.length) return null;

  const week = weeks[0];
  const { data: entries } = await sb
    .from('power_rankings_entries')
    .select('*')
    .eq('week_id', week.id)
    .order('rank');

  const profiles = await getDriverProfiles();
  const byId = Object.fromEntries(profiles.map((p) => [String(p.driver_id), p]));

  return {
    raceNumber: week.race_number,
    entries: (entries || []).map((entry) => ({
      rank: entry.rank,
      driverId: String(entry.driver_id),
      driverName:
        byId[String(entry.driver_id)]?.display_name ||
        byId[String(entry.driver_id)]?.iracing_name ||
        entry.driver_id,
      subtitle: entry.subtitle || '',
    })),
  };
}

function buildContextPayload({ raceNumber, standings, scheduleRaces, previousRankings, profiles }) {
  const completedRaces = scheduleRaces
    .filter((race) => race.winner && race.raceNumber <= raceNumber)
    .slice(-5);

  const recentResults = completedRaces.map((race) => ({
    raceNumber: race.raceNumber,
    date: race.date,
    track: race.track,
    winner: race.winner,
  }));

  return {
    raceNumber,
    season: 'Blazing Pedals Truck Series',
    standings: standings.slice(0, 20).map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
      pointsPosition: row.position,
      points: row.points,
      wins: row.wins,
      top5: row.top5,
      top10: row.top10,
      races: row.races,
    })),
    recentResults,
    previousPowerRankings: previousRankings,
    drivers: standings.map((row) => ({
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
    })),
    savedProfiles: profiles.slice(0, 40).map((p) => ({
      driverId: String(p.driver_id),
      driverName: p.display_name || p.iracing_name,
      carNumber: p.car_number || '',
    })),
  };
}

const SYSTEM_PROMPT = `You write weekly Power Rankings for the Blazing Pedals Truck Series, a competitive iRacing NASCAR Truck league.

Write like a fellow racer breaking down the field — not corporate, not robotic, not repetitive.

Return ONLY valid JSON with this shape:
{
  "entries": [
    {
      "rank": 1,
      "driverId": "string",
      "movement": 0,
      "subtitle": "string",
      "writeup": "string"
    }
  ],
  "honorableMentions": [
    {
      "driverId": "string",
      "writeup": "string"
    }
  ]
}

Rules:
- Exactly 10 entries with ranks 1 through 10.
- Each driverId MUST come from the provided drivers list. No duplicates.
- Subtitles are unique custom headlines tied to that driver's story this week. Do NOT pick from a fixed category list. Do NOT use generic labels like "Hot Streak" unless it truly fits.
- Writeups are 2-4 sentences each, conversational, specific to recent form and stats provided.
- movement is an integer: positive = moved UP vs previous power rankings (▲), negative = moved DOWN (▼), 0 = unchanged (—). Compare against previousPowerRankings when available. If a driver was not ranked last week but is now, use a positive movement reflecting their debut rank (e.g. entered at #8 -> movement +2 if you treat unranked as outside top 10, or use your best judgment with a positive value). If no previous rankings exist, use 0 for all movement.
- honorableMentions: 0 to 3 entries only when truly warranted. Omit the array or return [] if none.
- Rank drivers on recent race performance, momentum, consistency, and championship relevance — not points order alone.`;

async function callOpenAi(contextPayload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in Vercel environment variables.');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      max_tokens: 4500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Generate Race ${contextPayload.raceNumber} power rankings using this data:\n${JSON.stringify(contextPayload, null, 2)}`,
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI request failed (${response.status})`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response.');
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('OpenAI returned invalid JSON.');
  }
}

function buildDriverLookup(standings, profiles) {
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

function normalizeDraft(aiDraft, driverLookup, previousRankings) {
  const previousRankByDriver = Object.fromEntries(
    (previousRankings?.entries || []).map((entry) => [
      String(entry.driverId),
      Number(entry.rank),
    ])
  );

  const entries = Array.isArray(aiDraft?.entries) ? aiDraft.entries : [];
  if (entries.length !== 10) {
    throw new Error('AI draft must include exactly 10 ranked drivers.');
  }

  const usedDrivers = new Set();
  const normalizedEntries = [];

  for (let expectedRank = 1; expectedRank <= 10; expectedRank += 1) {
    const raw =
      entries.find((entry) => Number(entry.rank) === expectedRank) || entries[expectedRank - 1];

    const driverId = String(raw?.driverId || raw?.driver_id || '').trim();
    if (!driverId || !driverLookup.has(driverId)) {
      throw new Error(`AI draft rank ${expectedRank} has an invalid driverId.`);
    }
    if (usedDrivers.has(driverId)) {
      throw new Error(`AI draft duplicate driver at rank ${expectedRank}.`);
    }

    usedDrivers.add(driverId);
    const driver = driverLookup.get(driverId);
    const previousRank = previousRankByDriver[driverId];
    let movement = Number(raw?.movement);
    if (!Number.isFinite(movement)) movement = 0;

    if (previousRank) {
      movement = previousRank - expectedRank;
    } else if (previousRankings) {
      movement = movement || 0;
    }

    normalizedEntries.push({
      rank: expectedRank,
      driverId,
      driverName: driver.driverName,
      movement,
      subtitle: String(raw?.subtitle || '').trim(),
      writeup: String(raw?.writeup || '').trim(),
    });
  }

  const honorableMentions = (Array.isArray(aiDraft?.honorableMentions)
    ? aiDraft.honorableMentions
    : []
  )
    .slice(0, 3)
    .map((mention) => {
      const driverId = String(mention?.driverId || mention?.driver_id || '').trim();
      if (!driverId || !driverLookup.has(driverId) || usedDrivers.has(driverId)) {
        return null;
      }
      return {
        driverId,
        driverName: driverLookup.get(driverId).driverName,
        writeup: String(mention?.writeup || '').trim(),
      };
    })
    .filter(Boolean);

  for (const entry of normalizedEntries) {
    if (!entry.subtitle) {
      throw new Error(`AI draft rank ${entry.rank} is missing a subtitle.`);
    }
    if (!entry.writeup) {
      throw new Error(`AI draft rank ${entry.rank} is missing a writeup.`);
    }
  }

  return {
    entries: normalizedEntries,
    honorableMentions,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = parseBody(req);

    if (body.password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Bad password' });
    }

    const raceNumber = Number(body.raceNumber ?? body.race_number);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      return res.status(400).json({ error: 'Valid race number is required.' });
    }

    const settings = await getSettings();
    const [standings, scheduleHtml, previousRankings, profiles] = await Promise.all([
      fetchStandingsRows(settings),
      fetchHtml(settings.scheduleUrl),
      loadPreviousPowerRankings(raceNumber),
      getDriverProfiles(),
    ]);

    if (!standings.length) {
      return res.status(400).json({ error: 'No standings data available for AI generation.' });
    }

    const scheduleRaces = parseScheduleRaces(scheduleHtml);
    const contextPayload = buildContextPayload({
      raceNumber,
      standings,
      scheduleRaces,
      previousRankings,
      profiles,
    });

    const aiDraft = await callOpenAi(contextPayload);
    const driverLookup = buildDriverLookup(standings, profiles);
    const draft = normalizeDraft(aiDraft, driverLookup, previousRankings);

    return res.status(200).json({
      raceNumber,
      generatedAt: new Date().toISOString(),
      previousRaceNumber: previousRankings?.raceNumber || null,
      ...draft,
    });
  } catch (error) {
    console.error('[power-rankings-generate]', error);
    return res.status(500).json({ error: error.message || 'AI draft generation failed.' });
  }
}
