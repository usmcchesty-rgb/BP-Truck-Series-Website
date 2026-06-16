import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  photoCacheVersion,
  slugify,
  stripPhotoUrlQuery,
  supabase,
  withPhotoCacheBust,
} from './_lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const STORAGE_BUCKET = 'site-assets';
const STORAGE_PREFIX = 'news/spotlights';

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do update set public = true;

create policy "Public read site assets"
on storage.objects
for select
using (bucket_id = 'site-assets');`;

function readUploadBuffer(body) {
  const raw = body.imageBase64 || body.image || '';
  const base64 = String(raw).replace(/^data:image\/png;base64,/, '').trim();
  if (!base64) {
    throw new Error('No PNG image data provided.');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('Invalid image data.');
  }
  return buffer;
}

function resolveStorageKey(body) {
  const articleId = Number(body.articleId ?? body.article_id ?? body.id);
  if (Number.isInteger(articleId) && articleId > 0) {
    return `article-${articleId}`;
  }

  const draftKey = String(body.draftKey ?? body.draft_key ?? '').trim();
  if (draftKey) {
    const safe = slugify(draftKey.replace(/^draft-/, '')) || 'draft';
    return `draft-${safe}`.slice(0, 80);
  }

  return `draft-${Date.now()}`;
}

function storageFilename(storageKey) {
  return `${STORAGE_PREFIX}/${storageKey}.png`;
}

function publicStorageUrl(filename) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('Supabase URL is not configured.');
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${filename
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
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
  return /bucket not found|bucket does not exist|invalid bucket|unknown bucket/i.test(
    message
  );
}

async function verifyStorageBucket(sb) {
  const { data, error } = await sb.storage.listBuckets();
  if (error) {
    if (isBucketNotFoundMessage(error.message)) {
      return bucketNotFoundError();
    }
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
    throw new Error(`Could not remove existing spotlight image: ${error.message}`);
  }
}

async function saveToSupabaseStorage(sb, uploadBuffer, storageKey) {
  const bucketError = await verifyStorageBucket(sb);
  if (bucketError) {
    const err = new Error(bucketError.error);
    err.details = bucketError;
    throw err;
  }

  const filename = storageFilename(storageKey);
  await removeExistingStorageObject(sb, filename);

  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(filename, uploadBuffer, {
      contentType: 'image/png',
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

  const updatedAt = new Date().toISOString();
  const storedUrl = stripPhotoUrlQuery(publicStorageUrl(filename));
  const displayUrl = withPhotoCacheBust(storedUrl, photoCacheVersion(updatedAt));

  return {
    storageKey,
    filename: path.basename(filename),
    storagePath: `${STORAGE_BUCKET}/${filename}`,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${filename})`,
    spotlightImageUrl: displayUrl,
    spotlightImageUrlStored: storedUrl,
    spotlightImageUpdatedAt: updatedAt,
    cacheVersion: photoCacheVersion(updatedAt),
    storage: 'supabase',
  };
}

function saveToLocalFile(uploadBuffer, storageKey) {
  const rel = `${STORAGE_PREFIX}/${storageKey}.png`.replace(/\\/g, '/');
  const resolved = path.join(PUBLIC_DIR, 'assets', rel);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);

  const storedUrl = `/assets/${rel}`;
  const updatedAt = new Date().toISOString();
  const displayUrl = withPhotoCacheBust(storedUrl, photoCacheVersion(updatedAt));

  return {
    storageKey,
    filename: `${storageKey}.png`,
    storagePath: `public/assets/${rel}`,
    savedTo: `public/assets/${rel}`,
    spotlightImageUrl: displayUrl,
    spotlightImageUrlStored: storedUrl,
    spotlightImageUpdatedAt: updatedAt,
    cacheVersion: photoCacheVersion(updatedAt),
    storage: 'local',
  };
}

export async function uploadSpotlightImage(body) {
  const uploadBuffer = readUploadBuffer(body);
  const storageKey = resolveStorageKey(body);

  if (uploadBuffer.length > 8 * 1024 * 1024) {
    throw new Error('File too large (max 8MB).');
  }

  const isPng =
    uploadBuffer.length >= 8 &&
    uploadBuffer[0] === 0x89 &&
    uploadBuffer[1] === 0x50 &&
    uploadBuffer[2] === 0x4e &&
    uploadBuffer[3] === 0x47;
  if (!isPng) {
    throw new Error('Only PNG files are supported.');
  }

  const sb = supabase();
  if (sb) {
    return saveToSupabaseStorage(sb, uploadBuffer, storageKey);
  }

  if (!isLocalDev()) {
    const err = new Error(
      'Supabase Storage is required to upload spotlight images on the live site.'
    );
    err.status = 400;
    throw err;
  }

  return saveToLocalFile(uploadBuffer, storageKey);
}

export async function removeSpotlightImage(body) {
  const articleId = Number(body.articleId ?? body.article_id ?? body.id);
  const draftKey = String(body.draftKey ?? body.draft_key ?? '').trim();
  const storageKey =
    Number.isInteger(articleId) && articleId > 0
      ? `article-${articleId}`
      : draftKey
        ? `draft-${slugify(draftKey.replace(/^draft-/, '')) || 'draft'}`.slice(0, 80)
        : null;

  if (storageKey) {
    const filename = storageFilename(storageKey);
    const sb = supabase();
    if (sb) {
      await removeExistingStorageObject(sb, filename);
    } else if (isLocalDev()) {
      const rel = `${STORAGE_PREFIX}/${storageKey}.png`.replace(/\\/g, '/');
      const resolved = path.join(PUBLIC_DIR, 'assets', rel);
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    }
  }

  if (Number.isInteger(articleId) && articleId > 0) {
    const sb = supabase();
    if (sb) {
      const { error } = await sb
        .from('news_articles')
        .update({
          spotlight_image_url: '',
          spotlight_image_updated_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', articleId);
      if (error) {
        throw new Error(`Could not clear spotlight image from article: ${error.message}`);
      }
    }
  }

  return {
    removed: true,
    spotlightImageUrl: '',
    spotlightImageUrlStored: '',
    spotlightImageUpdatedAt: null,
  };
}
