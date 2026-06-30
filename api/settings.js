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
  buildPublicSocialShareConfig,
  buildSocialShareSettingsPatch,
} from './_social-share-settings.js';
import {
  countLineupsForSlate,
  getFantasyAdminSubmittedLineups,
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
  getDriverApplicationById,
  listDriverApplications,
  submitDriverApplication,
  updateDriverApplication,
} from './_driver-applications.js';
import {
  getAnalyticsDailyTraffic,
  getAnalyticsDevices,
  getAnalyticsOverview,
  getAnalyticsPages,
  getAnalyticsReferrers,
  trackPageView,
} from './_site-analytics.js';

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function adminPasswordFromRequest(req, body = {}) {
  return String(
    body.password ||
      req.query?.password ||
      req.headers['x-admin-password'] ||
      req.headers['X-Admin-Password'] ||
      ''
  ).trim();
}

function isAdminPasswordValid(req, body = {}) {
  return adminPasswordFromRequest(req, body) === process.env.ADMIN_PASSWORD;
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
    if (!isAdminPasswordValid(req, body)) {
      res.status(401).json({ error: 'Bad password' });
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

  const applicationId = String(req.query?.id || body.id || '').trim();
  const isApplicationDetailGet =
    req.method === 'GET' &&
    applicationId &&
    (action === 'getDriverApplication' ||
      queryAction === 'getDriverApplication' ||
      queryAction === 'driverApplication');
  if (isApplicationDetailGet) {
    if (!isAdminPasswordValid(req, body)) {
      res.status(401).json({ error: 'Bad password' });
      return true;
    }
    try {
      const application = await getDriverApplicationById(applicationId);
      if (!application) {
        res.status(404).json({ error: 'Application not found.' });
        return true;
      }
      res.status(200).json({ application });
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
    if (!isAdminPasswordValid(req, body)) {
      res.status(401).json({ error: 'Bad password' });
      return true;
    }
    try {
      const result = await updateDriverApplication(applicationId, body);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return true;
      }
      res.status(result.status).json({ ok: true, application: result.application });
      return true;
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to update application.' });
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
        const slate = await buildFantasyPublicSlateResponse(seasonId);
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
      if (!isAdminPasswordValid(req)) return res.status(401).json({ error: 'Bad password' });
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

  const body = req.body || {};
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

  if (body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Bad password' });
  if (body.verifyOnly) return res.status(200).json({ ok: true });

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
      return res.status(500).json({ error: error.message || 'Fantasy slate generation failed.' });
    }
  }

  if (action === 'getFantasyDraftSlate') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const raceNumber = body.raceNumber != null ? Number(body.raceNumber) : null;
      const draft = await loadFantasyDraftSlate(seasonId, raceNumber);

      if (!draft) {
        return res.status(404).json({ error: 'No draft fantasy slate found.' });
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

  if (action === 'getAdminMissionControl') {
    try {
      const settings = await getSettings();
      const seasonId = body.seasonId || settings.seasonId || '27987';
      const progression = await resolveFantasySlateProgression(seasonId, { settings });
      const missionControl = await buildAdminMissionControlResponse({ seasonId, settings });
      const lineupSlateId =
        progression.activeSlateRow?.id ||
        progression.archivedSlateRow?.id ||
        null;
      const lineupCount = lineupSlateId ? await countLineupsForSlate(lineupSlateId) : 0;
      return res.status(200).json({ ...missionControl, lineupCount });
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
      const countSlateId =
        progression.activeSlateRow?.id ||
        progression.archivedSlateRow?.id ||
        publishedPayload?.slate?.id ||
        null;
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
      return res.status(200).json({
        slate: payload?.slate || null,
        publishedSlate: progression.archivedSlateRow || progression.activeSlateRow || publishedPayload?.slate || null,
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
        lockPreview,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load slate stats.' });
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
      const result = await getFantasyAdminSubmittedLineups(seasonId, slateId);
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
