import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { photoCacheVersion, stripPhotoUrlQuery, supabase, withPhotoCacheBust } from './_lib.js';
import {
  NUMBER_ARTWORK_CANVAS_HEIGHT,
  NUMBER_ARTWORK_CANVAS_WIDTH,
  normalizeCustomerId,
  normalizeNumberArtworkPixels,
} from '../public/number-artwork-logic.js';
import {
  loadNumberArtworkOverrides,
  publicNumberArtworkUrl,
  saveNumberArtworkOverrides,
  STORAGE_BUCKET,
} from './_number-artwork-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOCAL_DIR = path.join(PUBLIC_DIR, 'assets', 'images', 'numbers', 'custom');

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do update set public = true;

create policy "Public read site assets"
on storage.objects
for select
using (bucket_id = 'site-assets');`;

function readUploadBuffer(body) {
  const raw = body.imageBase64 || body.image || '';
  const base64 = String(raw).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
  if (!base64) {
    throw new Error('No image data provided.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('Invalid image data.');
  }
  return buffer;
}

function isLocalDev() {
  return process.env.VERCEL_ENV !== 'production';
}

function getSupabaseConfigError() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!missing.length) return null;
  return {
    error: 'Supabase is not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
    missingEnv: missing,
  };
}

function bucketError(message) {
  const err = new Error(message);
  err.status = 400;
  err.details = {
    error: message,
    bucket: STORAGE_BUCKET,
    setupSql: STORAGE_SETUP_SQL,
  };
  return err;
}

function customObjectPath(customerId) {
  return `number-artwork/${customerId}.png`;
}

function localCustomRel(customerId) {
  return `assets/images/numbers/custom/${customerId}.png`;
}

async function normalizeUploadPng(buffer, options = {}) {
  const decoded = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data, info } = decoded;
  const normalized = normalizeNumberArtworkPixels(data, info.width, info.height, {
    mode: options.backgroundMode || 'auto',
    tolerance: options.tolerance,
  });
  const png = await sharp(Buffer.from(normalized.data), {
    raw: {
      width: NUMBER_ARTWORK_CANVAS_WIDTH,
      height: NUMBER_ARTWORK_CANVAS_HEIGHT,
      channels: 4,
    },
  })
    .png()
    .toBuffer();

  return {
    png,
    meta: {
      original: normalized.original,
      detectedBounds: normalized.detectedBounds,
      resultBounds: normalized.resultBounds,
      background: normalized.background,
      canvas: {
        width: NUMBER_ARTWORK_CANVAS_WIDTH,
        height: NUMBER_ARTWORK_CANVAS_HEIGHT,
      },
    },
  };
}

async function uploadToSupabase(sb, objectPath, png) {
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(objectPath, png, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) {
    if (/bucket not found|does not exist/i.test(error.message || '')) {
      throw bucketError(error.message);
    }
    throw new Error(`Could not save number artwork: ${error.message}`);
  }
}

export async function previewDriverNumberArtwork(body = {}) {
  const buffer = readUploadBuffer(body);
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error('File too large (max 8MB).');
  }
  const { png, meta } = await normalizeUploadPng(buffer, body);
  return {
    previewDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    ...meta,
  };
}

export async function uploadDriverNumberArtwork(body = {}) {
  const customerId = normalizeCustomerId(body.iracingCustomerId || body.iracing_customer_id || body.customerId);
  if (!customerId) {
    throw new Error('iRacing customer ID is required to save custom number artwork.');
  }
  const buffer = readUploadBuffer(body);
  if (buffer.length > 8 * 1024 * 1024) {
    throw new Error('File too large (max 8MB).');
  }

  const alreadyNormalized = body.alreadyNormalized === true;
  let png = buffer;
  let meta = {
    canvas: { width: NUMBER_ARTWORK_CANVAS_WIDTH, height: NUMBER_ARTWORK_CANVAS_HEIGHT },
  };
  if (!alreadyNormalized) {
    const processed = await normalizeUploadPng(buffer, body);
    png = processed.png;
    meta = processed.meta;
  } else {
    const info = await sharp(buffer).metadata();
    if (info.width !== NUMBER_ARTWORK_CANVAS_WIDTH || info.height !== NUMBER_ARTWORK_CANVAS_HEIGHT) {
      const processed = await normalizeUploadPng(buffer, body);
      png = processed.png;
      meta = processed.meta;
    }
  }

  const updatedAt = new Date().toISOString();
  const overrideRecord = {
    customPath: null,
    preferredSource: 'custom',
    source: 'custom_upload',
    updatedAt,
    driverId: body.driver_id || body.driverId || '',
    carNumber: String(body.car_number || body.carNumber || '').trim(),
  };

  const sb = supabase();
  const configError = getSupabaseConfigError();

  if (!sb || configError) {
    if (!isLocalDev()) {
      throw new Error(configError?.error || 'Supabase is not configured.');
    }
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const rel = localCustomRel(customerId);
    fs.writeFileSync(path.join(PUBLIC_DIR, rel), png);
    const storedUrl = `/${rel.replace(/\\/g, '/')}`;
    overrideRecord.customPath = storedUrl;
    const overrides = await loadNumberArtworkOverrides(null);
    overrides[customerId] = overrideRecord;
    await saveNumberArtworkOverrides(overrides, null);
    return {
      storage: 'local',
      customerId,
      customPath: storedUrl,
      publicUrl: withPhotoCacheBust(storedUrl, photoCacheVersion(updatedAt)),
      savedTo: `public/${rel}`,
      preferredSource: 'custom',
      updatedAt,
      ...meta,
    };
  }

  const objectPath = customObjectPath(customerId);
  await uploadToSupabase(sb, objectPath, png);
  const storedUrl = publicNumberArtworkUrl(objectPath);
  overrideRecord.customPath = storedUrl;
  const overrides = await loadNumberArtworkOverrides(sb);
  overrides[customerId] = overrideRecord;
  await saveNumberArtworkOverrides(overrides, sb);

  return {
    storage: 'supabase',
    customerId,
    customPath: storedUrl,
    publicUrl: withPhotoCacheBust(stripPhotoUrlQuery(storedUrl), photoCacheVersion(updatedAt)),
    preferredSource: 'custom',
    updatedAt,
    ...meta,
  };
}

export async function removeDriverNumberArtwork(body = {}) {
  const customerId = normalizeCustomerId(body.iracingCustomerId || body.iracing_customer_id || body.customerId);
  if (!customerId) {
    throw new Error('iRacing customer ID is required to remove custom number artwork.');
  }

  const sb = supabase();
  if (!sb || getSupabaseConfigError()) {
    if (!isLocalDev()) {
      throw new Error('Supabase is not configured.');
    }
    const localPath = path.join(PUBLIC_DIR, localCustomRel(customerId));
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
    const overrides = await loadNumberArtworkOverrides(null);
    delete overrides[customerId];
    await saveNumberArtworkOverrides(overrides, null);
    return {
      storage: 'local',
      customerId,
      customPath: null,
      preferredSource: 'sdk',
      removed: true,
    };
  }

  await sb.storage.from(STORAGE_BUCKET).remove([customObjectPath(customerId)]);
  const overrides = await loadNumberArtworkOverrides(sb);
  delete overrides[customerId];
  await saveNumberArtworkOverrides(overrides, sb);

  return {
    storage: 'supabase',
    customerId,
    customPath: null,
    preferredSource: 'sdk',
    removed: true,
  };
}
