import { DEFAULTS, getSettings, stripPhotoUrlQuery, supabase } from './_lib.js';
import {
  generateFantasyDraftSlate,
  loadFantasyDraftSlate,
} from './_fantasy-slate.js';
import { backfillFantasyHistoricalSlates } from './_fantasy-historical-backfill.js';
import { runFantasySeasonBacktest } from './_fantasy-backtest.js';
import {
  buildFantasyDriverDetailResponse,
  buildFantasyPublicSlateResponse,
  buildFantasySalaryHistoryResponse,
  runFantasyLineupOptimizerForLatestSlate,
} from './_fantasy-public-slate.js';

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
    return res.status(200).json(await getSettings());
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  if (body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Bad password' });
  if (body.verifyOnly) return res.status(200).json({ ok: true });

  const action = String(body.action || '').trim();

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
  const { data, error } = await sb.from('site_settings').upsert(patch).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json(data);
}
