import { DEFAULTS, getSettings, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json(await getSettings());
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  if (body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Bad password' });
  const sb = supabase();
  if (!sb) return res.status(400).json({ error: 'Supabase not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.' });
  const patch = { id: 1 };
  for (const k of Object.keys(DEFAULTS)) if (body[k] !== undefined) patch[k] = body[k];
  const { data, error } = await sb.from('site_settings').upsert(patch).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}
