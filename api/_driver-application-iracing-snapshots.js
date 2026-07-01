import { supabase } from './_lib.js';

const SNAPSHOT_FIELDS =
  'id, created_at, application_id, job_id, customer_id, source, scrape_status, scrape_error, display_name, oval_license_class, oval_safety_rating, oval_irating, licenses_json';

export async function getLatestIracingSnapshotForApplication(applicationId) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const id = String(applicationId || '').trim();
  if (!id) return null;

  const { data, error } = await sb
    .from('driver_application_iracing_snapshots')
    .select(SNAPSHOT_FIELDS)
    .eq('application_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
