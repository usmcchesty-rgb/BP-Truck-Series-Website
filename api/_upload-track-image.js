import fs from "fs";
import { supabase, withPhotoCacheBust } from "./_lib.js";
import {
  ensureTracksDir,
  resolveTrackOutputPath,
  safeFilename,
} from "../server/track-upload-shared.mjs";
import {
  recordTrackImageVersion,
  trackSlugFromFilename,
} from "./_track-image-versions.js";

export const STORAGE_BUCKET = "track-images";
export const STORAGE_PATH_PREFIX = "tracks";

export const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('track-images', 'track-images', true)
on conflict (id) do update set public = true;

create policy "Public read track images"
on storage.objects
for select
using (bucket_id = 'track-images');`;

function getSupabaseConfigError() {
  const missing = [];
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!missing.length) return null;
  return {
    error:
      "Supabase is not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    missingEnv: missing,
  };
}

function isLocalDev() {
  return process.env.VERCEL_ENV !== "production";
}

function isBucketNotFoundMessage(message = "") {
  return /bucket not found|bucket does not exist|invalid bucket|unknown bucket/i.test(
    message,
  );
}

function bucketNotFoundError() {
  return {
    error: `Supabase Storage bucket '${STORAGE_BUCKET}' was not found. Create it in Supabase Storage or run supabase/track_images_bucket_migration.sql.`,
    bucket: STORAGE_BUCKET,
    setupSql: STORAGE_SETUP_SQL,
  };
}

export function storageObjectPath(filename) {
  const safe = safeFilename(filename);
  return `${STORAGE_PATH_PREFIX}/${safe}`;
}

export function publicStorageUrl(filename) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Supabase URL is not configured.");
  const objectPath = storageObjectPath(filename);
  const encoded = objectPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encoded}`;
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
  const found = buckets.some(
    (bucket) => bucket.name === STORAGE_BUCKET || bucket.id === STORAGE_BUCKET,
  );
  if (!found) {
    return bucketNotFoundError();
  }
  return null;
}

async function assertSupabaseReady(sb) {
  const configError = getSupabaseConfigError();
  if (configError) return configError;
  if (!sb) return getSupabaseConfigError();
  return verifyStorageBucket(sb);
}

async function removeExistingStorageObject(sb, objectPath) {
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove([objectPath]);
  if (error && !/not found|does not exist|object not found/i.test(error.message)) {
    console.warn("[upload-track-image] remove before upload:", error.message);
  }
}

function trackSlugFromStorageName(name) {
  return String(name || "")
    .replace(/\.png$/i, "")
    .trim()
    .toLowerCase();
}

async function removeConflictingTrackObjects(sb, canonicalFilename) {
  const canonicalPath = storageObjectPath(canonicalFilename);
  const slug = trackSlugFromStorageName(canonicalFilename);
  const { data: files, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .list(STORAGE_PATH_PREFIX, { limit: 500 });
  if (error || !Array.isArray(files)) return;

  const pathsToRemove = [];
  for (const file of files) {
    if (!file?.name || !/\.png$/i.test(file.name)) continue;
    const path = `${STORAGE_PATH_PREFIX}/${file.name}`;
    if (path === canonicalPath) continue;
    if (trackSlugFromStorageName(file.name) === slug) {
      pathsToRemove.push(path);
    }
  }

  if (pathsToRemove.length) {
    const { error: removeError } = await sb.storage
      .from(STORAGE_BUCKET)
      .remove(pathsToRemove);
    if (removeError) {
      console.warn(
        "[upload-track-image] remove conflicting objects:",
        removeError.message,
      );
    }
  }
}

async function saveToSupabaseStorage(sb, uploadBuffer, filename) {
  const safe = safeFilename(filename);
  const objectPath = storageObjectPath(safe);

  await removeConflictingTrackObjects(sb, safe);
  await removeExistingStorageObject(sb, objectPath);

  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, uploadBuffer, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    if (isBucketNotFoundMessage(uploadError.message)) {
      const bucketError = bucketNotFoundError();
      const err = new Error(bucketError.error);
      err.details = bucketError;
      throw err;
    }
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const cacheVersion = await recordTrackImageVersion(safe);
  const publicUrlStored = publicStorageUrl(safe);
  const publicUrl = withPhotoCacheBust(publicUrlStored, cacheVersion);

  return {
    success: true,
    replaced: true,
    filename: safe,
    trackSlug: trackSlugFromFilename(safe),
    storagePath: objectPath,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${objectPath})`,
    publicUrl,
    publicUrlStored,
    cacheVersion,
    storage: "supabase",
  };
}

function saveToLocalFile(uploadBuffer, filename) {
  const safe = safeFilename(filename);
  ensureTracksDir();
  const outputPath = resolveTrackOutputPath(safe);
  fs.writeFileSync(outputPath, uploadBuffer);
  const cacheVersion = Date.now();
  const publicUrlStored = `/assets/tracks/${safe}`;
  return {
    success: true,
    replaced: true,
    filename: safe,
    trackSlug: trackSlugFromFilename(safe),
    storagePath: `public/assets/tracks/${safe}`,
    savedTo: `public/assets/tracks/${safe}`,
    publicUrl: withPhotoCacheBust(publicUrlStored, cacheVersion),
    publicUrlStored,
    cacheVersion,
    storage: "local",
  };
}

export async function saveTrackImage(processedBuffer, filename) {
  const safe = safeFilename(filename);
  const sb = supabase();

  if (sb) {
    const readyError = await assertSupabaseReady(sb);
    if (!readyError) {
      return saveToSupabaseStorage(sb, processedBuffer, safe);
    }
    if (!isLocalDev()) {
      const err = new Error(readyError.error);
      err.status = 400;
      err.details = readyError;
      throw err;
    }
  }

  if (!isLocalDev()) {
    const configError = getSupabaseConfigError();
    const err = new Error(
      configError?.error ||
        "Supabase Storage is required to save track images on the live site.",
    );
    err.status = 400;
    err.details = configError || {
      setupSql: STORAGE_SETUP_SQL,
      bucket: STORAGE_BUCKET,
    };
    throw err;
  }

  return saveToLocalFile(processedBuffer, safe);
}
