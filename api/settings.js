import { DEFAULTS, getSettings, stripPhotoUrlQuery, supabase } from './_lib.js';
import {
  generateFantasyDraftSlate,
  loadFantasyDraftSlate,
  loadFantasySlateById,
  publishFantasySlate,
  updateFantasySlateLock,
} from './_fantasy-slate.js';
import { backfillFantasyHistoricalSlates } from './_fantasy-historical-backfill.js';
import { runFantasySeasonBacktest } from './_fantasy-backtest.js';
import {
  buildFantasyDriverDetailResponse,
  buildFantasyPublicSlateResponse,
  buildFantasySalaryHistoryResponse,
  runFantasyLineupOptimizerForLatestSlate,
} from './_fantasy-public-slate.js';
import {
  addMissingEligibleDriversToSlate,
  auditFantasyDriverPoolHealth,
  refreshFantasyDriverPoolMetadata,
  regenerateFantasySlatePool,
} from './_fantasy-driver-pool.js';
import {
  buildPublicSocialShareConfig,
  buildSocialShareSettingsPatch,
} from './_social-share-settings.js';
import {
  countLineupsForSlate,
  getFantasyAdminSubmittedLineups,
  resolveAdminSubmittedLineupsSlate,
  getFantasyLaunchDashboard,
  getFantasyPublicStandings,
  getUserLineupForCurrentSlate,
  submitFantasyLineup,
} from './_fantasy-lineups.js';
import { loadLatestFantasySlate } from './_fantasy-public-slate.js';
import {
  computeFantasyLockAt,
  DEFAULT_FANTASY_LOCK_DISPLAY,
} from './_fantasy-lock-time.js';
import {
  buildAdminMissionControlResponse,
  setMissionControlTaskComplete,
} from './_admin-mission-control.js';
import {
  deleteRaceControlReport,
  getRaceControlReport,
  listRaceControlReports,
  reparseRaceControlReport,
  uploadRaceControlReport,
} from './_race-control-reports.js';
import {
  getRaceControlParserRegressionSummary,
  getRaceControlParserTestBoard,
  listRaceControlParserFixtures,
  markRaceControlParserFixture,
  runRaceControlParserRegression,
  runRaceControlParserRegressionForRace,
  seedKnownRaceControlParserFixtures,
  unmarkRaceControlParserFixture,
} from './_race-control-parser-regression.js';
import {
  buildFantasyProgressionMeta,
  resolveFantasySlateProgression,
} from './_fantasy-slate-progression.js';
import { getFantasyAuthConfig, getUserFromBearerToken } from './_fantasy-auth.js';
import {
  deleteDriverApplication,
  enqueueIracingLookupJob,
  getDriverApplicationById,
  getLatestIracingLookupJobForApplication,
  listDriverApplications,
  submitDriverApplication,
  syncApprovedApplicationsToDriverProfiles,
  updateDriverApplication,
} from './_driver-applications.js';
import { buildSyncRuntimeBuildInfo } from './_driver-profile-sync-instrumentation.js';
import { stripPrivateDriverProfileFields } from './_driver-profile-privacy.js';
import { getLatestIracingSnapshotForApplication } from './_driver-application-iracing-snapshots.js';
import { getLatestIracingStatsSnapshotForApplication } from './_driver-application-iracing-stats-snapshots.js';
import {
  assignApplicationNumber,
  getReservationForApplication,
  releaseApplicationNumber,
} from './_driver-number-reservations.js';
import {
  createSrhCareerSnapshotForApplication,
  getLatestSrhCareerSnapshotForApplication,
} from './_driver-application-srh-career-snapshots.js';
import {
  getAnalyticsDailyTraffic,
  getAnalyticsDevices,
  getAnalyticsOverview,
  getAnalyticsPages,
  getAnalyticsReferrers,
  trackPageView,
} from './_site-analytics.js';

import {
  adminAuthFailurePayload,
  parseRequestBody,
  validateAdminPassword,
} from './_admin-auth.js';

function rejectAdminAuth(req, res, body = {}) {
  const validation = validateAdminPassword(req, body);
  if (validation.ok) return false;
  res.status(401).json(adminAuthFailurePayload(validation));
  return true;
}

async function loadFantasyRaceScoringModule() {
  return import('./_fantasy-race-scoring.js');
}

async function handleDriverApplicationRoutes(req, res) {
  const queryAction = String(req.query?.action || '').trim();
  const body = parseRequestBody(req);
  const action = String(body.action || queryAction || '').trim();

  if (
    req.method === 'POST' &&
    (action === 'submitDriverApplication' || queryAction === 'submitDriverApplication')
  ) {
    try {
      const result = await submitDriverApplication(body);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return true;
      }
      res.status(result.status).json({
        ok: true,
        application: result.application,
        srh_career_snapshot: result.srh_career_snapshot || null,
        srh_career_snapshot_error: result.srh_career_snapshot_error || null,
        message:
          'Application received. Our staff will review your information and contact you if we need anything else.',
      });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to submit application.' });
      return true;
    }
  }

  if (
    req.method === 'GET' &&
    (action === 'listDriverApplications' || queryAction === 'listDriverApplications')
  ) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const applications = await listDriverApplications();
      res.status(200).json({ applications });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load applications.' });
      return true;
    }
  }

  if (
    req.method === 'POST' &&
    (action === 'syncApprovedDrivers' || queryAction === 'syncApprovedDrivers')
  ) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const result = await syncApprovedApplicationsToDriverProfiles();
      res.status(200).json(result);
      return true;
    } catch (error) {
      res.status(500).json({
        error: error.message || 'Failed to sync approved drivers.',
        instrumentation: {
          build: buildSyncRuntimeBuildInfo(),
          thrownAt: new Date().toISOString(),
          stackTrace: error.stack || null,
        },
      });
      return true;
    }
  }

  const applicationId = String(req.query?.id || body.id || '').trim();
  const isApplicationDetailGet =
    req.method === 'GET' &&
    applicationId &&
    (action === 'getDriverApplication' ||
      queryAction === 'getDriverApplication' ||
      queryAction === 'driverApplication');
  if (isApplicationDetailGet) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const application = await getDriverApplicationById(applicationId);
      if (!application) {
        res.status(404).json({ error: 'Application not found.' });
        return true;
      }
      const latest_snapshot = await getLatestIracingSnapshotForApplication(applicationId);
      const latest_stats_snapshot = await getLatestIracingStatsSnapshotForApplication(applicationId);
      const latest_lookup_job = await getLatestIracingLookupJobForApplication(applicationId);
      const latest_srh_career_snapshot =
        await getLatestSrhCareerSnapshotForApplication(applicationId);
      const number_reservation = supabase()
        ? await getReservationForApplication(supabase(), applicationId)
        : null;
      res.status(200).json({
        application,
        latest_snapshot,
        latest_stats_snapshot,
        latest_lookup_job,
        latest_srh_career_snapshot,
        number_reservation,
      });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to load application.' });
      return true;
    }
  }

  const isApplicationUpdate =
    (req.method === 'PATCH' || req.method === 'POST') &&
    applicationId &&
    (action === 'updateDriverApplication' ||
      queryAction === 'updateDriverApplication' ||
      (queryAction === 'driverApplication' && req.method === 'PATCH'));
  if (
    isApplicationUpdate &&
    (req.method === 'PATCH' ||
      action === 'updateDriverApplication' ||
      queryAction === 'updateDriverApplication')
  ) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const result = await updateDriverApplication(applicationId, body);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return true;
      }
      res.status(result.status).json({
        ok: true,
        application: result.application,
        driver_profile: stripPrivateDriverProfileFields(result.driver_profile || null),
        driver_profile_action: result.driver_profile_action || null,
        message: result.message || null,
        sync_log: result.sync_log || null,
        number_reservation: result.number_reservation || null,
      });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to update application.' });
      return true;
    }
  }

  const isIracingRefresh =
    req.method === 'POST' &&
    applicationId &&
    (action === 'refreshIracingLookup' ||
      queryAction === 'refreshIracingLookup' ||
      queryAction === 'refreshDriverApplicationIracing');
  if (isIracingRefresh) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const application = await getDriverApplicationById(applicationId);
      if (!application) {
        res.status(404).json({ error: 'Application not found.' });
        return true;
      }
      const result = await enqueueIracingLookupJob(
        application.id,
        application.iracing_customer_id,
        body.reason || 'manual_refresh'
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, job: result.job || null });
        return true;
      }
      res.status(result.status).json({ ok: true, job: result.job });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to refresh iRacing data.' });
      return true;
    }
  }

  const isSrhRefresh =
    req.method === 'POST' &&
    applicationId &&
    (action === 'refreshDriverApplicationSrh' ||
      action === 'refreshSrhCareerStats' ||
      queryAction === 'refreshDriverApplicationSrh' ||
      queryAction === 'refreshSrhCareerStats');
  if (isSrhRefresh) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const application = await getDriverApplicationById(applicationId);
      if (!application) {
        res.status(404).json({ error: 'Application not found.' });
        return true;
      }
      const result = await createSrhCareerSnapshotForApplication(application);
      res.status(result.ok ? 201 : 200).json({
        ok: result.ok,
        snapshot: result.snapshot || null,
      });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to refresh SRH career stats.' });
      return true;
    }
  }

  const isReleaseNumber =
    req.method === 'POST' &&
    applicationId &&
    (action === 'releaseApplicationNumber' || queryAction === 'releaseApplicationNumber');
  if (isReleaseNumber) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const result = await releaseApplicationNumber(
        applicationId,
        body.note || 'released_by_staff'
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return true;
      }
      res.status(200).json({ ok: true, number_reservation: result.reservation || null });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to release number.' });
      return true;
    }
  }

  const isAssignNumber =
    req.method === 'POST' &&
    applicationId &&
    (action === 'assignApplicationNumber' || queryAction === 'assignApplicationNumber');
  if (isAssignNumber) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const result = await assignApplicationNumber(applicationId, { number: body.number });
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return true;
      }
      res.status(200).json({ ok: true, number_reservation: result.reservation || null });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to assign number.' });
      return true;
    }
  }

  const isDeleteApplication =
    req.method === 'POST' &&
    applicationId &&
    (action === 'deleteDriverApplication' || queryAction === 'deleteDriverApplication');
  if (isDeleteApplication) {
    if (rejectAdminAuth(req, res, body)) {
      return true;
    }
    try {
      const result = await deleteDriverApplication(applicationId);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return true;
      }
      res.status(200).json({ ok: true, deletedId: result.deletedId, message: 'Application removed.' });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to delete application.' });
      return true;
    }
  }

  return false;
}

async function handleGetFantasyDraftSlate(req, res) {
  try {
    const settings = await getSettings();
    const seasonId = req.query?.seasonId || settings.seasonId || '27987';
    const raceNumber = req.query?.raceNumber ? Number(req.query.raceNumber) : null;
    const draft = await loadFantasyDraftSlate(seasonId, raceNumber);

    if (!draft) {
      return res.status(404).json({ error: 'No draft fantasy slate found.' });
    }

    return res.status(200).json(draft);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Failed to load draft slate.' });
  }
}

export default async function handler(req, res) {
  try {
    return await handleSettingsRequest(req, res);
  } catch (err) {
    console.error('[settings.js] unhandled error:', err);
    return res.status(500).json({
      success: false,
      error: err?.message || 'Internal server error',
      stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined,
    });
  }
}

async function handleSettingsRequest(req, res) {
  if (await handleDriverApplicationRoutes(req, res)) return;

  const queryAction = String(req.query?.action || '').trim();

  if (req.method === 'GET') {
    if (queryAction === 'getFantasyDraftSlate') {
      return handleGetFantasyDraftSlate(req, res);
    }
    if (queryAction === 'getFantasyPublicSlate') {
      try {
        const settings = await getSettings();
        const seasonId = req.query?.seasonId || settings.seasonId || '27987';
        const includeDashboardDiagnostics =
          String(req.query?.dashboardDiagnostics || '').trim() === '1';
        const slate = await buildFantasyPublicSlateResponse(seasonId, {
          includeDashboardDiagnostics,
        });
        if (!slate) {
          return res.status(404).json({ error: 'No fantasy slate found.' });
        }
        return res.status(200).json(slate);
      } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load public slate.' });
      }
    }
    if (queryAction === 'getFantasySalaryHistory') {
      try {
        const settings = await getSettings();
        const seasonId = req.query?.seasonId || settings.seasonId || '27987';
        const history = await buildFantasySalaryHistoryResponse(seasonId);
        if (!history?.latestSlate) {
          return res.status(404).json({ error: 'No fantasy salary history found.' });
        }
        return res.status(200).json(history);
      } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load salary history.' });
      }
    }
    if (queryAction === 'getSocialShareConfig') {
      try {
        const settings = await getSettings();
        return res.status(200).json(buildPublicSocialShareConfig(settings));
      } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load social share config.' });
      }
    }
    if (queryAction === 'getFantasyDriverDetail') {
      try {
        const settings = await getSettings();
        const seasonId = req.query?.seasonId || settings.seasonId || '27987';
        const detail = await buildFantasyDriverDetailResponse(seasonId, {
          driverId: req.query?.id || req.query?.driverId || null,
          driverName: req.query?.driver || req.query?.driverName || null,
        });
        if (!detail) {
          return res.status(404).json({ error: 'Driver not found in current fantasy slate.' });
        }
        return res.status(200).json(detail);
      } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load driver detail.' });
      }
    }
    if (queryAction === 'getAuthConfig') {
      const config = getFantasyAuthConfig();
      return res.status(200).json({
        configured: config.configured,
        url: config.url,
        anonKey: config.anonKey,
      });
    }
    if (queryAction === 'getSession') {
      const user = await getUserFromBearerToken(req);
      if (!user) return res.status(200).json({ user: null, profile: null });
      const dashboard = await getFantasyLaunchDashboard(user);
      return res.status(200).json({
        user: { id: user.id, email: user.email },
        profile: dashboard.profile,
      });
    }
    if (queryAction === 'getLineup') {
      const user = await getUserFromBearerToken(req);
      if (!user) return res.status(401).json({ error: 'Login required.' });
      try {
        const settings = await getSettings();
        const seasonId = req.query?.seasonId || settings.seasonId || '27987';
        const result = await getUserLineupForCurrentSlate(user.id, seasonId);
        return res.status(200).json(result);
      } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load lineup.' });
      }
    }
    if (queryAction === 'getDashboard') {
      const user = await getUserFromBearerToken(req);
      try {
        const dashboard = await getFantasyLaunchDashboard(user);
        return res.status(200).json(dashboard);
      } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load dashboard.' });
      }
    }
    if (queryAction === 'getFantasyStandings') {
      try {
        const settings = await getSettings();
        const seasonId = req.query?.seasonId || settings.seasonId || '27987';
        const standings = await getFantasyPublicStandings(seasonId);
        return res.status(200).json(standings);
      } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load fantasy standings.' });
      }
    }
    if (
      queryAction === 'getAnalyticsOverview' ||
      queryAction === 'getAnalyticsPages' ||
      queryAction === 'getAnalyticsReferrers' ||
      queryAction === 'getAnalyticsDevices' ||
      queryAction === 'getAnalyticsDailyTraffic'
    ) {
      const getBody = parseRequestBody(req);
      if (rejectAdminAuth(req, res, getBody)) return;
      try {
        if (queryAction === 'getAnalyticsOverview') {
          return res.status(200).json(await getAnalyticsOverview(req));
        }
        if (queryAction === 'getAnalyticsPages') {
          return res.status(200).json(await getAnalyticsPages(req));
        }
        if (queryAction === 'getAnalyticsReferrers') {
          return res.status(200).json(await getAnalyticsReferrers(req));
        }
        if (queryAction === 'getAnalyticsDevices') {
          return res.status(200).json(await getAnalyticsDevices(req));
        }
        return res.status(200).json(await getAnalyticsDailyTraffic(req));
      } catch (error) {
        return res.status(error.status || 500).json({ error: error.message || 'Analytics request failed.' });
      }
    }
    return res.status(200).json(await getSettings());
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = parseRequestBody(req);
  const action = String(body.action || req.query?.action || '').trim();

  if (action === 'trackPageView') {
    try {
      const result = await trackPageView(body, req);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to track page view.' });
    }
  }

  if (action === 'submitLineup') {
    const user = await getUserFromBearerToken(req);
    if (!user) return res.status(401).json({ error: 'Login required to submit a lineup.' });
    try {
      const result = await submitFantasyLineup(user, body);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Lineup submission failed.' });
    }
  }

  const adminAuth = validateAdminPassword(req, body);
  if (!adminAuth.ok) {
    if (body.verifyOnly) {
      return res.status(401).json({
        success: false,
        message: adminAuth.error,
        ...adminAuthFailurePayload(adminAuth),
      });
    }
    return res.status(401).json(adminAuthFailurePayload(adminAuth));
  }
  if (body.verifyOnly) {
    try {
      return res.status(200).json({
        success: true,
        ok: true,
        ...adminAuth.diagnostics,
      });
    } catch (err) {
      console.error('[settings.js] verifyOnly failed:', err);
      return res.status(500).json({
        success: false,
        error: err?.message || 'verifyOnly failed',
        stack: process.env.NODE_ENV !== 'production' ? err?.stack : undefined,
      });
    }
  }

  if (action === 'getAnalyticsOverview') {
    try {
      return res.status(200).json(await getAnalyticsOverview(req, body));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Analytics request failed.' });
    }
  }
  if (action === 'getAnalyticsPages') {
    try {
      return res.status(200).json(await getAnalyticsPages(req, body));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Analytics request failed.' });
    }
  }
  if (action === 'getAnalyticsReferrers') {
    try {
      return res.status(200).json(await getAnalyticsReferrers(req, body));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Analytics request failed.' });
    }
  }
  if (action === 'getAnalyticsDevices') {
    try {
      return res.status(200).json(await getAnalyticsDevices(req, body));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Analytics request failed.' });
    }
  }
  if (action === 'getAnalyticsDailyTraffic') {
    try {
      return res.status(200).json(await getAnalyticsDailyTraffic(req, body));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Analytics request failed.' });
    }
  }

  if (action === 'generateFantasySlate') {
    try {
      const result = await generateFantasyDraftSlate({
        raceNumber: body.raceNumber ?? body.race_number ?? null,
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error.code === 'PUBLISHED_SLATE_EXISTS') {
        return res.status(409).json({
          error: error.message,
          code: error.code,
          existingSlateFound: true,
          slateId: error.existingSlateId,
          raceNumber: error.raceNumber,
          actionTaken: 'loaded_existing',
        });
      }
      return res.status(500).json({ error: error.message || 'Fantasy slate generation failed.' });
    }
  }

  if (action === 'getFantasyDraftSlate') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const raceNumber = body.raceNumber != null ? Number(body.raceNumber) : null;
      const { loadFantasySlateForRace } = await import('./_fantasy-slate.js');
      const draft =
        (await loadFantasySlateForRace(seasonId, raceNumber)) ||
        (await loadFantasyDraftSlate(seasonId, raceNumber));

      if (!draft) {
        return res.status(404).json({ error: 'No fantasy slate found for this race.' });
      }

      return res.status(200).json(draft);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load draft slate.' });
    }
  }

  if (action === 'runFantasySeasonBacktest') {
    try {
      const result = await runFantasySeasonBacktest();
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Fantasy backtest failed.' });
    }
  }

  if (action === 'runFantasyLineupOptimizer') {
    try {
      const settings = await getSettings();
      const result = await runFantasyLineupOptimizerForLatestSlate({
        seasonId: body.seasonId || settings.seasonId || '27987',
        salaryCap: body.salaryCap ?? 50000,
        lineupSize: body.lineupSize ?? 5,
        requireValueOrMid: Boolean(body.requireValueOrMid),
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Lineup optimizer failed.' });
    }
  }

  if (action === 'backfillFantasyHistoricalSlates') {
    try {
      const result = await backfillFantasyHistoricalSlates({
        overwrite: body.overwrite === true,
        seasonId: body.seasonId,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Historical slate backfill failed.' });
    }
  }

  if (action === 'publishFantasySlate') {
    try {
      const settings = await getSettings();
      const result = await publishFantasySlate({
        seasonId: body.seasonId || settings.seasonId || '27987',
        slateId: body.slateId != null ? Number(body.slateId) : null,
        raceNumber: body.raceNumber != null ? Number(body.raceNumber) : null,
        lockTime: body.lockTime,
        lockAt: body.lockAt,
        useLockOverride: body.useLockOverride === true,
      });
      const lineupCount = await countLineupsForSlate(result?.slate?.id);
      return res.status(200).json({ ...result, lineupCount });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to publish fantasy slate.' });
    }
  }

  if (action === 'updateFantasySlateLock') {
    try {
      const settings = await getSettings();
      const result = await updateFantasySlateLock({
        seasonId: body.seasonId || settings.seasonId || '27987',
        slateId: body.slateId != null ? Number(body.slateId) : null,
        raceNumber: body.raceNumber != null ? Number(body.raceNumber) : null,
        lockTime: body.lockTime,
        lockAt: body.lockAt,
        useLockOverride: body.useLockOverride === true,
      });
      const lineupCount = await countLineupsForSlate(result?.slate?.id);
      return res.status(200).json({ ...result, lineupCount });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to update lock time.' });
    }
  }

  if (action === 'previewFantasySlateLock') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      let raceNumber = body.raceNumber != null ? Number(body.raceNumber) : null;
      if (body.slateId != null && Number.isFinite(Number(body.slateId))) {
        const payload = await loadFantasySlateById(Number(body.slateId));
        raceNumber = payload?.slate?.race_number ?? raceNumber;
      }
      const preview = await computeFantasyLockAt({
        raceNumber,
        lockTimeDisplay: body.lockTime || DEFAULT_FANTASY_LOCK_DISPLAY,
        lockAtOverride: body.lockAt,
        useLockOverride: body.useLockOverride === true,
        seasonId,
        settings,
      });
      return res.status(200).json(preview);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to preview lock time.' });
    }
  }

  if (action === 'getFantasyRaceScoringStatus') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { getFantasyRaceScoringStatus } = await loadFantasyRaceScoringModule();
      const status = await getFantasyRaceScoringStatus({
        seasonId,
        settings,
        raceNumber: body.raceNumber,
      });
      return res.status(200).json(status);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load fantasy scoring status.' });
    }
  }

  if (action === 'getDriverProvisionalLedger') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { buildDriverProvisionalLedgerBoard } = await import('./_driver-provisionals.js');
      const board = await buildDriverProvisionalLedgerBoard(seasonId, {
        settings,
        raceNumber: body.raceNumber != null ? Number(body.raceNumber) : null,
      });
      return res.status(200).json(board);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load provisional ledger.' });
    }
  }

  if (action === 'validateDriverProvisionalLedgerSeason') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { validateEntireSeasonProvisionalLedger } = await import('./_driver-provisionals.js');
      const result = await validateEntireSeasonProvisionalLedger(seasonId, { settings });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to validate provisional ledger season.' });
    }
  }

  if (action === 'addDriverProvisional') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { addDriverProvisionalEntry } = await import('./_driver-provisionals.js');
      const { clearProvisionalSyncCache } = await import('./_driver-provisional-sync.js');
      const entry = await addDriverProvisionalEntry({
        seasonId,
        driverId: body.driverId,
        raceNumber: body.raceNumber,
        type: body.type,
        notes: body.notes,
        createdBy: body.createdBy || 'admin',
      });
      clearProvisionalSyncCache(seasonId, body.raceNumber);
      return res.status(200).json({ ok: true, entry });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Failed to add provisional ledger entry.' });
    }
  }

  if (action === 'updateDriverProvisionalNotes') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { updateDriverProvisionalNotes } = await import('./_driver-provisionals.js');
      const entry = await updateDriverProvisionalNotes({
        seasonId,
        driverId: body.driverId,
        raceNumber: body.raceNumber,
        notes: body.notes,
      });
      return res.status(200).json({ ok: true, entry });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Failed to update provisional notes.' });
    }
  }

  if (action === 'updateDriverProvisionalType') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { updateDriverProvisionalType } = await import('./_driver-provisionals.js');
      const { clearProvisionalSyncCache } = await import('./_driver-provisional-sync.js');
      const entry = await updateDriverProvisionalType({
        seasonId,
        driverId: body.driverId,
        raceNumber: body.raceNumber,
        type: body.type,
        notes: body.notes,
        updatedBy: body.updatedBy || 'admin',
      });
      clearProvisionalSyncCache(seasonId, body.raceNumber);
      return res.status(200).json({ ok: true, entry });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Failed to update provisional type.' });
    }
  }

  if (action === 'removeDriverProvisional') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { removeDriverProvisionalEntry } = await import('./_driver-provisionals.js');
      const { clearProvisionalSyncCache } = await import('./_driver-provisional-sync.js');
      await removeDriverProvisionalEntry({
        seasonId,
        driverId: body.driverId,
        raceNumber: body.raceNumber,
      });
      clearProvisionalSyncCache(seasonId, body.raceNumber);
      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Failed to remove provisional ledger entry.' });
    }
  }

  if (action === 'getFantasyPostRaceAutomationStatus') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { getFantasyPostRaceAutomationStatus } = await import('./_fantasy-post-race-automation.js');
      const status = await getFantasyPostRaceAutomationStatus(seasonId, { settings });
      return res.status(200).json(status);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load post-race automation status.' });
    }
  }

  if (action === 'retryFantasySalaryDraft') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const { getFantasyPostRaceAutomationStatus, maybeAutoGenerateNextRaceSalaryDraft } = await import(
        './_fantasy-post-race-automation.js'
      );
      const status = await getFantasyPostRaceAutomationStatus(seasonId, { settings });
      const completedRaceNumber = status.completedRace?.raceNumber;
      if (completedRaceNumber == null) {
        return res.status(400).json({ error: 'No completed race available for salary draft generation.' });
      }
      const result = await maybeAutoGenerateNextRaceSalaryDraft(seasonId, completedRaceNumber, {
        settings,
        adminRegenerate: body.confirmOverwrite === true,
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Salary draft retry failed.' });
    }
  }

  if (action === 'scoreFantasyRace') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const { scoreFantasySlate } = await loadFantasyRaceScoringModule();
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const result = await scoreFantasySlate({
        seasonId,
        settings,
        raceNumber: body.raceNumber,
        adminOverride: body.adminOverride === true,
        source: 'admin',
      });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Fantasy scoring failed.' });
    }
  }

  if (action === 'getAdminMissionControl') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      let postRaceAutomation = null;
      try {
        const { runFantasyPostRaceAutomation } = await import('./_fantasy-post-race-automation.js');
        postRaceAutomation = await runFantasyPostRaceAutomation(seasonId, { settings });
      } catch (error) {
        postRaceAutomation = {
          error: error.message || 'fantasy_post_race_automation_failed',
          detector: 'runFantasyPostRaceAutomation',
        };
      }
      const missionControl = await buildAdminMissionControlResponse({ seasonId, settings });
      const progression = await resolveFantasySlateProgression(seasonId, { settings });
      const lineupSlateId =
        progression.activeSlateRow?.id ||
        progression.archivedSlateRow?.id ||
        null;
      const lineupCount = lineupSlateId ? await countLineupsForSlate(lineupSlateId) : 0;
      return res.status(200).json({ ...missionControl, lineupCount, postRaceAutomation });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load mission control.' });
    }
  }

  if (action === 'updateAdminMissionControlTask') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      await setMissionControlTaskComplete({
        seasonId,
        raceNumber: body.raceNumber,
        taskId: body.taskId,
        workflow: body.workflow,
        completed: body.completed !== false,
        manualOverride: body.manualOverride === true,
        manuallyCompletedBy: body.manuallyCompletedBy || 'admin',
      });
      const missionControl = await buildAdminMissionControlResponse({ seasonId, settings });
      const activeProgression = await resolveFantasySlateProgression(seasonId, { settings });
      const lineupSlateId =
        activeProgression.activeSlateRow?.id ||
        activeProgression.archivedSlateRow?.id ||
        null;
      const lineupCount = lineupSlateId ? await countLineupsForSlate(lineupSlateId) : 0;
      return res.status(200).json({ ok: true, ...missionControl, lineupCount });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to update mission control task.' });
    }
  }

  if (action === 'getFantasySlateAdminStats') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const requestedSlateId =
        body.slateId != null && Number.isFinite(Number(body.slateId))
          ? Number(body.slateId)
          : null;
      const payload = requestedSlateId
        ? await loadFantasySlateById(requestedSlateId)
        : await loadFantasyDraftSlate(seasonId);
      const publishedPayload = await loadLatestFantasySlate(seasonId);
      const progression = await resolveFantasySlateProgression(seasonId);
      const submittedLineupsSlate = await resolveAdminSubmittedLineupsSlate(seasonId);
      const countSlateId = submittedLineupsSlate.slateRow?.id ?? null;
      const lineupCount = countSlateId ? await countLineupsForSlate(countSlateId) : 0;
      let lockPreview = null;
      if (payload?.slate?.race_number) {
        lockPreview = await computeFantasyLockAt({
          raceNumber: payload.slate.race_number,
          lockTimeDisplay: payload.slate.lock_time || DEFAULT_FANTASY_LOCK_DISPLAY,
          seasonId,
          settings,
        });
      }
      let driverPoolHealth = null;
      try {
        driverPoolHealth = await auditFantasyDriverPoolHealth(seasonId, {
          raceNumber:
            progression.activeSlateRow?.race_number ??
            payload?.slate?.race_number ??
            progression.nextRaceNumber ??
            null,
          settings,
        });
      } catch (poolError) {
        driverPoolHealth = { error: poolError.message || 'driver_pool_health_failed' };
      }
      return res.status(200).json({
        slate: payload?.slate || null,
        publishedSlate:
          progression.activeSlateRow ||
          progression.archivedSlateRow ||
          publishedPayload?.slate ||
          null,
        activePlayableSlate: progression.activeSlateRow,
        completedPublishedSlate: progression.archivedSlateRow,
        progression: buildFantasyProgressionMeta(progression),
        nextRace: progression.nextRaceNumber
          ? {
              raceNumber: progression.nextRaceNumber,
              track: progression.nextRaceTrack,
              date: progression.nextRaceDate,
            }
          : null,
        lineupCount,
        submittedLineupsSelection: submittedLineupsSlate.selection,
        lockPreview,
        driverPoolHealth,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load slate stats.' });
    }
  }

  if (action === 'getFantasyDriverPoolHealth') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const audit = await auditFantasyDriverPoolHealth(seasonId, {
        raceNumber: body.raceNumber != null ? Number(body.raceNumber) : null,
        settings,
      });
      return res.status(200).json({ ok: true, ...audit });
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || 'Failed to audit fantasy driver pool.',
        code: error.code || null,
        audit: error.audit || null,
      });
    }
  }

  if (action === 'refreshFantasyDriverPool') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const audit = await refreshFantasyDriverPoolMetadata(seasonId, {
        raceNumber: body.raceNumber != null ? Number(body.raceNumber) : null,
        settings,
      });
      return res.status(200).json({ ok: true, ...audit });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to refresh fantasy driver pool metadata.' });
    }
  }

  if (action === 'addMissingFantasyDraftDrivers') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const result = await addMissingEligibleDriversToSlate(seasonId, {
        raceNumber: body.raceNumber != null ? Number(body.raceNumber) : null,
        settings,
        confirmManualEditMerge: body.confirmManualEditMerge === true,
        confirmLineupsExist: body.confirmLineupsExist === true,
        adminLockOverride: body.adminLockOverride === true,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || 'Failed to add missing fantasy slate drivers.',
        code: error.code || null,
        audit: error.audit || null,
        lineupCount: error.lineupCount ?? null,
      });
    }
  }

  if (action === 'regenerateFantasySlatePool') {
    if (rejectAdminAuth(req, res, body)) return;
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const result = await regenerateFantasySlatePool(seasonId, {
        raceNumber: body.raceNumber != null ? Number(body.raceNumber) : null,
        settings,
        mode: body.mode === 'full_regenerate' ? 'full_regenerate' : 'add_missing_only',
        confirmLineupsExist: body.confirmLineupsExist === true,
        confirmManualEditMerge: body.confirmManualEditMerge === true,
        adminLockOverride: body.adminLockOverride === true,
      });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.status || 500).json({
        error: error.message || 'Failed to regenerate fantasy slate pool.',
        code: error.code || null,
        audit: error.audit || null,
        lineupCount: error.lineupCount ?? null,
      });
    }
  }

  if (action === 'getFantasySubmittedLineups') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const slateId =
        body.slateId != null && Number.isFinite(Number(body.slateId))
          ? Number(body.slateId)
          : null;
      const raceNumber =
        body.raceNumber != null && Number.isFinite(Number(body.raceNumber))
          ? Number(body.raceNumber)
          : null;
      const result = await getFantasyAdminSubmittedLineups(seasonId, { slateId, raceNumber });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load submitted lineups.' });
    }
  }

  if (action === 'getRaceControlReport') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const raceNumber = body.raceNumber != null ? Number(body.raceNumber) : null;
      if (raceNumber != null) {
        const report = await getRaceControlReport(seasonId, raceNumber);
        return res.status(200).json({ report });
      }
      const reports = await listRaceControlReports(seasonId);
      return res.status(200).json({ reports });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to load race control report.' });
    }
  }

  if (action === 'uploadRaceControlReport') {
    try {
      const settings = await getSettings();
      const report = await uploadRaceControlReport(body, { settings });
      return res.status(200).json({ ok: true, report });
    } catch (error) {
      if (error.details?.setupSql) {
        return res.status(error.status || 400).json({
          error: error.message || 'Upload failed.',
          bucket: error.details.bucket,
          setupSql: error.details.setupSql,
        });
      }
      return res.status(error.status || 500).json({ error: error.message || 'Race Control PDF upload failed.' });
    }
  }

  if (action === 'deleteRaceControlReport') {
    try {
      const settings = await getSettings();
      const result = await deleteRaceControlReport(body, { settings });
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to delete race control report.' });
    }
  }

  if (action === 'reparseRaceControlReport') {
    try {
      const settings = await getSettings();
      const report = await reparseRaceControlReport(body, { settings });
      return res.status(200).json({ ok: true, report });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to reparse race control report.' });
    }
  }

  if (action === 'getRaceControlParserFixtures') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const fixtures = await listRaceControlParserFixtures(seasonId);
      const summary = await getRaceControlParserRegressionSummary(seasonId);
      return res.status(200).json({ fixtures, summary });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to load parser fixtures.' });
    }
  }

  if (action === 'getRaceControlParserTestBoard') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const board = await getRaceControlParserTestBoard(seasonId);
      return res.status(200).json(board);
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to load parser test board.' });
    }
  }

  if (action === 'markRaceControlParserFixture') {
    try {
      const settings = await getSettings();
      const fixture = await markRaceControlParserFixture(body, { settings });
      return res.status(200).json({ ok: true, fixture });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to mark parser fixture.' });
    }
  }

  if (action === 'unmarkRaceControlParserFixture') {
    try {
      const result = await unmarkRaceControlParserFixture(body);
      return res.status(200).json(result);
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to remove parser fixture.' });
    }
  }

  if (action === 'runRaceControlParserRegression') {
    try {
      const settings = await getSettings();
      const summary = await runRaceControlParserRegression(body, { settings });
      return res.status(200).json({ ok: true, summary });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Parser regression run failed.' });
    }
  }

  if (action === 'runRaceControlParserRegressionForRace') {
    try {
      const settings = await getSettings();
      const result = await runRaceControlParserRegressionForRace(body, { settings });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Parser regression run failed for race.' });
    }
  }

  if (action === 'seedKnownRaceControlParserFixtures') {
    try {
      const settings = await getSettings();
      const result = await seedKnownRaceControlParserFixtures(body, { settings });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Failed to seed known parser fixtures.' });
    }
  }

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
  if (body.fantasyHeroBackgroundUrl !== undefined) {
    const nextUrl = stripPhotoUrlQuery(String(body.fantasyHeroBackgroundUrl || '').trim());
    patch.fantasyHeroBackgroundUrl = nextUrl;
    patch.fantasyHeroBackgroundUpdatedAt = nextUrl ? new Date().toISOString() : null;
  }
  if (body.fantasyHeaderLogoUrl !== undefined) {
    const nextUrl = stripPhotoUrlQuery(String(body.fantasyHeaderLogoUrl || '').trim());
    patch.fantasyHeaderLogoUrl = nextUrl;
    patch.fantasyHeaderLogoUpdatedAt = nextUrl ? new Date().toISOString() : null;
  }
  if (body.fantasyHeaderLogoTopPercent !== undefined) {
    const v = Number(body.fantasyHeaderLogoTopPercent);
    patch.fantasyHeaderLogoTopPercent = Number.isFinite(v) ? Math.min(45, Math.max(8, v)) : DEFAULTS.fantasyHeaderLogoTopPercent;
  }
  if (body.fantasyHeaderLogoWidthVw !== undefined) {
    const v = Number(body.fantasyHeaderLogoWidthVw);
    patch.fantasyHeaderLogoWidthVw = Number.isFinite(v) ? Math.min(60, Math.max(15, v)) : DEFAULTS.fantasyHeaderLogoWidthVw;
  }
  if (body.fantasyHeaderLogoMaxWidthPx !== undefined) {
    const v = Number(body.fantasyHeaderLogoMaxWidthPx);
    patch.fantasyHeaderLogoMaxWidthPx = Number.isFinite(v) ? Math.min(900, Math.max(240, v)) : DEFAULTS.fantasyHeaderLogoMaxWidthPx;
  }
  Object.assign(patch, buildSocialShareSettingsPatch(body));
  const { data, error } = await sb.from('site_settings').upsert(patch).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}
