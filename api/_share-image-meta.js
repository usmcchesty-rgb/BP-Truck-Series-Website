import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIN_OG_WIDTH = 200;
const MIN_OG_HEIGHT = 200;
const DEFAULT_FALLBACK = '/assets/logos/New Clean Logo.png';
const FALLBACK_WIDTH = 1265;
const FALLBACK_HEIGHT = 230;

function mimeFromFormat(format) {
  const map = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  };
  return map[String(format || '').toLowerCase()] || '';
}

function guessMimeFromUrl(url) {
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.jpe?g(\?|$)/i.test(url)) return 'image/jpeg';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
  return 'image/png';
}

function toAbsoluteImageUrl(image, origin) {
  const raw = String(image || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(origin || '').replace(/\/$/, '');
  const pathPart = raw.startsWith('/') ? raw : `/${raw}`;
  return base ? `${base}${encodeURI(pathPart)}` : pathPart;
}

async function loadImageBuffer(image, origin) {
  const raw = String(image || '').trim();
  if (!raw) return null;

  if (raw.startsWith('/')) {
    const filePath = path.join(PUBLIC_DIR, raw.replace(/^\//, '').split('?')[0]);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
    return null;
  }

  const fetchUrl = /^https?:\/\//i.test(raw) ? raw : toAbsoluteImageUrl(raw, origin);
  if (!fetchUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(fetchUrl, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType && !contentType.startsWith('image/')) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeImage(image, origin) {
  const buffer = await loadImageBuffer(image, origin);
  if (!buffer?.length) return null;

  const meta = await sharp(buffer).metadata();
  const width = Number(meta.width) || 0;
  const height = Number(meta.height) || 0;
  if (width < MIN_OG_WIDTH || height < MIN_OG_HEIGHT) return null;

  const url = toAbsoluteImageUrl(image, origin);
  const type = mimeFromFormat(meta.format) || guessMimeFromUrl(url);

  return {
    url,
    secureUrl: url.startsWith('https://') ? url : '',
    width,
    height,
    type,
  };
}

export async function resolveOgImageMeta({ image, origin, alt = '' }) {
  const safeAlt = String(alt || '').trim();
  const candidates = [image, DEFAULT_FALLBACK].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const probed = await probeImage(candidate, origin);
      if (!probed) continue;
      return { ...probed, alt: safeAlt };
    } catch {
      /* try next candidate */
    }
  }

  const fallbackUrl = toAbsoluteImageUrl(DEFAULT_FALLBACK, origin);
  return {
    url: fallbackUrl,
    secureUrl: fallbackUrl.startsWith('https://') ? fallbackUrl : '',
    width: FALLBACK_WIDTH,
    height: FALLBACK_HEIGHT,
    type: 'image/png',
    alt: safeAlt,
  };
}

export { DEFAULT_FALLBACK as DEFAULT_SHARE_FALLBACK_IMAGE };
