import { createClient } from '@supabase/supabase-js';
import { supabase } from './_lib.js';

// Supabase Auth URL Configuration (Dashboard → Authentication → URL Configuration):
// Site URL: https://www.blazingpedalsracing.com
// Redirect URLs: /fantasy/login.html, /fantasy/signup.html, /fantasy/dashboard.html, /fantasy/lineup.html
// Email templates: supabase/fantasy_auth_email_templates.md

export function getFantasyAuthConfig() {
  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    return { configured: false, url: null, anonKey: null };
  }
  return { configured: true, url, anonKey };
}

export async function getUserFromBearerToken(req) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const sb = supabase();
  if (!sb) return null;

  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function ensureFantasyProfile(user) {
  const sb = supabase();
  if (!sb || !user?.id) return null;

  const email = user.email || null;
  const displayName =
    String(user.user_metadata?.display_name || '').trim() ||
    (email ? email.split('@')[0] : 'Player');

  const { data, error } = await sb
    .from('fantasy_profiles')
    .upsert(
      {
        user_id: user.id,
        email,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .single();

  if (error) return { user_id: user.id, email, display_name: displayName };
  return data;
}

export function supabaseAsUser(accessToken) {
  const { url, anonKey } = getFantasyAuthConfig();
  if (!url || !anonKey || !accessToken) return null;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
