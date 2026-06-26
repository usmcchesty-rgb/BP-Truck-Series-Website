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

function buildOgImageTags(imageUrl, imageMeta = {}) {
  const safeImageUrl = escapeHtml(imageUrl);
  const width = Number(imageMeta.width) || 0;
  const height = Number(imageMeta.height) || 0;
  const type = String(imageMeta.type || '').trim();
  const alt = String(imageMeta.alt || '').trim();
  const secureUrl = String(imageMeta.secureUrl || '').trim() || (imageUrl.startsWith('https://') ? imageUrl : '');

  let tags = `  <meta property="og:image" content="${safeImageUrl}" />\n`;
  if (secureUrl) {
    tags += `  <meta property="og:image:secure_url" content="${escapeHtml(secureUrl)}" />\n`;
  }
  if (type) {
    tags += `  <meta property="og:image:type" content="${escapeHtml(type)}" />\n`;
  }
  if (width > 0) {
    tags += `  <meta property="og:image:width" content="${width}" />\n`;
  }
  if (height > 0) {
    tags += `  <meta property="og:image:height" content="${height}" />\n`;
  }
  if (alt) {
    tags += `  <meta property="og:image:alt" content="${escapeHtml(alt)}" />\n`;
  }
  return tags;
}

export function buildSharePreviewHtml({
  title,
  description,
  image,
  imageMeta = null,
  url,
  redirectUrl,
  type = 'article',
  origin,
  linkLabel = 'View Article',
}) {
  const safeTitle = escapeHtml(title || SITE_NAME);
  const safeDescription = escapeHtml(description || '');
  const pageUrl = absoluteShareUrl(origin, url);
  const imageUrl = absoluteShareUrl(origin, imageMeta?.url || image || DEFAULT_SHARE_IMAGE);
  const canonical = absoluteShareUrl(origin, redirectUrl || url);
  const ogType = escapeHtml(type || 'website');
  const safeLinkLabel = escapeHtml(linkLabel || 'View Article');
  const resolvedImageMeta = {
    ...(imageMeta || {}),
    url: imageUrl,
    secureUrl: imageMeta?.secureUrl || (imageUrl.startsWith('https://') ? imageUrl : ''),
    alt: imageMeta?.alt || title || SITE_NAME,
  };
  const ogImageTags = buildOgImageTags(imageUrl, resolvedImageMeta);

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
${ogImageTags}  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:type" content="${ogType}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
</head>
<body>
  <h1>${safeTitle}</h1>
  <p>${safeDescription}</p>
  <p><a href="${escapeHtml(canonical)}">${safeLinkLabel}</a></p>
</body>
</html>`;
}

export function buildShareNotFoundHtml({ title, description, url, redirectUrl, origin, linkLabel = 'View News' }) {
  return buildSharePreviewHtml({
    title: title || `Article Not Found — ${SITE_NAME}`,
    description: description || 'The requested news article could not be found.',
    image: DEFAULT_SHARE_IMAGE,
    imageMeta: {
      url: absoluteShareUrl(origin, DEFAULT_SHARE_IMAGE),
      secureUrl: absoluteShareUrl(origin, DEFAULT_SHARE_IMAGE).startsWith('https://')
        ? absoluteShareUrl(origin, DEFAULT_SHARE_IMAGE)
        : '',
      width: 1265,
      height: 230,
      type: 'image/png',
      alt: title || `Article Not Found — ${SITE_NAME}`,
    },
    url: url || '/news',
    redirectUrl: redirectUrl || '/news',
    type: 'website',
    origin,
    linkLabel,
  });
}

export { DEFAULT_SHARE_IMAGE, SITE_NAME };
