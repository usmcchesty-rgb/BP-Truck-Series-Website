import { supabase } from './_lib.js';

const PUBLIC_TRAFFIC_FILTER = { is_admin: false };

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

function startOfDayUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function seasonStartDate() {
  const now = new Date();
  const year = now.getUTCMonth() >= 1 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 1, 1));
}

export function parseAnalyticsDateRange(req, body = {}) {
  const preset = String(body.preset || req.query?.preset || 'last30').trim().toLowerCase();
  const now = new Date();
  const end = body.endDate || req.query?.endDate
    ? new Date(String(body.endDate || req.query?.endDate))
    : now;
  const endIso = Number.isNaN(end.getTime()) ? now.toISOString() : end.toISOString();

  let start;
  if (preset === 'today') {
    start = startOfDayUtc(now);
  } else if (preset === 'last7') {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (preset === 'last30') {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (preset === 'season') {
    start = seasonStartDate();
  } else if (preset === 'custom') {
    const customStart = new Date(String(body.startDate || req.query?.startDate || ''));
    start = Number.isNaN(customStart.getTime()) ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) : customStart;
  } else {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return {
    preset,
    startIso: start.toISOString(),
    endIso,
  };
}

function parseUserAgent(ua = '') {
  const agent = String(ua || '');
  const lower = agent.toLowerCase();

  let deviceType = 'Desktop';
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(agent)) deviceType = 'Tablet';
  else if (/mobile|iphone|ipod|android|blackberry|phone/i.test(agent)) deviceType = 'Mobile';
  else if (!agent.trim()) deviceType = 'Unknown';

  let browser = 'Unknown';
  if (/edg\//i.test(agent)) browser = 'Edge';
  else if (/chrome\//i.test(agent) && !/edg\//i.test(agent)) browser = 'Chrome';
  else if (/safari\//i.test(agent) && !/chrome\//i.test(agent)) browser = 'Safari';
  else if (/firefox\//i.test(agent)) browser = 'Firefox';
  else if (/msie|trident/i.test(agent)) browser = 'IE';

  let os = 'Unknown';
  if (/windows nt/i.test(agent)) os = 'Windows';
  else if (/mac os x/i.test(agent)) os = 'macOS';
  else if (/android/i.test(agent)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(agent)) os = 'iOS';
  else if (/linux/i.test(agent)) os = 'Linux';

  return { deviceType, browser, os };
}

function normalizePath(path = '') {
  const value = String(path || '').trim();
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function isAdminPath(path = '') {
  return normalizePath(path).startsWith('/admin');
}

export async function trackPageView(body = {}, req = {}) {
  const sb = supabase();
  if (!sb) {
    const err = new Error('Analytics storage is not configured.');
    err.status = 503;
    throw err;
  }

  const path = normalizePath(body.path || body.pagePath || '/');
  const isAdmin = body.isAdmin === true || isAdminPath(path);

  if (isAdmin) {
    return { ok: true, skipped: true, reason: 'admin_page' };
  }

  const ua = String(body.userAgent || req.headers?.['user-agent'] || '').slice(0, 512);
  const parsed = parseUserAgent(ua);

  const row = {
    path: path.slice(0, 500),
    full_url: String(body.fullUrl || body.full_url || '').slice(0, 2000) || null,
    page_title: String(body.pageTitle || body.page_title || '').slice(0, 500) || null,
    referrer: String(body.referrer || '').slice(0, 2000) || null,
    user_agent: ua || null,
    device_type: body.deviceType || body.device_type || parsed.deviceType,
    browser: body.browser || parsed.browser,
    os: body.os || parsed.os,
    country: body.country || null,
    region: body.region || null,
    city: body.city || null,
    session_id: String(body.sessionId || body.session_id || '').slice(0, 128) || null,
    visitor_id: String(body.visitorId || body.visitor_id || '').slice(0, 128) || null,
    is_admin: false,
  };

  const { error } = await sb.from('site_page_views').insert(row);
  if (error) {
    const err = new Error(error.message || 'Failed to record page view.');
    err.status = 500;
    throw err;
  }

  return { ok: true };
}

async function loadViewsInRange(startIso, endIso) {
  const sb = supabase();
  if (!sb) {
    const err = new Error('Analytics storage is not configured.');
    err.status = 503;
    throw err;
  }

  const { data, error } = await sb
    .from('site_page_views')
    .select('id, created_at, path, referrer, visitor_id, session_id, device_type, browser, os')
    .eq('is_admin', false)
    .gte('created_at', startIso)
    .lte('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(50000);

  if (error) {
    const err = new Error(error.message || 'Failed to load analytics.');
    err.status = 500;
    throw err;
  }

  return Array.isArray(data) ? data : [];
}

function uniqueVisitors(rows) {
  const set = new Set();
  rows.forEach((row) => {
    const id = row.visitor_id || row.session_id;
    if (id) set.add(id);
  });
  return set.size;
}

function groupCount(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row) || '(unknown)';
    if (!map.has(key)) map.set(key, { views: 0, visitors: new Set() });
    const entry = map.get(key);
    entry.views += 1;
    const visitor = row.visitor_id || row.session_id;
    if (visitor) entry.visitors.add(visitor);
  });
  return map;
}

function topEntry(map) {
  let best = null;
  map.forEach((value, key) => {
    if (!best || value.views > best.views) best = { key, views: value.views, uniqueVisitors: value.visitors.size };
  });
  return best;
}

function dailyBuckets(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const day = String(row.created_at || '').slice(0, 10);
    if (!day) return;
    if (!map.has(day)) map.set(day, { date: day, views: 0, visitors: new Set() });
    const entry = map.get(day);
    entry.views += 1;
    const visitor = row.visitor_id || row.session_id;
    if (visitor) entry.visitors.add(visitor);
  });
  return [...map.values()]
    .map((entry) => ({
      date: entry.date,
      views: entry.views,
      uniqueVisitors: entry.visitors.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getAnalyticsOverview(req, body = {}) {
  const range = parseAnalyticsDateRange(req, body);
  const rows = await loadViewsInRange(range.startIso, range.endIso);

  const now = new Date();
  const todayStart = startOfDayUtc(now).toISOString();
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const last30Start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const allRows = rows;
  const todayRows = allRows.filter((r) => r.created_at >= todayStart);
  const last7Rows = allRows.filter((r) => r.created_at >= last7Start);
  const last30Rows = allRows.filter((r) => r.created_at >= last30Start);

  const pageMap = groupCount(allRows, (r) => r.path);
  const referrerMap = groupCount(allRows, (r) => {
    const ref = String(r.referrer || '').trim();
    if (!ref) return 'Direct / None';
    try {
      return new URL(ref).hostname || ref;
    } catch {
      return ref.slice(0, 120);
    }
  });
  const daily = dailyBuckets(allRows);
  const topDay = daily.reduce((best, row) => (!best || row.views > best.views ? row : best), null);

  return {
    range,
    totalPageViews: allRows.length,
    uniqueVisitors: uniqueVisitors(allRows),
    viewsToday: todayRows.length,
    viewsLast7Days: last7Rows.length,
    viewsLast30Days: last30Rows.length,
    topPage: topEntry(pageMap),
    topReferrer: topEntry(referrerMap),
    mostActiveDay: topDay ? { date: topDay.date, views: topDay.views, uniqueVisitors: topDay.uniqueVisitors } : null,
  };
}

export async function getAnalyticsPages(req, body = {}) {
  const range = parseAnalyticsDateRange(req, body);
  const rows = await loadViewsInRange(range.startIso, range.endIso);
  const total = rows.length || 1;
  const pageMap = groupCount(rows, (r) => r.path);

  const pages = [...pageMap.entries()]
    .map(([path, entry]) => {
      const pathRows = rows.filter((r) => r.path === path);
      const lastViewed = pathRows.reduce((latest, row) => {
        if (!latest || row.created_at > latest) return row.created_at;
        return latest;
      }, null);
      const unique = entry.visitors.size;
      return {
        path,
        views: entry.views,
        uniqueVisitors: unique,
        avgViewsPerVisitor: unique ? Number((entry.views / unique).toFixed(2)) : entry.views,
        lastViewed,
        percentOfTotal: Number(((entry.views / total) * 100).toFixed(1)),
      };
    })
    .sort((a, b) => b.views - a.views);

  return { range, totalViews: rows.length, pages };
}

export async function getAnalyticsReferrers(req, body = {}) {
  const range = parseAnalyticsDateRange(req, body);
  const rows = await loadViewsInRange(range.startIso, range.endIso);
  const total = rows.length || 1;
  const refMap = groupCount(rows, (r) => {
    const ref = String(r.referrer || '').trim();
    if (!ref) return 'Direct / None';
    try {
      return new URL(ref).hostname || ref;
    } catch {
      return ref.slice(0, 120);
    }
  });

  const referrers = [...refMap.entries()]
    .map(([referrer, entry]) => ({
      referrer,
      views: entry.views,
      uniqueVisitors: entry.visitors.size,
      percentOfTraffic: Number(((entry.views / total) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.views - a.views);

  return { range, totalViews: rows.length, referrers };
}

export async function getAnalyticsDevices(req, body = {}) {
  const range = parseAnalyticsDateRange(req, body);
  const rows = await loadViewsInRange(range.startIso, range.endIso);
  const total = rows.length || 1;

  function breakdown(key) {
    const map = groupCount(rows, (r) => r[key] || 'Unknown');
    return [...map.entries()]
      .map(([label, entry]) => ({
        label,
        views: entry.views,
        uniqueVisitors: entry.visitors.size,
        percentOfTraffic: Number(((entry.views / total) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.views - a.views);
  }

  return {
    range,
    totalViews: rows.length,
    devices: breakdown('device_type'),
    browsers: breakdown('browser'),
    operatingSystems: breakdown('os'),
  };
}

export async function getAnalyticsDailyTraffic(req, body = {}) {
  const range = parseAnalyticsDateRange(req, body);
  const rows = await loadViewsInRange(range.startIso, range.endIso);
  return {
    range,
    totalViews: rows.length,
    daily: dailyBuckets(rows),
  };
}

export { parseUserAgent, normalizePath, isAdminPath };
