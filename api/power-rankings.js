import { slugify, supabase } from './_lib.js';
import {
  formatMovementDisplay,
  MOVEMENT_NEW_SENTINEL,
  movementTypeFromStored,
  parseMovementInput,
} from './_power-rankings-movement.js';

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

async function loadDriverProfiles() {
  const sb = supabase();
  if (!sb) return [];

  const { data: profiles, error } = await sb
    .from('driver_profiles')
    .select('*')
    .order('iracing_name');

  if (error) {
    console.error('driver_profiles query failed:', error);
    return [];
  }

  if (!Array.isArray(profiles)) {
    console.error('driver_profiles is not an array', profiles);
    return [];
  }

  return profiles;
}

function profileMap(profiles) {
  const rows = Array.isArray(profiles) ? profiles : [];
  return Object.fromEntries(
    rows.map((p) => [String(p.driver_id), p])
  );
}

function driverPhoto(profile, name) {
  if (profile?.photo_url) return profile.photo_url;
  const slug = slugify(profile?.display_name || profile?.iracing_name || name || '');
  return slug ? `/assets/drivers/${slug}.png` : '/assets/drivers/placeholder.png';
}

function enrichDriver(profile, driverId, fallbackName = '') {
  const name = profile?.display_name || profile?.iracing_name || fallbackName || 'Unknown Driver';
  return {
    driverId: String(driverId),
    driverName: name,
    carNumber: profile?.car_number || '',
    photoUrl: driverPhoto(profile, name),
  };
}

function formatMovement(movement, movementType = null) {
  return formatMovementDisplay(movement, movementType);
}

function normalizeEntry(row, profiles) {
  const profile = profiles[String(row.driver_id)] || null;
  const driver = enrichDriver(profile, row.driver_id);
  const movementType = movementTypeFromStored(row.movement);
  const movement = formatMovement(row.movement, movementType);
  const storedMovement = Number(row.movement);

  return {
    rank: row.rank,
    driverId: driver.driverId,
    driverName: driver.driverName,
    carNumber: driver.carNumber,
    photoUrl: driver.photoUrl,
    movement:
      storedMovement === MOVEMENT_NEW_SENTINEL
        ? null
        : Number.isFinite(storedMovement)
          ? storedMovement
          : 0,
    movementType,
    movementText: movement.text,
    movementClass: movement.class,
    subtitle: row.subtitle || '',
    writeup: row.writeup || '',
  };
}

function normalizeHonorable(row, profiles) {
  const profile = profiles[String(row.driver_id)] || null;
  const driver = enrichDriver(profile, row.driver_id);
  return {
    sortOrder: row.sort_order,
    driverId: driver.driverId,
    driverName: driver.driverName,
    carNumber: driver.carNumber,
    photoUrl: driver.photoUrl,
    writeup: row.writeup || '',
  };
}

function weekLabel(week) {
  return `Race ${week.race_number} Rankings`;
}

function parseEntryMovement(entry, rank) {
  const parsed = parseMovementInput(entry.movement ?? entry.movementInput);
  if (!parsed) {
    return {
      error: `Rank ${rank} movement must be a number, 0, NEW, or NR.`,
    };
  }
  return { parsed };
}

function normalizeWeek(week, entries, honorable, profiles) {
  const byId = profileMap(profiles);
  return {
    id: week.id,
    raceNumber: week.race_number,
    publishedDate: week.published_date || null,
    published: week.published === true,
    label: weekLabel(week),
    prophetTake: week.prophet_take || '',
    entries: (entries || [])
      .filter((e) => e.week_id === week.id)
      .sort((a, b) => a.rank - b.rank)
      .map((e) => normalizeEntry(e, byId)),
    honorableMentions: (honorable || [])
      .filter((h) => h.week_id === week.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((h) => normalizeHonorable(h, byId)),
  };
}

async function loadWeekBundle(weekId) {
  const sb = supabase();
  if (!sb) return null;

  const { data: week, error: weekErr } = await sb
    .from('power_rankings_weeks')
    .select('*')
    .eq('id', weekId)
    .maybeSingle();

  if (weekErr || !week) return null;

  const [{ data: entries }, { data: honorable }] = await Promise.all([
    sb.from('power_rankings_entries').select('*').eq('week_id', weekId).order('rank'),
    sb.from('power_rankings_honorable_mentions').select('*').eq('week_id', weekId).order('sort_order'),
  ]);

  const profiles = await loadDriverProfiles();
  return normalizeWeek(week, entries || [], honorable || [], profiles);
}

async function loadPublishedWeeks(includeUnpublished = false) {
  const sb = supabase();
  if (!sb) return { weeks: [], entries: [], honorable: [] };

  let query = sb.from('power_rankings_weeks').select('*').order('race_number', { ascending: false });
  if (!includeUnpublished) query = query.eq('published', true);

  const { data: weeks, error } = await query;
  if (error || !weeks?.length) return { weeks: [], entries: [], honorable: [] };

  const weekIds = weeks.map((w) => w.id);
  const [{ data: entries }, { data: honorable }] = await Promise.all([
    sb.from('power_rankings_entries').select('*').in('week_id', weekIds).order('rank'),
    sb.from('power_rankings_honorable_mentions').select('*').in('week_id', weekIds).order('sort_order'),
  ]);

  return { weeks, entries: entries || [], honorable: honorable || [] };
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || entries.length !== 10) {
    return 'Exactly 10 ranked drivers are required.';
  }

  const ranks = new Set();
  const drivers = new Set();

  for (const entry of entries) {
    const rank = Number(entry.rank);
    const driverId = String(entry.driverId || entry.driver_id || '').trim();
    if (!Number.isInteger(rank) || rank < 1 || rank > 10) {
      return `Invalid rank: ${entry.rank}`;
    }
    if (!driverId) return `Rank ${rank} is missing a driver.`;
    if (!String(entry.writeup || '').trim()) {
      return `Rank ${rank} writeup is required.`;
    }
    const movementError = parseEntryMovement(entry, rank);
    if (movementError?.error) return movementError.error;
    if (ranks.has(rank)) return `Duplicate rank: ${rank}`;
    if (drivers.has(driverId)) return `Duplicate driver at rank ${rank}.`;
    ranks.add(rank);
    drivers.add(driverId);
  }

  for (let i = 1; i <= 10; i += 1) {
    if (!ranks.has(i)) return `Missing rank ${i}.`;
  }

  return null;
}

function validateHonorableMentions(mentions) {
  if (!mentions || !mentions.length) return null;
  if (!Array.isArray(mentions)) return 'Honorable mentions must be an array.';
  if (mentions.length > 3) return 'Maximum 3 honorable mentions allowed.';

  const drivers = new Set();
  for (let i = 0; i < mentions.length; i += 1) {
    const mention = mentions[i];
    const driverId = String(mention.driverId || mention.driver_id || '').trim();
    if (!driverId) return `Honorable mention ${i + 1} is missing a driver.`;
    if (drivers.has(driverId)) return 'Duplicate driver in honorable mentions.';
    drivers.add(driverId);
  }

  return null;
}

async function saveWeekBundle(body, publish = false) {
  const sb = supabase();
  if (!sb) return { error: 'Supabase not configured yet.', status: 400 };

  const raceNumber = Number(body.raceNumber ?? body.race_number);
  if (!Number.isInteger(raceNumber) || raceNumber < 1) {
    return { error: 'Valid race number is required.', status: 400 };
  }

  const entryError = validateEntries(body.entries);
  if (entryError) return { error: entryError, status: 400 };

  const mentionError = validateHonorableMentions(body.honorableMentions || body.honorable_mentions);
  if (mentionError) return { error: mentionError, status: 400 };

  let weekId = body.id ? Number(body.id) : null;

  const weekRow = {
    race_number: raceNumber,
    published_date: body.publishedDate || body.published_date || null,
    prophet_take: String(body.prophetTake ?? body.prophet_take ?? ''),
    updated_at: new Date().toISOString(),
  };

  if (publish) {
    weekRow.published = true;
  } else if (!weekId) {
    weekRow.published = false;
  }

  if (weekId) {
    const { error } = await sb.from('power_rankings_weeks').update(weekRow).eq('id', weekId);
    if (error) return { error: `Supabase error: ${error.message}`, status: 500 };
  } else {
    const { data, error } = await sb
      .from('power_rankings_weeks')
      .insert(weekRow)
      .select()
      .single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return { error: `Race ${raceNumber} rankings already exist. Edit that week instead.`, status: 400 };
      }
      return { error: `Supabase error: ${error.message}`, status: 500 };
    }
    weekId = data.id;
  }

  await sb.from('power_rankings_entries').delete().eq('week_id', weekId);
  await sb.from('power_rankings_honorable_mentions').delete().eq('week_id', weekId);

  const entryRows = body.entries.map((entry) => {
    const { parsed } = parseEntryMovement(entry, Number(entry.rank));
    return {
      week_id: weekId,
      rank: Number(entry.rank),
      driver_id: String(entry.driverId || entry.driver_id),
      movement: parsed.movement,
      subtitle: String(entry.subtitle || ''),
      writeup: String(entry.writeup || ''),
    };
  });

  const { error: entriesError } = await sb.from('power_rankings_entries').insert(entryRows);
  if (entriesError) return { error: `Supabase error: ${entriesError.message}`, status: 500 };

  const mentions = body.honorableMentions || body.honorable_mentions || [];
  if (mentions.length) {
    const mentionRows = mentions.map((mention, index) => ({
      week_id: weekId,
      sort_order: index + 1,
      driver_id: String(mention.driverId || mention.driver_id),
      writeup: String(mention.writeup || ''),
    }));
    const { error: mentionInsertError } = await sb
      .from('power_rankings_honorable_mentions')
      .insert(mentionRows);
    if (mentionInsertError) {
      return { error: `Supabase error: ${mentionInsertError.message}`, status: 500 };
    }
  }

  const saved = await loadWeekBundle(weekId);
  return { data: saved, status: 200 };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const sb = supabase();
    if (!sb) {
      return res.status(200).json({
        configured: false,
        current: null,
        archive: [],
      });
    }

    const weekId = req.query?.weekId ? Number(req.query.weekId) : null;
    const includeUnpublished = req.query?.admin === '1';
    const profiles = await loadDriverProfiles();

    if (weekId) {
      const week = await loadWeekBundle(weekId);
      if (!week) return res.status(404).json({ error: 'Rankings not found.' });
      if (!week.published && !includeUnpublished) {
        return res.status(404).json({ error: 'Rankings not found.' });
      }

      const { weeks } = await loadPublishedWeeks(false);
      const archive = weeks.map((w) => ({
        id: w.id,
        raceNumber: w.race_number,
        publishedDate: w.published_date || null,
        label: weekLabel(w),
      }));

      return res.status(200).json({ configured: true, current: week, archive });
    }

    const { weeks, entries, honorable } = await loadPublishedWeeks(includeUnpublished);
    if (!weeks.length) {
      return res.status(200).json({ configured: true, current: null, archive: [] });
    }

    const normalizedWeeks = weeks.map((week) => normalizeWeek(week, entries, honorable, profiles));
    const publishedWeeks = normalizedWeeks.filter((w) => w.published);
    const current = publishedWeeks[0] || null;
    const archive = publishedWeeks.map((w) => ({
      id: w.id,
      raceNumber: w.raceNumber,
      publishedDate: w.publishedDate,
      label: w.label,
    }));

    return res.status(200).json({
      configured: true,
      current,
      archive,
      weeks: includeUnpublished ? normalizedWeeks : undefined,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req);
  if (body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Bad password' });
  }

  const action = body.action || 'save';

  if (action === 'delete') {
    const sb = supabase();
    if (!sb) return res.status(400).json({ error: 'Supabase not configured yet.' });
    const weekId = Number(body.id);
    if (!weekId) return res.status(400).json({ error: 'Missing week id.' });
    const { error } = await sb.from('power_rankings_weeks').delete().eq('id', weekId);
    if (error) return res.status(500).json({ error: `Supabase error: ${error.message}` });
    return res.status(200).json({ ok: true });
  }

  const publish = action === 'publish';
  const result = await saveWeekBundle(body, publish);
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.status(result.status).json(result.data);
}
