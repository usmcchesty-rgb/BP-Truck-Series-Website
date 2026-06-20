import { slugify, stripPhotoUrlQuery, supabase } from './_lib.js';
import { ARTICLE_TYPES } from '../server/config/news-system-prompt.js';
import { generateNewsArticle, normalizeArticleType } from './_news-generator.js';
import {
  deleteRaceTranscript,
  listRaceTranscripts,
  loadRaceTranscript,
  saveRaceTranscript,
} from './_race-transcripts.js';
import { enrichSpotlightArticles } from './_spotlight-image.js';

function parseBody(req) {
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

function resolveAction(req, body = {}) {
  return String(req.query?.action || body.action || '').trim().toLowerCase();
}

function articleTypeLabel(type) {
  return ARTICLE_TYPES[type]?.label || type;
}

function buildSlug(headline, id = null) {
  const base = slugify(headline || 'news-article') || 'news-article';
  return id ? `${base}-${id}` : base;
}

function normalizeFeaturedImageDisplayMode(body = {}, existing = {}) {
  const raw = String(
    body.featuredImageDisplayMode ??
      body.featured_image_display_mode ??
      existing.featured_image_display_mode ??
      'fill'
  )
    .trim()
    .toLowerCase();
  return raw === 'contain' ? 'contain' : 'fill';
}

function normalizeFeaturedImageCrop(body = {}, existing = {}) {
  const zoom = Number(
    body.featuredImageZoom ??
      body.featured_image_zoom ??
      existing.featured_image_zoom ??
      1
  );
  const x = Number(
    body.featuredImageX ??
      body.featured_image_x ??
      existing.featured_image_x ??
      50
  );
  const y = Number(
    body.featuredImageY ??
      body.featured_image_y ??
      existing.featured_image_y ??
      50
  );
  return {
    featured_image_zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
    featured_image_x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50,
    featured_image_y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50,
  };
}

function normalizeArticle(row) {
  if (!row) return null;
  return {
    id: row.id,
    articleType: row.article_type,
    articleTypeLabel: articleTypeLabel(row.article_type),
    headline: row.headline || '',
    subheadline: row.subheadline || '',
    slug: row.slug || '',
    summary: row.summary || '',
    body: row.body || '',
    author: row.author || 'Miles Apex',
    raceNumber: row.race_number,
    spotlightDriverId: row.spotlight_driver_id || null,
    spotlightImageUrl: stripPhotoUrlQuery(row.spotlight_image_url || ''),
    spotlightImageUpdatedAt: row.spotlight_image_updated_at || null,
    published: row.published === true,
    featuredImageUrl: stripPhotoUrlQuery(row.featured_image_url || ''),
    featuredImageZoom: Number(row.featured_image_zoom) || 1,
    featuredImageX: Number(row.featured_image_x ?? 50),
    featuredImageY: Number(row.featured_image_y ?? 50),
    featuredImageUpdatedAt: row.featured_image_updated_at || null,
    featuredImageDisplayMode: normalizeFeaturedImageDisplayMode({}, row),
    newsTopic: row.news_topic || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

async function loadArticleById(id) {
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.from('news_articles').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return normalizeArticle(data);
}

async function loadArticleBySlug(slug, includeUnpublished = false) {
  const sb = supabase();
  if (!sb) return null;
  let query = sb.from('news_articles').select('*').eq('slug', slug);
  if (!includeUnpublished) query = query.eq('published', true);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return normalizeArticle(data);
}

async function loadArticles(includeUnpublished = false) {
  const sb = supabase();
  if (!sb) return [];

  let query = sb.from('news_articles').select('*').order('published_at', {
    ascending: false,
    nullsFirst: false,
  });
  if (!includeUnpublished) query = query.eq('published', true);

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data.map(normalizeArticle);
}

async function handleGet(req, res) {
  const sb = supabase();
  if (!sb) {
    return res.status(200).json({ configured: false, featured: null, articles: [] });
  }

  const action = resolveAction(req);
  const includeUnpublished = req.query?.admin === '1';
  const slug = String(req.query?.slug || '').trim();
  const id = req.query?.id ? Number(req.query.id) : null;

  const isGet = action === 'get' || Boolean(slug || id);
  const isList = action === 'list' || (!action && !slug && !id);

  if (action === 'get-transcript') {
    const raceNumber = Number(req.query?.raceNumber ?? req.query?.race_number);
    if (!Number.isInteger(raceNumber) || raceNumber < 1) {
      return res.status(400).json({ error: 'Valid raceNumber is required.' });
    }
    const transcript = await loadRaceTranscript(raceNumber);
    return res.status(200).json({ configured: true, transcript });
  }

  if (action === 'list-transcripts') {
    const transcripts = await listRaceTranscripts();
    return res.status(200).json({ configured: true, transcripts });
  }

  if (isGet) {
    if (slug) {
      const article = await loadArticleBySlug(slug, includeUnpublished);
      if (!article) return res.status(404).json({ error: 'Article not found.' });
      const [enriched] = await enrichSpotlightArticles([article]);
      return res.status(200).json({ configured: true, article: enriched });
    }

    if (id) {
      const article = await loadArticleById(id);
      if (!article || (!article.published && !includeUnpublished)) {
        return res.status(404).json({ error: 'Article not found.' });
      }
      const [enriched] = await enrichSpotlightArticles([article]);
      return res.status(200).json({ configured: true, article: enriched });
    }

    return res.status(400).json({ error: 'Missing slug or id for action=get.' });
  }

  if (isList) {
    const articles = await loadArticles(includeUnpublished);
    const enriched = await enrichSpotlightArticles(articles);
    const published = enriched.filter((a) => a.published);
    return res.status(200).json({
      configured: true,
      featured: published[0] || null,
      articles: includeUnpublished ? enriched : published,
    });
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

async function saveArticle(body, publish = false) {
  const sb = supabase();
  if (!sb) return { error: 'Supabase not configured yet.', status: 400 };

  const headline = String(body.headline || '').trim();
  const articleBody = String(body.body || '').trim();
  const articleType = String(
    body.articleType ?? body.article_type ?? 'race-recap'
  ).trim();

  if (!headline) return { error: 'Headline is required.', status: 400 };
  if (!articleBody) return { error: 'Article body is required.', status: 400 };
  if (!ARTICLE_TYPES[articleType]) return { error: 'Invalid article type.', status: 400 };

  const now = new Date().toISOString();
  const id = body.id ? Number(body.id) : null;
  const crop = normalizeFeaturedImageCrop(body);
  const displayMode = normalizeFeaturedImageDisplayMode(body);
  const row = {
    article_type: articleType,
    headline,
    subheadline: String(body.subheadline || '').trim(),
    summary: String(body.summary || '').trim(),
    body: articleBody,
    author: String(body.author || 'Miles Apex').trim() || 'Miles Apex',
    race_number: body.raceNumber ?? body.race_number ?? null,
    spotlight_driver_id: body.spotlightDriverId ?? body.spotlight_driver_id ?? null,
    spotlight_image_url: stripPhotoUrlQuery(
      String(body.spotlightImageUrl ?? body.spotlight_image_url ?? '').trim()
    ),
    featured_image_url: stripPhotoUrlQuery(
      String(body.featuredImageUrl ?? body.featured_image_url ?? '').trim()
    ),
    featured_image_zoom: crop.featured_image_zoom,
    featured_image_x: crop.featured_image_x,
    featured_image_y: crop.featured_image_y,
    featured_image_display_mode: displayMode,
    news_topic: String(body.newsTopic ?? body.news_topic ?? '').trim(),
    updated_at: now,
  };

  if (body.spotlightImageUpdatedAt || body.spotlight_image_updated_at) {
    row.spotlight_image_updated_at =
      body.spotlightImageUpdatedAt || body.spotlight_image_updated_at;
  } else if (
    body.spotlightImageUrl !== undefined ||
    body.spotlight_image_url !== undefined
  ) {
    const nextSpotlightUrl = row.spotlight_image_url;
    if (nextSpotlightUrl && !id) {
      row.spotlight_image_updated_at = now;
    }
    if (!nextSpotlightUrl) {
      row.spotlight_image_updated_at = null;
    }
  }

  if (body.featuredImageUpdatedAt || body.featured_image_updated_at) {
    row.featured_image_updated_at =
      body.featuredImageUpdatedAt || body.featured_image_updated_at;
  } else if (body.featuredImageUrl !== undefined || body.featured_image_url !== undefined) {
    const nextUrl = row.featured_image_url;
    if (nextUrl && !id) {
      row.featured_image_updated_at = now;
    }
  }

  if (publish) {
    row.published = true;
    row.published_at = body.publishedAt || body.published_at || now;
  } else if (!id) {
    row.published = false;
  }

  if (id) {
    row.slug = String(body.slug || buildSlug(headline, id)).trim() || buildSlug(headline, id);
    const { error } = await sb.from('news_articles').update(row).eq('id', id);
    if (error) return { error: `Supabase error: ${error.message}`, status: 500 };
    const saved = await loadArticleById(id);
    const [enriched] = await enrichSpotlightArticles([saved]);
    return { data: enriched, status: 200 };
  }

  const { data, error } = await sb
    .from('news_articles')
    .insert({ ...row, slug: buildSlug(headline) })
    .select()
    .single();

  if (error) {
    if (/duplicate|unique/i.test(error.message)) {
      const retrySlug = buildSlug(headline, Date.now());
      const retry = await sb
        .from('news_articles')
        .insert({ ...row, slug: retrySlug })
        .select()
        .single();
      if (retry.error) return { error: `Supabase error: ${retry.error.message}`, status: 500 };
      const saved = normalizeArticle(retry.data);
      if (saved?.id && saved.slug.endsWith(String(saved.id)) === false) {
        await sb
          .from('news_articles')
          .update({ slug: buildSlug(headline, saved.id) })
          .eq('id', saved.id);
        saved.slug = buildSlug(headline, saved.id);
      }
      const [enriched] = await enrichSpotlightArticles([saved]);
      return { data: enriched, status: 200 };
    }
    return { error: `Supabase error: ${error.message}`, status: 500 };
  }

  const saved = normalizeArticle(data);
  const finalSlug = buildSlug(headline, saved.id);
  if (saved.slug !== finalSlug) {
    await sb.from('news_articles').update({ slug: finalSlug }).eq('id', saved.id);
    saved.slug = finalSlug;
  }

  const [enriched] = await enrichSpotlightArticles([saved]);
  return { data: enriched, status: 200 };
}

async function handleGenerate(body) {
  const articleType = normalizeArticleType(body.articleType ?? body.article_type);
  const isDriverSpotlight = articleType === 'driver-spotlight';
  const spotlightDriverId =
    body.spotlightDriverId ?? body.spotlight_driver_id ?? body.driverId ?? null;

  if (isDriverSpotlight && !spotlightDriverId) {
    return { error: 'Driver Spotlight requires a selected driver.', status: 400 };
  }

  const rawRace = body.raceNumber ?? body.race_number;
  const hasRace =
    rawRace != null && rawRace !== '' && Number.isInteger(Number(rawRace)) && Number(rawRace) >= 1;

  try {
    const result = await generateNewsArticle({
      articleType,
      raceNumber: isDriverSpotlight || !hasRace ? null : Number(rawRace),
      manualNotes: body.manualNotes ?? body.manualRaceNotes ?? body.manual_notes,
      newsTopic: body.newsTopic ?? body.news_topic,
      transcript: body.transcript,
      headlineOverride: body.headlineOverride ?? body.headline_override,
      spotlightDriverId,
    });
    return { data: result, status: 200 };
  } catch (error) {
    return {
      error: error.message || 'News generation failed.',
      status: error.status || 500,
      promptSize: error.promptSize || null,
    };
  }
}

async function handlePost(req, res) {
  const body = parseBody(req);
  if (body.password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Bad password' });
  }

  const action = resolveAction(req, body) || 'save';

  if (action === 'generate') {
    const result = await handleGenerate(body);
    if (result.error) {
      return res.status(result.status).json({
        error: result.error,
        promptSize: result.promptSize || null,
      });
    }
    return res.status(result.status).json(result.data);
  }

  if (action === 'delete') {
    const sb = supabase();
    if (!sb) return res.status(400).json({ error: 'Supabase not configured yet.' });
    const id = Number(body.id);
    if (!id) return res.status(400).json({ error: 'Missing article id.' });
    const { error } = await sb.from('news_articles').delete().eq('id', id);
    if (error) return res.status(500).json({ error: `Supabase error: ${error.message}` });
    return res.status(200).json({ ok: true });
  }

  if (action === 'save-transcript') {
    const result = await saveRaceTranscript(body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(result.status).json(result.data);
  }

  if (action === 'delete-transcript') {
    const result = await deleteRaceTranscript(body.raceNumber ?? body.race_number);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(result.status).json({ ok: true });
  }

  if (action === 'save' || action === 'publish') {
    const result = await saveArticle(body, action === 'publish');
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(result.status).json(result.data);
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method === 'POST') {
    return handlePost(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
