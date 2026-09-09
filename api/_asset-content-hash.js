/**
 * Content-hash cache busting for mutable local assets that keep stable filenames
 * (Car Image Manager overwrites cars/numbers in place).
 *
 * Version strings are SHA-256 prefixes of file bytes — stable until content changes.
 * Not Date.now() / random. In-memory cache keyed by path + size + mtime for speed.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripPhotoUrlQuery, withPhotoCacheBust } from './_lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const DEFAULT_HASH_LENGTH = 8;

/** @type {Map<string, { hash: string, size: number, mtimeMs: number }>} */
const hashCache = new Map();

export function resetAssetContentHashCache() {
  hashCache.clear();
}

export function isVersionableLocalAssetUrl(url) {
  const clean = stripPhotoUrlQuery(String(url || '').trim());
  return (
    clean.startsWith('/assets/images/cars/') ||
    clean.startsWith('/assets/images/numbers/')
  );
}

/**
 * Map a public site path (/assets/...) to an absolute file under public/.
 * Rejects path traversal.
 */
export function publicAssetUrlToAbsolutePath(url) {
  const clean = stripPhotoUrlQuery(String(url || '').trim());
  if (!clean.startsWith('/assets/')) return null;

  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }

  const relative = decoded.replace(/^\/+/, '');
  const absolute = path.resolve(PUBLIC_DIR, relative);
  const publicRoot = path.resolve(PUBLIC_DIR) + path.sep;
  if (absolute !== path.resolve(PUBLIC_DIR) && !absolute.startsWith(publicRoot)) {
    return null;
  }
  return absolute;
}

/**
 * Full SHA-256 hex of a public asset file, or null if missing/unreadable.
 */
export function contentHashDigestForPublicAsset(url) {
  const absolute = publicAssetUrlToAbsolutePath(url);
  if (!absolute) return null;

  let stat;
  try {
    stat = fs.statSync(absolute);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const cached = hashCache.get(absolute);
  if (
    cached &&
    cached.size === stat.size &&
    cached.mtimeMs === stat.mtimeMs
  ) {
    return cached.hash;
  }

  try {
    const buf = fs.readFileSync(absolute);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    hashCache.set(absolute, {
      hash,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
    return hash;
  } catch {
    return null;
  }
}

/** Short content version for ?v= (default 8 hex chars). */
export function contentHashVersionForPublicAsset(
  url,
  { length = DEFAULT_HASH_LENGTH } = {}
) {
  const digest = contentHashDigestForPublicAsset(url);
  if (!digest) return null;
  const n = Math.max(4, Math.min(64, Number(length) || DEFAULT_HASH_LENGTH));
  return digest.slice(0, n);
}

/**
 * Append ?v=<content-hash> for versionable local assets.
 * Non-local / missing files are returned cleaned (no fabricated version).
 */
export function withContentHashCacheBust(url, options = {}) {
  const clean = stripPhotoUrlQuery(String(url || '').trim());
  if (!clean) return '';
  if (!isVersionableLocalAssetUrl(clean)) return clean;

  const version = contentHashVersionForPublicAsset(clean, options);
  if (!version) return clean;
  return withPhotoCacheBust(clean, version);
}
