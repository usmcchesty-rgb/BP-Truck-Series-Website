import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase, stripPhotoUrlQuery, withPhotoCacheBust, photoCacheVersion } from './_lib.js';
import {
  indexNumberArtworkCatalog,
  normalizeCustomerId,
  resolveNumberArtworkForDriver,
} from '../public/number-artwork-logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DRIVERS_JSON = path.join(ROOT, 'data', 'drivers.json');
const STORAGE_BUCKET = 'site-assets';
const OVERRIDES_OBJECT = 'number-artwork/overrides.json';
const LOCAL_OVERRIDES_PATH = path.join(
  ROOT,
  'public',
  'assets',
  'images',
  'numbers',
  'custom',
  'overrides.json',
);

let catalogCache = null;

export function loadNumberArtworkCatalog() {
  if (catalogCache) return catalogCache;
  try {
    const raw = fs.readFileSync(DRIVERS_JSON, 'utf8');
    catalogCache = indexNumberArtworkCatalog(JSON.parse(raw));
  } catch {
    catalogCache = indexNumberArtworkCatalog({ drivers: [] });
  }
  return catalogCache;
}

export function publicNumberArtworkUrl(filename) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return '';
  const objectPath = String(filename || '').replace(/^\/+/, '');
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
}

function loadLocalNumberArtworkOverrides() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_OVERRIDES_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocalNumberArtworkOverrides(overrides) {
  fs.mkdirSync(path.dirname(LOCAL_OVERRIDES_PATH), { recursive: true });
  fs.writeFileSync(LOCAL_OVERRIDES_PATH, JSON.stringify(overrides || {}, null, 2));
  return overrides;
}

export async function loadNumberArtworkOverrides(sb = supabase()) {
  if (sb) {
    const { data, error } = await sb.storage.from(STORAGE_BUCKET).download(OVERRIDES_OBJECT);
    if (!error && data) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        /* fall through to local */
      }
    }
  }
  return loadLocalNumberArtworkOverrides();
}

export async function saveNumberArtworkOverrides(overrides, sb = supabase()) {
  if (sb) {
    const body = JSON.stringify(overrides || {}, null, 2);
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(OVERRIDES_OBJECT, body, {
      contentType: 'application/json',
      upsert: true,
    });
    if (error) {
      throw new Error(`Could not save number artwork overrides: ${error.message}`);
    }
    return overrides;
  }
  return saveLocalNumberArtworkOverrides(overrides);
}

export function attachNumberArtwork(driver = {}, catalog = loadNumberArtworkCatalog(), overrides = {}) {
  const resolved = resolveNumberArtworkForDriver(driver, catalog, overrides);
  const stored = stripPhotoUrlQuery(resolved.imagePath);
  const updatedAt = resolved.customerId ? overrides[resolved.customerId]?.updatedAt : null;
  const imageUrl = stored
    ? updatedAt
      ? withPhotoCacheBust(stored, photoCacheVersion(updatedAt))
      : stored
    : '';
  return {
    ...resolved,
    imagePath: stored,
    imageUrl,
  };
}

export function enrichDriverWithNumberArtwork(driver = {}, catalog, overrides) {
  const numberArtwork = attachNumberArtwork(driver, catalog, overrides);
  const customerId = numberArtwork.customerId || normalizeCustomerId(driver.iracing_customer_id || driver.iracingCustomerId);
  return {
    ...driver,
    iracingCustomerId: customerId || driver.iracingCustomerId || driver.iracing_customer_id || '',
    iracing_customer_id: customerId || driver.iracing_customer_id || driver.iracingCustomerId || '',
    numberArtwork,
  };
}

export async function enrichDriversWithNumberArtwork(drivers = []) {
  const catalog = loadNumberArtworkCatalog();
  const overrides = await loadNumberArtworkOverrides();
  return (Array.isArray(drivers) ? drivers : []).map((driver) =>
    enrichDriverWithNumberArtwork(driver, catalog, overrides),
  );
}

export { STORAGE_BUCKET, OVERRIDES_OBJECT };
