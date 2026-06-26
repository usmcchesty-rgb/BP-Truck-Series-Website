const DEFAULT_SHARE_IMAGE = '/assets/logos/New Clean Logo.png';
const SITE_NAME = 'Blazing Pedals Truck Series';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getSiteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

export function absoluteShareUrl(origin, pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return origin;
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return `${origin}${encodeURI(path)}`;
}

export function buildSharePreviewHtml({
  title,
  description,
  image,
  url,
  redirectUrl,
  type = 'article',
  origin,
}) {
  const safeTitle = escapeHtml(title || SITE_NAME);
  const safeDescription = escapeHtml(description || '');
  const pageUrl = absoluteShareUrl(origin, url);
  const imageUrl = absoluteShareUrl(origin, image || DEFAULT_SHARE_IMAGE);
  const canonical = absoluteShareUrl(origin, redirectUrl || url);
  const ogType = escapeHtml(type || 'website');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}" />
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:type" content="${ogType}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(canonical)}" />
</head>
<body>
  <p><a href="${escapeHtml(canonical)}">${safeTitle}</a></p>
</body>
</html>`;
}

export function buildShareNotFoundHtml({ title, description, url, redirectUrl, origin }) {
  return buildSharePreviewHtml({
    title: title || `Article Not Found — ${SITE_NAME}`,
    description: description || 'The requested news article could not be found.',
    image: DEFAULT_SHARE_IMAGE,
    url: url || '/news',
    redirectUrl: redirectUrl || '/news',
    type: 'website',
    origin,
  });
}

export { DEFAULT_SHARE_IMAGE, SITE_NAME };
