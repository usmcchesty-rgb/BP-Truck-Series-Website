import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { loadScannerEnv, SCANNER_ENV_PATH } from './env-file.js';
import {
  clearBrowserProfile,
  closeBrowser,
  initBrowser,
  openIracingLoginPage,
  prepareScannerSession,
  scrapeCustomerProfile,
  scrapeProfileLicenses,
  scrapeProfileStats,
  watchForLoginAndRetry,
} from './iracing-browser.js';
import { logError, logMessage, resetLogger, setLogger } from './logger.js';
import { logMissingRequiredFields, logSelectorReport } from './dom-profile-extractor.js';
import { logStatsSelectorReport } from './dom-stats-extractor.js';
import {
  parseLicenseSnapshot,
  parseProfileDomSnapshot,
  sanitizeRawTextExcerpt,
} from './parse-license-snapshot.js';
import {
  logStatsParseResult,
  parseStatsDomSnapshot,
  parseStatsTextSnapshot,
} from './parse-stats-snapshot.js';

const WORKER_NAME = 'Recruit Scanner';
const JOB_DELAY_MS = Number(process.env.JOB_DELAY_MS || 3_000);
const STALE_PROCESSING_JOB_MS = Number(process.env.STALE_PROCESSING_JOB_MS || 10 * 60 * 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isJobStale(job, now = Date.now()) {
  const timestamp = job?.started_at || job?.updated_at;
  if (!timestamp) return false;
  const startedAt = new Date(timestamp).getTime();
  return Number.isFinite(startedAt) && now - startedAt > STALE_PROCESSING_JOB_MS;
}

function applyEnvToProcess(envValues) {
  if (envValues.SUPABASE_URL) process.env.SUPABASE_URL = envValues.SUPABASE_URL;
  if (envValues.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = envValues.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (envValues.CHROME_EXECUTABLE_PATH) {
    process.env.CHROME_EXECUTABLE_PATH = envValues.CHROME_EXECUTABLE_PATH;
  }
}

function buildProfileRawText(domExtraction, licenseText) {
  const profileJson = domExtraction?.data
    ? JSON.stringify(domExtraction.data, null, 2)
    : null;

  if (profileJson) {
    return `=== PROFILE DOM JSON ===\n${profileJson}\n\n=== PAGE TEXT ===\n${licenseText || domExtraction?.rawText || ''}`;
  }

  return licenseText || domExtraction?.rawText || '';
}

function buildStatsRawText(domExtraction, statsText) {
  const statsJson = domExtraction?.data
    ? JSON.stringify(domExtraction.data, null, 2)
    : null;

  if (statsJson) {
    return `=== STATS DOM JSON ===\n${statsJson}\n\n=== PAGE TEXT ===\n${statsText || domExtraction?.rawText || ''}`;
  }

  return statsText || domExtraction?.rawText || '';
}

export class RecruitScannerService {
  constructor(options = {}) {
    this.onLog = options.onLog;
    this.onError = options.onError;
    this.workerName = options.workerName || WORKER_NAME;
    this.supabase = null;
    this.realtimeChannel = null;
    this.running = false;
    this.queuedJobIds = new Set();
    this.jobQueue = [];
    this.loginWatchers = new Set();
    this.drainingQueue = false;

    if (this.onLog || this.onError) {
      setLogger({
        log: (message) => this.log(message),
        error: (message) => this.error(message),
      });
    }
  }

  log(message) {
    if (this.onLog) {
      this.onLog(String(message));
    } else {
      logMessage(message);
    }
  }

  error(message) {
    if (this.onError) {
      this.onError(String(message));
    } else {
      logError(message);
    }
  }

  loadEnvironment() {
    dotenv.config({ path: SCANNER_ENV_PATH, override: true });
    const envValues = loadScannerEnv();
    applyEnvToProcess(envValues);
    return envValues;
  }

  ensureSupabaseConfigured() {
    const envValues = this.loadEnvironment();
    if (!envValues.SUPABASE_URL || !envValues.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in tools/recruit-scanner/.env');
    }

    this.supabase = createClient(envValues.SUPABASE_URL, envValues.SUPABASE_SERVICE_ROLE_KEY);
    return envValues;
  }

  getSupabaseProjectUrl() {
    const envValues = this.loadEnvironment();
    return envValues.SUPABASE_URL || '';
  }

  async updateJob(jobId, fields) {
    const { error } = await this.supabase
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

  async saveSnapshot({ job, customerId, rawText, parsed, jobId = null, applicationId = null }) {
    const row = {
      application_id: applicationId || job?.application_id,
      job_id: jobId || job?.id || null,
      customer_id: customerId,
      source: 'iracing_ui_profile',
      scrape_status: parsed.scrape_status,
      scrape_error: parsed.scrape_error,
      display_name: parsed.display_name,
      oval_license_class: parsed.oval_license_class,
      oval_safety_rating: parsed.oval_safety_rating,
      oval_irating: parsed.oval_irating,
      licenses_json: parsed.licenses_json || null,
      raw_text: rawText,
    };

    if (!row.application_id) {
      throw new Error('Cannot save snapshot without application_id.');
    }

    const { data, error } = await this.supabase
      .from('driver_application_iracing_snapshots')
      .insert(row)
      .select('id, scrape_status')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async saveStatsSnapshot({ job, customerId, rawText, parsed, jobId = null, applicationId = null }) {
    const row = {
      application_id: applicationId || job?.application_id,
      job_id: jobId || job?.id || null,
      customer_id: customerId,
      source: 'iracing_ui_profile_stats',
      scrape_status: parsed.scrape_status,
      scrape_error: parsed.scrape_error,
      category: parsed.category,
      starts: parsed.starts,
      wins: parsed.wins,
      top5: parsed.top5,
      poles: parsed.poles,
      avg_start: parsed.avg_start,
      avg_finish: parsed.avg_finish,
      total_laps: parsed.total_laps,
      laps_led: parsed.laps_led,
      incidents_per_race: parsed.incidents_per_race,
      points_per_race: parsed.points_per_race,
      win_percentage: parsed.win_percentage,
      top5_percentage: parsed.top5_percentage,
      raw_text: rawText,
      raw_json: parsed.raw_json || parsed.statsJson || null,
      stats_json: parsed.stats_json || parsed.statsJson || null,
      yearly_stats_json: parsed.yearly_stats_json || [],
      yearly_parse_status: parsed.yearly_parse_status || null,
      yearly_parse_error: parsed.yearly_parse_error || null,
    };

    if (!row.application_id) {
      throw new Error('Cannot save stats snapshot without application_id.');
    }

    const { data, error } = await this.supabase
      .from('driver_application_iracing_stats_snapshots')
      .insert(row)
      .select('id, scrape_status')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  logParsedValues(parsed) {
    this.log('Parsed values:');
    this.log(`  Display Name: ${parsed.display_name ?? '(missing)'}`);
    this.log(`  Oval License Class: ${parsed.oval_license_class ?? '(missing)'}`);
    this.log(`  Oval Safety Rating: ${parsed.oval_safety_rating ?? '(missing)'}`);
    this.log(`  Oval iRating: ${parsed.oval_irating ?? '(missing)'}`);

    const licenseCategories = parsed.licenses_json?.categories || [];
    if (licenseCategories.length) {
      this.log(`  License categories (${licenseCategories.length}): ${licenseCategories.map((c) => c.category).join(', ')}`);
    }

    if (parsed.profileJson) {
      this.log(`  Country: ${parsed.profileJson.country ?? '(missing)'}`);
      this.log(`  Member Since: ${parsed.profileJson.memberSince ?? '(missing)'}`);
    }
  }

  finalizeParsedResult(parsed) {
    logMissingRequiredFields((message) => this.log(message), parsed.missingFields);
    return parsed;
  }

  parseLicenseResult(licenseResult) {
    let parsed;

    if (licenseResult?.domExtraction) {
      parsed = parseProfileDomSnapshot(licenseResult.domExtraction);
      logSelectorReport((message) => this.log(message), {
        discovered: parsed.discoveredSelectors,
        failures: parsed.selectorFailures,
        fallbackUsed: parsed.textFallbacksUsed,
        selectorCatalog: parsed.selectorCatalog,
      });
    } else {
      this.log('DOM extraction unavailable — falling back to full text parsing.');
      parsed = parseLicenseSnapshot(licenseResult?.rawText || '');
    }

    return this.finalizeParsedResult(parsed);
  }

  parseStatsResult(statsResult) {
    let parsed;

    if (statsResult?.domExtraction) {
      parsed = parseStatsDomSnapshot(statsResult.domExtraction);
      logStatsSelectorReport((message) => this.log(message), statsResult.domExtraction);
    } else {
      this.log('Stats DOM extraction unavailable — falling back to text parsing.');
      parsed = parseStatsTextSnapshot(statsResult?.rawText || '');
    }

    logStatsParseResult((message) => this.log(message), parsed);
    return parsed;
  }

  logStatsParsedValues(parsed) {
    logStatsParseResult((message) => this.log(message), parsed);
    this.log('Parsed stats values (Oval primary):');
    this.log(`  Category: ${parsed.category ?? '(missing)'}`);
    this.log(`  Starts: ${parsed.starts ?? '(missing)'}`);
    this.log(`  Wins: ${parsed.wins ?? '(missing)'}`);
    this.log(`  Top 5: ${parsed.top5 ?? '(missing)'}`);
    this.log(`  Poles: ${parsed.poles ?? '(missing)'}`);
    this.log(`  Avg Start: ${parsed.avg_start ?? '(missing)'}`);
    this.log(`  Avg Finish: ${parsed.avg_finish ?? '(missing)'}`);
    this.log(`  Total Laps: ${parsed.total_laps ?? '(missing)'}`);
    this.log(`  Laps Led: ${parsed.laps_led ?? '(missing)'}`);
    this.log(`  Inc/Race: ${parsed.incidents_per_race ?? '(missing)'}`);
    this.log(`  Pts/Race: ${parsed.points_per_race ?? '(missing)'}`);
    this.log(`  Win %: ${parsed.win_percentage ?? '(missing)'}`);
    this.log(`  Top 5 %: ${parsed.top5_percentage ?? '(missing)'}`);
  }

  async scrapeAndSaveStats({ job, customerId, applicationId, statsResult = null }) {
    let result = statsResult;

    if (!result) {
      try {
        result = await scrapeProfileStats(customerId);
      } catch (err) {
        result = {
          outcome: 'failed',
          message: err instanceof Error ? err.message : 'Unexpected error scraping stats page.',
        };
      }
    }

    if (result.outcome === 'needs_login') {
      this.log('Stats tab needs login — license snapshot already saved.');
      return { saved: false, reason: 'needs_login', parsed: null };
    }

    if (result.outcome === 'wrong_page') {
      this.log(`Stats tab wrong page: ${result.message}`);
      return { saved: false, reason: 'wrong_page', parsed: null };
    }

    if (result.outcome !== 'scraped') {
      this.log(`Stats tab not saved: ${result.message || result.outcome}`);
      return { saved: false, reason: result.outcome, parsed: null };
    }

    const parsed = this.parseStatsResult(result);
    this.logStatsParsedValues(parsed);

    if (parsed.scrape_status === 'needs_manual_review') {
      this.log('Stats parse incomplete — saving snapshot for manual review.');
      this.log(`Stats excerpt: ${sanitizeRawTextExcerpt(result.rawText, 600)}`);
    }

    const snapshot = await this.saveStatsSnapshot({
      job,
      customerId,
      applicationId,
      rawText: buildStatsRawText(result.domExtraction, result.rawText),
      parsed,
    });
    this.log(`Stats snapshot saved: ${snapshot.id}`);
    return { saved: true, snapshot, parsed };
  }

  buildParsedFromLicenseResult(licenseResult, statsResult = null) {
    if (licenseResult.outcome === 'wrong_page') {
      return {
        scrape_status: 'needs_manual_review',
        scrape_error: `${licenseResult.message} Final URL: ${licenseResult.finalUrl || 'unknown'}`,
        display_name: null,
        oval_license_class: null,
        oval_safety_rating: null,
        oval_irating: null,
        missingFields: ['wrong_page'],
      };
    }

    const parsed = this.parseLicenseResult(licenseResult);
    const statsParsed =
      statsResult?.outcome === 'scraped' ? this.parseStatsResult(statsResult) : null;

    if (statsResult?.outcome === 'scraped') {
      this.log('Stats page captured.');
    } else if (statsResult?.outcome === 'wrong_page') {
      this.log(`Stats page wrong: ${statsResult.message}`);
    }

    parsed.statsParsed = statsParsed;
    return parsed;
  }

  async findApplicationByCustomerId(customerId) {
    const { data, error } = await this.supabase
      .from('driver_applications')
      .select('id, iracing_customer_id, iracing_display_name')
      .eq('iracing_customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  async enqueueIracingLookupJob(applicationId, customerId, reason = 'manual_refresh') {
    const normalizedApplicationId = String(applicationId || '').trim();
    const normalizedCustomerId = String(customerId ?? '').trim().replace(/\D/g, '');
    if (!normalizedApplicationId) {
      throw new Error('Application id is required.');
    }
    if (!normalizedCustomerId) {
      throw new Error('Customer ID is required.');
    }

    const { data: activeJob, error: activeError } = await this.supabase
      .from('iracing_lookup_jobs')
      .select('id, status, created_at, updated_at')
      .eq('application_id', normalizedApplicationId)
      .in('status', ['queued', 'processing', 'needs_login'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeError) {
      throw new Error(activeError.message);
    }

    if (activeJob) {
      return {
        ok: false,
        status: 'active_exists',
        message: 'Lookup already queued or processing.',
        job: activeJob,
      };
    }

    const { data: job, error } = await this.supabase
      .from('iracing_lookup_jobs')
      .insert({
        application_id: normalizedApplicationId,
        customer_id: normalizedCustomerId,
        status: 'queued',
        reason,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return {
          ok: false,
          status: 'active_exists',
          message: 'Lookup already queued or processing.',
        };
      }
      throw new Error(error.message);
    }

    this.log(`Refresh lookup queued: job ${job.id} for application ${normalizedApplicationId}.`);
    if (this.running) {
      this.enqueueJob(job);
    } else {
      this.log('Scanner is stopped; start the scanner or process queued jobs to run this refresh.');
    }
    return { ok: true, job };
  }

  async refreshApplicationByCustomerId(customerId, reason = 'manual_refresh') {
    const normalizedId = String(customerId ?? '').trim().replace(/\D/g, '');
    if (!normalizedId) {
      throw new Error('Customer ID is required.');
    }

    this.ensureSupabaseConfigured();
    const application = await this.findApplicationByCustomerId(normalizedId);
    if (!application?.id) {
      const message = 'No matching driver application found - preview only, no refresh job queued.';
      this.log(message);
      return { ok: false, status: 'not_found', message };
    }

    return this.enqueueIracingLookupJob(application.id, normalizedId, reason);
  }

  enqueueJob(job) {
    if (!job?.id || this.queuedJobIds.has(job.id)) {
      return;
    }

    this.queuedJobIds.add(job.id);
    this.jobQueue.push(job);
    void this.drainQueue();
  }

  async requeueJob(job) {
    await this.updateJob(job.id, {
      status: 'queued',
      error: null,
      started_at: null,
      completed_at: null,
      worker_name: null,
    });

    this.enqueueJob({
      ...job,
      status: 'queued',
      error: null,
      started_at: null,
      completed_at: null,
      worker_name: null,
    });
  }

  async resetStaleProcessingJob(job, reason = 'stale processing job') {
    const cutoffMinutes = Math.round(STALE_PROCESSING_JOB_MS / 60_000);
    this.log(`Recovering stale lookup job ${job.id}: ${reason}; older than ${cutoffMinutes} minutes.`);

    const { data: resetJob, error } = await this.supabase
      .from('iracing_lookup_jobs')
      .update({
        status: 'queued',
        error: `Reset stale processing job after ${cutoffMinutes} minutes.`,
        started_at: null,
        completed_at: null,
        worker_name: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'processing')
      .select('*')
      .maybeSingle();

    if (error) {
      this.error(`Failed to recover stale lookup job ${job.id}: ${error.message}`);
      return null;
    }

    if (!resetJob) {
      this.log(`Stale lookup job ${job.id} was already claimed or updated by another worker.`);
      return null;
    }

    this.log(`Stale lookup job ${job.id} reset to queued.`);
    this.enqueueJob(resetJob);
    return resetJob;
  }

  async recoverStaleProcessingJobs() {
    const { data: jobs, error } = await this.supabase
      .from('iracing_lookup_jobs')
      .select('*')
      .eq('status', 'processing')
      .order('updated_at', { ascending: true });

    if (error) {
      this.error(`Failed to scan for stale processing jobs: ${error.message}`);
      return 0;
    }

    const now = Date.now();
    const staleJobs = (jobs || []).filter((job) => isJobStale(job, now));
    for (const job of staleJobs) {
      await this.resetStaleProcessingJob(job, 'startup/backlog stale scan');
    }

    if (staleJobs.length) {
      this.log(`Recovered ${staleJobs.length} stale processing lookup job(s).`);
    }

    return staleJobs.length;
  }

  startLoginWatcher(job) {
    if (this.loginWatchers.has(job.id)) {
      return;
    }

    this.loginWatchers.add(job.id);

    void watchForLoginAndRetry(async () => {
      this.loginWatchers.delete(job.id);
      try {
        await this.requeueJob(job);
      } catch (err) {
        this.error(`Failed to requeue job after login: ${err.message}`);
      }
    }).catch((err) => {
      this.loginWatchers.delete(job.id);
      this.error(`Login watcher error: ${err.message}`);
    });
  }

  async processJob(job) {
    this.log('-----------------------------------');
    this.log('New Lookup Job');
    this.log(`Application: ${job.application_id}`);
    this.log(`Customer ID: ${job.customer_id ?? '(none)'}`);
    this.log('-----------------------------------');
    this.log('New job received');
    this.log('Job processing');

    const startedAt = new Date().toISOString();
    const attempts = Number(job.attempts ?? 0) + 1;

    const { data: claimed, error: claimError } = await this.supabase
      .from('iracing_lookup_jobs')
      .update({
        status: 'processing',
        started_at: startedAt,
        worker_name: this.workerName,
        attempts,
        error: null,
        updated_at: startedAt,
      })
      .eq('id', job.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();

    if (claimError) {
      this.error(`Failed to claim job: ${claimError.message}`);
      return;
    }

    if (!claimed) {
      const { data: currentJob, error: currentError } = await this.supabase
        .from('iracing_lookup_jobs')
        .select('*')
        .eq('id', job.id)
        .maybeSingle();

      if (currentError) {
        this.error(`Job claim skipped and current status could not be loaded: ${currentError.message}`);
        return;
      }

      if (currentJob?.status === 'processing' && isJobStale(currentJob)) {
        await this.resetStaleProcessingJob(currentJob, 'claim found stale processing status');
        return;
      }

      this.log(`Job skipped cleanly: already ${currentJob?.status || 'claimed'} by another worker.`);
      return;
    }

    const customerId = String(job.customer_id ?? '').trim();
    if (!customerId) {
      await this.updateJob(job.id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: 'Missing customer_id on lookup job.',
      });
      this.error('Job failed: missing customer_id.');
      return;
    }

    let licenseResult;
    try {
      licenseResult = await scrapeProfileLicenses(customerId);
    } catch (err) {
      licenseResult = {
        outcome: 'failed',
        message: err instanceof Error ? err.message : 'Unexpected browser error.',
      };
    }

    const finishedAt = new Date().toISOString();

    try {
      if (licenseResult.outcome === 'needs_login') {
        await this.updateJob(job.id, {
          status: 'needs_login',
          error: licenseResult.message,
          completed_at: null,
        });
        this.log('Needs login — complete sign-in in the scanner browser.');
        this.log('Job paused: needs_login');
        this.startLoginWatcher(job);
        return;
      }

      if (licenseResult.outcome === 'failed') {
        await this.updateJob(job.id, {
          status: 'failed',
          completed_at: finishedAt,
          error: licenseResult.message,
        });
        this.error(`Job failed: ${licenseResult.message}`);
        return;
      }

      if (licenseResult.outcome === 'wrong_page') {
        const parsed = this.buildParsedFromLicenseResult(licenseResult);
        const snapshot = await this.saveSnapshot({
          job,
          customerId,
          rawText: licenseResult.rawText || `Wrong page: ${licenseResult.finalUrl || ''}`,
          parsed,
        });
        this.log(`Snapshot saved: ${snapshot.id}`);
        await this.updateJob(job.id, {
          status: 'completed',
          completed_at: finishedAt,
          error: `License snapshot saved for manual review: ${parsed.scrape_error}`,
        });
        this.log('Job complete');
        return;
      }

      const parsed = this.parseLicenseResult(licenseResult);
      this.logParsedValues(parsed);

      if (parsed.scrape_status === 'needs_manual_review') {
        this.log('Parse incomplete — saving snapshot for manual review.');
        this.log(`Raw text excerpt: ${sanitizeRawTextExcerpt(licenseResult.rawText)}`);
      }

      const snapshot = await this.saveSnapshot({
        job,
        customerId,
        rawText: buildProfileRawText(licenseResult.domExtraction, licenseResult.rawText),
        parsed,
      });
      this.log(`Snapshot saved: ${snapshot.id}`);

      const jobNote =
        parsed.scrape_status === 'completed'
          ? 'License snapshot saved.'
          : `License snapshot saved for manual review: ${parsed.scrape_error}`;

      let statsNote = '';
      try {
        const statsSave = await this.scrapeAndSaveStats({
          job,
          customerId,
          applicationId: job.application_id,
        });
        if (statsSave.saved) {
          statsNote = ` Stats snapshot saved: ${statsSave.snapshot.id}.`;
        } else if (statsSave.reason) {
          statsNote = ` Stats snapshot not saved: ${statsSave.reason}.`;
        }
      } catch (statsErr) {
        statsNote = ` Stats snapshot failed: ${statsErr.message}.`;
        this.error(`Stats snapshot failed (license snapshot preserved): ${statsErr.message}`);
      }

      await this.updateJob(job.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        error: `${jobNote}${statsNote}`,
      });
      this.log('Job complete');
    } catch (err) {
      try {
        await this.updateJob(job.id, {
          status: 'failed',
          completed_at: finishedAt,
          error: err instanceof Error ? err.message : 'Failed to save license snapshot.',
        });
      } catch (updateErr) {
        this.error(`Failed to mark job failed after save error: ${updateErr.message}`);
      }
      this.error(`Job failed: ${err.message}`);
    }
  }

  async drainQueue() {
    if (this.drainingQueue) {
      return;
    }

    this.drainingQueue = true;

    while (this.jobQueue.length > 0) {
      const job = this.jobQueue.shift();
      this.queuedJobIds.delete(job.id);

      try {
        await this.processJob(job);
      } catch (err) {
        this.error(`Unexpected job processing error: ${err.message}`);
      }

      if (this.jobQueue.length > 0) {
        await sleep(JOB_DELAY_MS);
      }
    }

    this.drainingQueue = false;
  }

  async loadQueuedBacklog() {
    await this.recoverStaleProcessingJobs();

    const { data: jobs, error } = await this.supabase
      .from('iracing_lookup_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true });

    if (error) {
      this.error(`Failed to load queued backlog: ${error.message}`);
      return 0;
    }

    for (const job of jobs ?? []) {
      this.enqueueJob(job);
    }

    return jobs?.length ?? 0;
  }

  startRealtimeListener() {
    if (this.realtimeChannel) {
      return;
    }

    this.log('Connected to Supabase');
    this.log('Listening for lookup jobs...');

    this.realtimeChannel = this.supabase
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
          this.enqueueJob(payload.new);
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
          this.enqueueJob(payload.new);
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          this.error(`Realtime channel error: ${err?.message || 'unknown error'}`);
        } else if (status === 'TIMED_OUT') {
          this.error('Realtime subscription timed out.');
        }
      });
  }

  async start({ prepareSession = true, blockingLogin = true } = {}) {
    if (this.running) {
      this.log('Scanner is already running.');
      return;
    }

    this.ensureSupabaseConfigured();
    await initBrowser();

    if (prepareSession) {
      await prepareScannerSession({ blocking: blockingLogin });
    }

    this.startRealtimeListener();
    await this.loadQueuedBacklog();
    this.running = true;
  }

  async stop() {
    if (this.realtimeChannel) {
      await this.supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }

    this.running = false;
    this.jobQueue = [];
    this.queuedJobIds.clear();
    this.log('Scanner stopped.');
  }

  async shutdown() {
    await this.stop();
    await closeBrowser();
    resetLogger();
  }

  async openLogin() {
    await initBrowser();
    await openIracingLoginPage();
    this.log('iRacing login page opened — sign in manually in the scanner browser panel.');
  }

  async clearSession() {
    await clearBrowserProfile();
  }

  async processQueuedJobs() {
    this.ensureSupabaseConfigured();
    if (!this.supabase) {
      throw new Error('Supabase is not configured.');
    }

    await initBrowser();
    const count = await this.loadQueuedBacklog();
    this.log(`Processing ${count} queued job(s)...`);
  }

  async testCustomerId(customerId, { saveSnapshot = true } = {}) {
    const normalizedId = String(customerId ?? '').trim().replace(/\D/g, '');
    if (!normalizedId) {
      throw new Error('Customer ID is required.');
    }

    this.ensureSupabaseConfigured();
    await initBrowser();

    const { license, stats } = await scrapeCustomerProfile(normalizedId);

    if (license.outcome === 'needs_login') {
      this.log('Needs login — complete sign-in in the scanner browser.');
      return {
        ok: false,
        reason: 'needs_login',
        message: license.message,
      };
    }

    const preview = {
      customerId: normalizedId,
      license: {
        outcome: license.outcome,
        finalUrl: license.finalUrl || null,
        rawText: license.rawText || '',
        excerpt: sanitizeRawTextExcerpt(license.rawText || '', 600),
      },
      stats: {
        outcome: stats?.outcome || 'skipped',
        finalUrl: stats?.finalUrl || null,
        rawText: stats?.rawText || '',
        excerpt: sanitizeRawTextExcerpt(stats?.rawText || '', 600),
      },
      parsed: null,
      statsParsed: null,
      savedSnapshotId: null,
      savedStatsSnapshotId: null,
    };

    if (license.outcome === 'scraped') {
      preview.parsed = this.buildParsedFromLicenseResult(license, stats);
      preview.statsParsed = preview.parsed.statsParsed;
      this.logParsedValues(preview.parsed);
      if (preview.statsParsed) {
        this.logStatsParsedValues(preview.statsParsed);
      }
    } else if (license.outcome === 'wrong_page') {
      preview.parsed = this.buildParsedFromLicenseResult(license, stats);
      this.error(`Wrong page: ${license.message}`);
    } else {
      this.error(`Test failed: ${license.message}`);
      return {
        ok: false,
        reason: license.outcome,
        message: license.message,
        preview,
      };
    }

    if (saveSnapshot) {
      const application = await this.findApplicationByCustomerId(normalizedId);
      if (application?.id) {
        const snapshot = await this.saveSnapshot({
          customerId: normalizedId,
          applicationId: application.id,
          rawText: buildProfileRawText(license.domExtraction, license.rawText),
          parsed: preview.parsed,
        });
        preview.savedSnapshotId = snapshot.id;
        this.log(`License snapshot saved: ${snapshot.id}`);

        if (stats?.outcome === 'scraped') {
          try {
            const statsSave = await this.scrapeAndSaveStats({
              customerId: normalizedId,
              applicationId: application.id,
              statsResult: stats,
            });
            if (statsSave.saved) {
              preview.savedStatsSnapshotId = statsSave.snapshot.id;
            }
          } catch (statsErr) {
            this.error(`Stats snapshot save failed: ${statsErr.message}`);
          }
        }
      } else {
        this.log('No matching driver application found — preview only, snapshot not saved.');
      }
    }

    return {
      ok: true,
      preview,
    };
  }
}

export function createScannerService(options = {}) {
  return new RecruitScannerService(options);
}
