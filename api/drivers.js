import { getDriverProfiles, supabase, slugify } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json(await getDriverProfiles());
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (b.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Bad password' });
  const sb = supabase();
  if (!sb) return res.status(400).json({ error: 'Supabase not configured yet.' });
  const row = { driver_name: b.driver_name, slug: b.slug || slugify(b.driver_name), iracing_id: b.iracing_id || '', truck_number: b.truck_number || '', photo_url: b.photo_url || '', manufacturer: b.manufacturer || '', team: b.team || '' };
  const { data, error } = await sb.from('driver_profiles').upsert(row, { onConflict: 'slug' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}
