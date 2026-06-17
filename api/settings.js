import { DEFAULTS, getSettings, stripPhotoUrlQuery, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json(await getSettings());
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};
  if (body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Bad password' });
  // Password check only (admin login) — no write.
  if (body.verifyOnly) return res.status(200).json({ ok: true });
  const sb = supabase();
  if (!sb) return res.status(400).json({ error: 'Supabase not configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.' });
  const patch = { id: 1 };
  for (const k of Object.keys(DEFAULTS)) if (body[k] !== undefined) patch[k] = body[k];
  if (body.headerLogoUrl !== undefined) {
    patch.headerLogoUrl = stripPhotoUrlQuery(String(body.headerLogoUrl || '').trim());
    patch.headerLogoUpdatedAt = new Date().toISOString();
  }
  if (body.headerLogoAltText !== undefined) {
    patch.headerLogoAltText = String(body.headerLogoAltText || '').trim();
  }
  if (body.milesApexImageUrl !== undefined) {
    patch.milesApexImageUrl = stripPhotoUrlQuery(String(body.milesApexImageUrl || '').trim());
    patch.milesApexImageUpdatedAt = new Date().toISOString();
  }
  if (body.milesApexImageZoom !== undefined) {
    const zoom = Number(body.milesApexImageZoom);
    patch.milesApexImageZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }
  if (body.milesApexImageX !== undefined) {
    const x = Number(body.milesApexImageX);
    patch.milesApexImageX = Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50;
  }
  if (body.milesApexImageY !== undefined) {
    const y = Number(body.milesApexImageY);
    patch.milesApexImageY = Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50;
  }
  if (body.powerRankingsFormulaImageUrl !== undefined) {
    const nextUrl = stripPhotoUrlQuery(String(body.powerRankingsFormulaImageUrl || '').trim());
    patch.powerRankingsFormulaImageUrl = nextUrl;
    patch.powerRankingsFormulaImageUpdatedAt = nextUrl ? new Date().toISOString() : null;
  }
  const { data, error } = await sb.from('site_settings').upsert(patch).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}
