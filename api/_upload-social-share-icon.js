import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stripPhotoUrlQuery, supabase, withPhotoCacheBust, photoCacheVersion } from './_lib.js';
import {
  getSharePlatformDef,
  storageFilenameForPlatform,
} from './_social-share-settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const STORAGE_BUCKET = 'site-assets';
const LOCAL_DIR = 'assets/social/custom';

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do update set public = true;

create policy "Public read site assets"
on storage.objects
for select
using (bucket_id = 'site-assets');`;

function readUploadPayload(body) {
  const raw = String(body.imageBase64 || body.image || '').trim();
  if (!raw) throw new Error('No image data provided.');

  const svgMatch = raw.match(/^data:image\/svg\+xml;base64,(.+)$/i);
  if (svgMatch) {
    const buffer = Buffer.from(svgMatch[1], 'base64');
    if (!buffer.length) throw new Error('Invalid SVG data.');
    return { buffer, ext: 'svg', contentType: 'image/svg+xml' };
  }

  const pngMatch = raw.match(/^data:image\/png;base64,(.+)$/i);
  const base64 = pngMatch ? pngMatch[1] : raw.replace(/^data:image\/png;base64,/, '').trim();
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Invalid image data.');

  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trim().toLowerCase();
  const isSvg = head.startsWith('<svg') || head.includes('<svg');

  if (isSvg) {
    return { buffer, ext: 'svg', contentType: 'image/svg+xml' };
  }
  if (isPng) {
    return { buffer, ext: 'png', contentType: 'image/png' };
  }

  throw new Error('Only PNG or SVG files are supported.');
}

function publicStorageUrl(filename) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('Supabase URL is not configured.');
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURIComponent(filename)}`;
}

function isLocalDev() {
  return process.env.VERCEL_ENV !== 'production';
}

function bucketNotFoundError() {
  return {
    error: `Supabase Storage bucket '${STORAGE_BUCKET}' was not found. Create it in Supabase Storage or run the setup SQL.`,
    bucket: STORAGE_BUCKET,
    setupSql: STORAGE_SETUP_SQL,
  };
}

function isBucketNotFoundMessage(message = '') {
  return /bucket not found|bucket does not exist|invalid bucket|unknown bucket/i.test(message);
}

async function verifyStorageBucket(sb) {
  const { data, error } = await sb.storage.listBuckets();
  if (error) {
    if (isBucketNotFoundMessage(error.message)) return bucketNotFoundError();
    throw new Error(`Could not list Supabase Storage buckets: ${error.message}`);
  }
  const buckets = Array.isArray(data) ? data : [];
  if (!buckets.some((b) => b.id === STORAGE_BUCKET || b.name === STORAGE_BUCKET)) {
    return bucketNotFoundError();
  }
  return null;
}

async function removeExistingStorageObject(sb, filename) {
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove([filename]);
  if (error && !/not found|does not exist|object not found/i.test(error.message)) {
    throw new Error(`Could not remove existing icon: ${error.message}`);
  }
}

async function upsertPlatformIconSettings(sb, def, storedUrl) {
  const updatedAt = new Date().toISOString();
  const patch = {
    id: 1,
    [def.iconKey]: stripPhotoUrlQuery(storedUrl),
    [def.updatedKey]: updatedAt,
  };

  const { data, error } = await sb
    .from('site_settings')
    .upsert(patch, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw new Error(`Could not save social icon settings: ${error.message}`);
  return { settings: data, updatedAt };
}

function displayIconUrl(storedUrl, updatedAt) {
  const clean = stripPhotoUrlQuery(storedUrl);
  const version = photoCacheVersion(updatedAt);
  return version ? withPhotoCacheBust(clean, version) : clean;
}

async function saveToSupabaseStorage(sb, uploadBuffer, filename, contentType, def) {
  const bucketError = await verifyStorageBucket(sb);
  if (bucketError) {
    const err = new Error(bucketError.error);
    err.details = bucketError;
    throw err;
  }

  await removeExistingStorageObject(sb, filename);

  const { error: uploadError } = await sb.storage.from(STORAGE_BUCKET).upload(filename, uploadBuffer, {
    contentType,
    upsert: true,
    cacheControl: '60',
  });

  if (uploadError) {
    if (isBucketNotFoundMessage(uploadError.message)) {
      const bucketErr = bucketNotFoundError();
      const err = new Error(bucketErr.error);
      err.details = bucketErr;
      throw err;
    }
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const storedUrl = stripPhotoUrlQuery(publicStorageUrl(filename));
  const { updatedAt } = await upsertPlatformIconSettings(sb, def, storedUrl);

  return {
    platform: def.id,
    filename,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${filename})`,
    iconKey: def.iconKey,
    iconUrl: displayIconUrl(storedUrl, updatedAt),
    iconUrlStored: storedUrl,
    iconUpdatedAt: updatedAt,
    storage: 'supabase',
  };
}

function saveToLocalFile(uploadBuffer, filename, def) {
  const rel = `${LOCAL_DIR}/${filename}`.replace(/\\/g, '/');
  const resolved = path.join(PUBLIC_DIR, rel);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);

  const storedUrl = `/${rel}`;
  const updatedAt = new Date().toISOString();

  return {
    platform: def.id,
    filename,
    savedTo: `public/${rel}`,
    iconKey: def.iconKey,
    iconUrl: displayIconUrl(storedUrl, updatedAt),
    iconUrlStored: storedUrl,
    iconUpdatedAt: updatedAt,
    storage: 'local',
  };
}

export async function uploadSocialShareIcon(body) {
  const platformId = String(body.platform || body.platformId || '').trim();
  const def = getSharePlatformDef(platformId);
  if (!def) {
    throw new Error('Unknown social platform. Use facebook, x, instagram, link, native, or tiktok.');
  }

  const { buffer, ext, contentType } = readUploadPayload(body);
  if (buffer.length > 4 * 1024 * 1024) {
    throw new Error('File too large (max 4MB).');
  }

  const filename = storageFilenameForPlatform(def.id, ext);
  const sb = supabase();

  if (sb) {
    return saveToSupabaseStorage(sb, buffer, filename, contentType, def);
  }

  if (!isLocalDev()) {
    const err = new Error('Supabase Storage is required to upload social icons on the live site.');
    err.status = 400;
    throw err;
  }

  const result = saveToLocalFile(buffer, filename, def);
  const localSb = supabase();
  if (localSb) {
    await upsertPlatformIconSettings(localSb, def, result.iconUrlStored);
  }
  return result;
}
