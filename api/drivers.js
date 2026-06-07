import { getDriverProfiles, supabase } from './_lib.js';

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

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(await getDriverProfiles());
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

  const row = {
    driver_id: String(b.driver_id),
    iracing_name: String(b.iracing_name),
    display_name: b.display_name != null ? String(b.display_name) : null,
    car_number: 'car_number' in b ? String(b.car_number) : '',
    photo_url: b.photo_url != null ? String(b.photo_url) : '',
    active: b.active !== undefined ? Boolean(b.active) : true,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await sb
    .from('driver_profiles')
    .upsert(row, { onConflict: 'driver_id' })
    .select('driver_id, iracing_name, display_name, car_number, photo_url, active, updated_at')
    .single();

  if (error) {
    return res.status(500).json({ error: `Supabase error: ${error.message}` });
  }

  return res.status(200).json(data);
}
