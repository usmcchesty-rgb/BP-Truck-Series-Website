import { getFantasyAuthConfig, getUserFromBearerToken } from './_fantasy-auth.js';
import {
  getFantasyLaunchDashboard,
  getUserLineupForCurrentSlate,
  submitFantasyLineup,
} from './_fantasy-lineups.js';
import { getSettings } from './_lib.js';

function json(res, status, body) {
  res.status(status).json(body);
}

export default async function handler(req, res) {
  const action = String(req.query?.action || req.body?.action || '').trim();

  if (req.method === 'GET') {
    if (action === 'getAuthConfig') {
      const config = getFantasyAuthConfig();
      return json(res, 200, {
        configured: config.configured,
        url: config.url,
        anonKey: config.anonKey,
      });
    }

    if (action === 'getSession') {
      const user = await getUserFromBearerToken(req);
      if (!user) return json(res, 200, { user: null, profile: null });
      const dashboard = await getFantasyLaunchDashboard(user);
      return json(res, 200, {
        user: { id: user.id, email: user.email },
        profile: dashboard.profile,
      });
    }

    if (action === 'getLineup') {
      const user = await getUserFromBearerToken(req);
      if (!user) return json(res, 401, { error: 'Login required.' });
      try {
        const settings = await getSettings();
        const seasonId = req.query?.seasonId || settings.seasonId || '27987';
        const result = await getUserLineupForCurrentSlate(user.id, seasonId);
        return json(res, 200, result);
      } catch (error) {
        return json(res, 500, { error: error.message || 'Failed to load lineup.' });
      }
    }

    if (action === 'getDashboard') {
      const user = await getUserFromBearerToken(req);
      try {
        const dashboard = await getFantasyLaunchDashboard(user);
        return json(res, 200, dashboard);
      } catch (error) {
        return json(res, 500, { error: error.message || 'Failed to load dashboard.' });
      }
    }

    return json(res, 400, { error: 'Unknown action.' });
  }

  if (req.method === 'POST') {
    if (action === 'submitLineup') {
      const user = await getUserFromBearerToken(req);
      if (!user) return json(res, 401, { error: 'Login required to submit a lineup.' });
      try {
        const result = await submitFantasyLineup(user, req.body || {});
        return json(res, 200, result);
      } catch (error) {
        return json(res, 400, { error: error.message || 'Lineup submission failed.' });
      }
    }

    return json(res, 400, { error: 'Unknown action.' });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
