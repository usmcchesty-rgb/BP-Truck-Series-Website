import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_NAME = 'Recruit Scanner';
const PROCESS_DELAY_MS = 5000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const activeJobs = new Set();

async function processJob(job) {
  if (!job?.id || activeJobs.has(job.id)) {
    return;
  }

  activeJobs.add(job.id);

  console.log('-----------------------------------');
  console.log('New Lookup Job');
  console.log('Application:', job.application_id);
  console.log('Customer ID:', job.customer_id ?? '(none)');
  console.log('-----------------------------------');
  console.log('New job received');
  console.log('Job processing');

  const startedAt = new Date().toISOString();

  const { data: claimed, error: claimError } = await supabase
    .from('iracing_lookup_jobs')
    .update({
      status: 'processing',
      started_at: startedAt,
      worker_name: WORKER_NAME,
      updated_at: startedAt,
    })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle();

  if (claimError) {
    console.error('Failed to claim job:', claimError.message);
    activeJobs.delete(job.id);
    return;
  }

  if (!claimed) {
    console.log('Job already claimed by another worker.');
    activeJobs.delete(job.id);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, PROCESS_DELAY_MS));

  const completedAt = new Date().toISOString();

  const { error: completeError } = await supabase
    .from('iracing_lookup_jobs')
    .update({
      status: 'completed',
      completed_at: completedAt,
      updated_at: completedAt,
    })
    .eq('id', job.id)
    .eq('status', 'processing');

  if (completeError) {
    console.error('Failed to complete job:', completeError.message);
    activeJobs.delete(job.id);
    return;
  }

  console.log('Job complete');
  activeJobs.delete(job.id);
}

function startScanner() {
  console.log('Connected to Supabase');
  console.log('Listening for lookup jobs...');

  supabase
    .channel('recruit-scanner-lookup-jobs')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'iracing_lookup_jobs',
        filter: 'status=eq.queued',
      },
      (payload) => {
        processJob(payload.new).catch((err) => {
          console.error('Unexpected job processing error:', err);
        });
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        return;
      }

      if (status === 'CHANNEL_ERROR') {
        console.error('Realtime channel error:', err?.message || 'unknown error');
        return;
      }

      if (status === 'TIMED_OUT') {
        console.error('Realtime subscription timed out.');
      }
    });
}

startScanner();
