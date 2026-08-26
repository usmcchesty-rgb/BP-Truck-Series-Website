/**
 * Shared car-image resolution for driver profiles.
 * Precedence:
 * 1. Usable stored profile car_image_url / carImageUrl
 * 2. data/drivers.json carImage matched by customer id / name
 * 3. empty (caller may apply local filename probes)
 *
 * Rejects placeholder Drive links like https://drive.google.com/open
 * so they cannot block catalog/local assets.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripPhotoUrlQuery } from './_lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DRIVERS_JSON = path.join(ROOT, 'data', 'drivers.json');
const CARS_DIR = path.join(ROOT, 'public', 'assets', 'images', 'cars');

let catalogCache = null;

export function normalizeCarImageUrl(value) {
  return stripPhotoUrlQuery(String(value || '').trim());
}

/** True when a stored URL should be treated as a real car image, not a stub. */
export function isUsableCarImageUrl(value) {
  const url = normalizeCarImageUrl(value);
  if (!url) return false;
  if (/^https?:\/\/drive\.google\.com\/open\/?$/i.test(url)) return false;
  if (/^https?:\/\/drive\.google\.com\/open\?id=$/i.test(url)) return false;
  if (/drive\.google\.com\/open\/?$/i.test(url)) return false;
  return true;
}

export function isLocalCarAssetPath(value) {
  const url = normalizeCarImageUrl(value);
  return url.startsWith('/assets/images/cars/');
}

function decodeAssetBasename(url) {
  const clean = normalizeCarImageUrl(url);
  const base = clean.split('/').pop() || '';
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

export function localCarAssetExists(url) {
  if (!isLocalCarAssetPath(url)) return false;
  const fileName = decodeAssetBasename(url);
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return false;
  }
  try {
    return fs.existsSync(path.join(CARS_DIR, fileName));
  } catch {
    return false;
  }
}

/** Encode each path segment so spaces/case-sensitive names work reliably in browsers. */
export function encodePublicAssetUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;

  const hashIndex = raw.indexOf('#');
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const hash = hashIndex >= 0 ? raw.slice(hashIndex) : '';
  const qIndex = withoutHash.indexOf('?');
  const pathPart = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash;
  const query = qIndex >= 0 ? withoutHash.slice(qIndex) : '';

  const encodedPath = pathPart
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join('/');

  return `${encodedPath}${query}${hash}`;
}

/**
 * Mutable car PNGs are overwritten in place by Car Image Manager.
 * Bust browser/CDN caches with the on-disk mtime.
 */
export function withCarImageCacheBust(url) {
  const clean = normalizeCarImageUrl(url);
  if (!clean) return '';
  if (!isLocalCarAssetPath(clean)) return clean;
  if (!localCarAssetExists(clean)) return clean;

  const fileName = decodeAssetBasename(clean);
  try {
    const stat = fs.statSync(path.join(CARS_DIR, fileName));
    const version = Math.floor(Number(stat.mtimeMs) || 0);
    if (!version) return clean;
    return `${clean}?v=${version}`;
  } catch {
    return clean;
  }
}

function normalizeLookupName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readDriversCatalog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DRIVERS_JSON, 'utf8'));
    return Array.isArray(parsed) ? parsed : parsed?.drivers || [];
  } catch {
    return [];
  }
}

/**
 * @returns {{
 *   byCustomerId: Map<string, string>,
 *   byName: Map<string, string>,
 *   entries: Array<{ customerId: string, name: string, carImage: string }>
 * }}
 */
export function loadCarImageCatalog() {
  if (catalogCache) return catalogCache;

  const byCustomerId = new Map();
  const byName = new Map();
  const entries = [];

  for (const row of readDriversCatalog()) {
    const carImage = normalizeCarImageUrl(row?.carImage || row?.car_image_url || '');
    if (!carImage) continue;
    const customerId = String(row?.iracingCustomerId ?? row?.iracing_customer_id ?? '').trim();
    const name = String(row?.name || row?.iracingName || '').trim();
    entries.push({ customerId, name, carImage });
    if (customerId) byCustomerId.set(customerId, carImage);
    const key = normalizeLookupName(name);
    if (key) byName.set(key, carImage);
  }

  catalogCache = { byCustomerId, byName, entries };
  return catalogCache;
}

/** Test helper — clear memoized catalog. */
export function resetCarImageCatalogCache() {
  catalogCache = null;
}

export function lookupCatalogCarImage(driver = {}, catalog = loadCarImageCatalog()) {
  const customerId = String(
    driver.iracing_customer_id ?? driver.iracingCustomerId ?? ''
  ).trim();
  if (customerId && catalog.byCustomerId.has(customerId)) {
    return catalog.byCustomerId.get(customerId);
  }

  for (const name of [driver.display_name, driver.iracing_name, driver.name]) {
    const key = normalizeLookupName(name);
    if (key && catalog.byName.has(key)) return catalog.byName.get(key);
  }

  return '';
}

/**
 * Resolve the public car image path for a driver profile.
 * Does not invent filenames from display name when a catalog/stored path exists.
 */
export function resolveCarImageForDriver(driver = {}, catalog = loadCarImageCatalog()) {
  const stored = normalizeCarImageUrl(driver.car_image_url ?? driver.carImageUrl ?? '');

  if (isUsableCarImageUrl(stored)) {
    if (isLocalCarAssetPath(stored)) {
      if (localCarAssetExists(stored)) {
        return {
          carImageUrl: stored,
          source: 'profile',
          rejectedStoredUrl: '',
        };
      }
    } else {
      return {
        carImageUrl: stored,
        source: 'profile',
        rejectedStoredUrl: '',
      };
    }
  }

  const catalogUrl = normalizeCarImageUrl(lookupCatalogCarImage(driver, catalog));
  if (catalogUrl && (!isLocalCarAssetPath(catalogUrl) || localCarAssetExists(catalogUrl))) {
    return {
      carImageUrl: catalogUrl,
      source: 'catalog',
      rejectedStoredUrl: stored && !isUsableCarImageUrl(stored) ? stored : stored || '',
    };
  }

  return {
    carImageUrl: '',
    source: 'none',
    rejectedStoredUrl: stored || '',
  };
}

export function attachCarImage(driver = {}, catalog = loadCarImageCatalog()) {
  const resolved = resolveCarImageForDriver(driver, catalog);
  const versioned = resolved.carImageUrl
    ? withCarImageCacheBust(resolved.carImageUrl)
    : '';
  return {
    ...driver,
    car_image_url: versioned,
    carImageUrl: versioned,
    carImageSource: resolved.source,
  };
}

export function enrichDriversWithCarImages(drivers = [], catalog = loadCarImageCatalog()) {
  return (drivers || []).map((driver) => attachCarImage(driver, catalog));
}
