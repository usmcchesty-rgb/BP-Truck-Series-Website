import { getDriverProfiles, supabase, slugify, stripPhotoUrlQuery, withPhotoCacheBust, photoCacheVersion } from './_lib.js';

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

function normalizeDriverProfile(row) {
  if (!row) return null;
  const photo_url = stripPhotoUrlQuery(row.photo_url || '');
  return {
    driver_id: String(row.driver_id || row.iracing_id || row.slug || ''),
    iracing_name: row.iracing_name || row.driver_name || '',
    display_name: row.display_name || row.driver_name || '',
    car_number: row.car_number || row.truck_number || '',
    photo_url,
    photoUrl: photo_url
      ? withPhotoCacheBust(photo_url, photoCacheVersion(row.updated_at))
      : '',
    active: row.active !== false
  };
}

function buildUpsertRow(b) {
  const displayName = b.display_name || b.iracing_name;
  const carNumber = b.car_number || '';

  return {
    driver_id: String(b.driver_id),
    iracing_name: String(b.iracing_name),
    display_name: displayName,
    driver_name: displayName,
    slug: slugify(displayName || b.iracing_name || b.driver_id),
    car_number: carNumber,
    truck_number: carNumber,
    photo_url: stripPhotoUrlQuery(b.photo_url || ''),
    active: b.active !== false,
    updated_at: new Date().toISOString()
  };
}

function isConflictConstraintError(error) {
  const msg = error?.message || '';
  return /on conflict|no unique|exclusion constraint|constraint matching/i.test(msg);
}

async function upsertDriver(sb, row) {
  const byDriverId = await sb
    .from('driver_profiles')
    .upsert(row, { onConflict: 'driver_id' })
    .select()
    .single();

  if (!byDriverId.error) return byDriverId;

  if (!isConflictConstraintError(byDriverId.error)) {
    return byDriverId;
  }

  return sb
    .from('driver_profiles')
    .upsert(row, { onConflict: 'slug' })
    .select()
    .single();
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const rows = await getDriverProfiles();
    const normalized = rows
      .map(normalizeDriverProfile)
      .filter(Boolean)
      .sort((a, b) => a.iracing_name.localeCompare(b.iracing_name));
    return res.status(200).json(normalized);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const b = parseBody(req);

  if (b.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Bad password' });
  }

  const sb = supabase();
  if (!sb) {
    return res.status(400).json({ error: 'Supabase not configured yet.' });
  }

  if (!b.driver_id) {
    return res.status(400).json({ error: 'Missing driver_id' });
  }

  if (!b.iracing_name) {
    return res.status(400).json({ error: 'iracing_name is required.' });
  }

  const row = buildUpsertRow(b);
  const { data, error } = await upsertDriver(sb, row);

  if (error) {
    return res.status(500).json({ error: `Supabase error: ${error.message}` });
  }

  return res.status(200).json(normalizeDriverProfile(data));
}
