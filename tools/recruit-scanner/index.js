import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { checkProfileAccess, closeBrowser, initBrowser } from './iracing-browser.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_NAME = 'Recruit Scanner';
const JOB_DELAY_MS = Number(process.env.JOB_DELAY_MS || 3_000);
const SUCCESS_MESSAGE = 'Profile page loaded successfully. Scraping not implemented yet.';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const queuedJobIds = new Set();
const jobQueue = [];
let drainingQueue = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueJob(job) {
  if (!job?.id || queuedJobIds.has(job.id)) {
    return;
  }

  queuedJobIds.add(job.id);
  jobQueue.push(job);
  void drainQueue();
}

async function updateJob(jobId, fields) {
  const { error } = await supabase
    .from('iracing_lookup_jobs')
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    throw new Error(error.message);
  }
}

async function processJob(job) {
  console.log('-----------------------------------');
  console.log('New Lookup Job');
  console.log('Application:', job.application_id);
  console.log('Customer ID:', job.customer_id ?? '(none)');
  console.log('-----------------------------------');
  console.log('New job received');
  console.log('Job processing');

  const startedAt = new Date().toISOString();
  const attempts = Number(job.attempts ?? 0) + 1;

  const { data: claimed, error: claimError } = await supabase
    .from('iracing_lookup_jobs')
    .update({
      status: 'processing',
      started_at: startedAt,
      worker_name: WORKER_NAME,
      attempts,
      error: null,
      updated_at: startedAt,
    })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle();

  if (claimError) {
    console.error('Failed to claim job:', claimError.message);
    return;
  }

  if (!claimed) {
    console.log('Job already claimed by another worker.');
    return;
  }

  const customerId = String(job.customer_id ?? '').trim();
  if (!customerId) {
    try {
      await updateJob(job.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: 'Missing customer_id on lookup job.',
      });
      console.error('Job failed: missing customer_id.');
    } catch (err) {
      console.error('Failed to mark job failed:', err.message);
    }
    return;
  }

  let result;

  try {
    result = await checkProfileAccess(customerId);
  } catch (err) {
    result = {
      outcome: 'failed',
      message: err instanceof Error ? err.message : 'Unexpected browser error.',
    };
  }

  const finishedAt = new Date().toISOString();

  try {
    if (result.outcome === 'needs_login') {
      await updateJob(job.id, {
        status: 'needs_login',
        error: result.message,
        completed_at: null,
      });
      console.log('Please log into iRacing in the opened browser, then rerun scanner.');
      console.log('Job paused: needs_login');
      return;
    }

    if (result.outcome === 'completed') {
      await updateJob(job.id, {
        status: 'completed',
        completed_at: finishedAt,
        error: SUCCESS_MESSAGE,
      });
      console.log('Job complete');
      return;
    }

    await updateJob(job.id, {
      status: 'failed',
      completed_at: finishedAt,
      error: result.message,
    });
    console.error('Job failed:', result.message);
  } catch (err) {
    console.error('Failed to update job status:', err.message);
  }
}

async function drainQueue() {
  if (drainingQueue) {
    return;
  }

  drainingQueue = true;

  while (jobQueue.length > 0) {
    const job = jobQueue.shift();
    queuedJobIds.delete(job.id);

    try {
      await processJob(job);
    } catch (err) {
      console.error('Unexpected job processing error:', err);
    }

    if (jobQueue.length > 0) {
      await sleep(JOB_DELAY_MS);
    }
  }

  drainingQueue = false;
}

async function loadQueuedBacklog() {
  const { data: jobs, error } = await supabase
    .from('iracing_lookup_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load queued backlog:', error.message);
    return;
  }

  for (const job of jobs ?? []) {
    enqueueJob(job);
  }
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
        enqueueJob(payload.new);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'iracing_lookup_jobs',
        filter: 'status=eq.queued',
      },
      (payload) => {
        enqueueJob(payload.new);
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

async function main() {
  await initBrowser();
  startScanner();
  await loadQueuedBacklog();
}

async function shutdown() {
  await closeBrowser();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});

process.on('SIGTERM', () => {
  void shutdown();
});

main().catch(async (err) => {
  console.error('Scanner failed to start:', err);
  await closeBrowser();
  process.exit(1);
});
