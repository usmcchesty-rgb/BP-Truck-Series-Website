import { supabase } from './_lib.js';

const STATS_SNAPSHOT_FIELDS =
  'id, created_at, application_id, job_id, customer_id, source, scrape_status, scrape_error, category, starts, wins, top5, poles, avg_start, avg_finish, total_laps, laps_led, incidents_per_race, points_per_race, win_percentage, top5_percentage, stats_json, yearly_stats_json, yearly_parse_status, yearly_parse_error';

export async function getLatestIracingStatsSnapshotForApplication(applicationId) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured yet.');

  const id = String(applicationId || '').trim();
  if (!id) return null;

  const { data, error } = await sb
    .from('driver_application_iracing_stats_snapshots')
    .select(STATS_SNAPSHOT_FIELDS)
    .eq('application_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
