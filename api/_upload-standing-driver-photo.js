import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  photoCacheVersion,
  slugify,
  stripPhotoUrlQuery,
  supabase,
  withPhotoCacheBust,
} from "./_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const STORAGE_BUCKET = "driver-standing-photos";
const LOCAL_REL_DIR = "assets/driver-standing-photos";

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('driver-standing-photos', 'driver-standing-photos', true)
on conflict (id) do update set public = true;

create policy "Public read driver standing photos"
on storage.objects
for select
using (bucket_id = 'driver-standing-photos');`;

function readUploadBuffer(body) {
  const raw = body.imageBase64 || body.image || "";
  const base64 = String(raw).replace(/^data:image\/png;base64,/, "").trim();
  if (!base64) {
    throw new Error("No PNG image data provided.");
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new Error("Invalid image data.");
  }
  return buffer;
}

function clampZoom(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(3, Math.max(0.25, n));
}

function clampAxis(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
}

function resolveStandingFilename(body) {
  const id = String(body.driver_id || "").trim();
  const slug = slugify(body.display_name || body.iracing_name || id);
  const base = slug || id;
  if (!base) {
    throw new Error("Missing driver_id.");
  }
  return `${base}.png`;
}

function publicStorageUrl(filename) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Supabase URL is not configured.");
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURIComponent(filename)}`;
}

function isLocalDev() {
  return process.env.VERCEL_ENV !== "production";
}

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

function bucketNotFoundError() {
  return {
    error: `Supabase Storage bucket '${STORAGE_BUCKET}' was not found. Create it in Supabase Storage or run the setup SQL.`,
    bucket: STORAGE_BUCKET,
    setupSql: STORAGE_SETUP_SQL,
  };
}

function isBucketNotFoundMessage(message = "") {
  return /bucket not found|bucket does not exist|invalid bucket|unknown bucket/i.test(
    message,
  );
}

function isStorageObjectMissingMessage(message = "") {
  return /not found|does not exist|object not found/i.test(message);
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
  if (!sb) {
    return getSupabaseConfigError();
  }
  return verifyStorageBucket(sb);
}

function resolveLocalOutputPath(filename) {
  const rel = `${LOCAL_REL_DIR}/${filename}`.replace(/^\/+/, "");
  const resolved = path.resolve(path.join(PUBLIC_DIR, rel));
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    throw new Error("Invalid save path.");
  }
  return { resolved, rel };
}

async function upsertStandingPhotoProfile(sb, driverId, publicUrl, body) {
  const id = String(driverId);
  const { data: existing, error: readError } = await sb
    .from("driver_profiles")
    .select("*")
    .eq("driver_id", id)
    .maybeSingle();

  if (readError) {
    throw new Error(`Supabase error: ${readError.message}`);
  }

  const displayName =
    existing?.display_name || body.display_name || body.iracing_name || "";
  const iracingName =
    existing?.iracing_name || body.iracing_name || displayName || "";
  const carNumber = existing?.car_number ?? body.car_number ?? "";

  if (!iracingName) {
    throw new Error(
      "Missing driver profile. Open Admin > Drivers and save this driver once before uploading a standing photo.",
    );
  }

  const now = new Date().toISOString();
  const row = {
    driver_id: id,
    iracing_name: iracingName,
    display_name: displayName || iracingName,
    driver_name: displayName || iracingName,
    slug: slugify(displayName || iracingName || id),
    car_number: carNumber,
    truck_number: carNumber,
    photo_url: stripPhotoUrlQuery(existing?.photo_url || ""),
    standing_photo_url: stripPhotoUrlQuery(publicUrl),
    standing_photo_zoom: clampZoom(
      body.standingPhotoZoom ?? body.standing_photo_zoom ?? existing?.standing_photo_zoom,
    ),
    standing_photo_x: clampAxis(
      body.standingPhotoX ?? body.standing_photo_x ?? existing?.standing_photo_x,
    ),
    standing_photo_y: clampAxis(
      body.standingPhotoY ?? body.standing_photo_y ?? existing?.standing_photo_y,
    ),
    standing_photo_updated_at: now,
    is_streamer: existing?.is_streamer === true,
    stream_url: String(existing?.stream_url || "").trim(),
    active: existing?.active !== false,
    updated_at: now,
  };

  const { data, error } = await sb
    .from("driver_profiles")
    .upsert(row, { onConflict: "driver_id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase error: ${error.message}`);
  }

  return data;
}

async function removeExistingStorageObject(sb, filename) {
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove([filename]);
  if (error && !isStorageObjectMissingMessage(error.message)) {
    console.warn("[upload-standing-driver-photo] remove before upload:", error.message);
  }
}

async function saveToSupabaseStorage(sb, uploadBuffer, filename, driverId, body) {
  await removeExistingStorageObject(sb, filename);

  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(filename, uploadBuffer, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "60",
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

  const storedUrl = stripPhotoUrlQuery(publicStorageUrl(filename));
  const profile = await upsertStandingPhotoProfile(sb, driverId, storedUrl, body);
  const cacheVersion =
    photoCacheVersion(profile?.standing_photo_updated_at) || Date.now();
  const displayUrl = withPhotoCacheBust(storedUrl, cacheVersion);

  return {
    filename,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${filename})`,
    standingPhotoUrl: displayUrl,
    standingPhotoUrlStored: storedUrl,
    standingPhotoZoom: profile?.standing_photo_zoom ?? 1,
    standingPhotoX: profile?.standing_photo_x ?? 50,
    standingPhotoY: profile?.standing_photo_y ?? 50,
    cacheVersion,
    updatedAt: profile?.standing_photo_updated_at || null,
    profileUpdated: true,
    storage: "supabase",
  };
}

function saveToLocalFile(uploadBuffer, filename, body) {
  const { resolved, rel } = resolveLocalOutputPath(filename);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);
  const storedUrl = `/${rel.replace(/^\/+/, "")}`;
  const cacheVersion = Date.now();
  const displayUrl = withPhotoCacheBust(storedUrl, cacheVersion);
  return {
    filename,
    savedTo: `public/${rel}`,
    standingPhotoUrl: displayUrl,
    standingPhotoUrlStored: storedUrl,
    standingPhotoZoom: clampZoom(body.standingPhotoZoom ?? body.standing_photo_zoom),
    standingPhotoX: clampAxis(body.standingPhotoX ?? body.standing_photo_x),
    standingPhotoY: clampAxis(body.standingPhotoY ?? body.standing_photo_y),
    cacheVersion,
    updatedAt: new Date(cacheVersion).toISOString(),
    profileUpdated: false,
    storage: "local",
  };
}

export async function uploadStandingDriverPhoto(body) {
  const uploadBuffer = readUploadBuffer(body);

  if (uploadBuffer.length > 15 * 1024 * 1024) {
    throw new Error("File too large (max 15MB).");
  }

  const isPng =
    uploadBuffer.length >= 8 &&
    uploadBuffer[0] === 0x89 &&
    uploadBuffer[1] === 0x50 &&
    uploadBuffer[2] === 0x4e &&
    uploadBuffer[3] === 0x47;
  if (!isPng) {
    throw new Error("Only PNG files are supported.");
  }

  const filename = resolveStandingFilename(body);
  const driverId = body.driver_id;
  const sb = supabase();
  const shouldUseSupabase = Boolean(sb && driverId);

  if (shouldUseSupabase) {
    const readyError = await assertSupabaseReady(sb);
    if (readyError) {
      const err = new Error(readyError.error);
      err.status = 400;
      err.details = readyError;
      throw err;
    }

    return saveToSupabaseStorage(sb, uploadBuffer, filename, driverId, body);
  }

  if (!isLocalDev()) {
    const configError = getSupabaseConfigError();
    if (configError) {
      const err = new Error(configError.error);
      err.status = 400;
      err.details = configError;
      throw err;
    }
    if (!driverId) {
      const err = new Error("Missing driver_id.");
      err.status = 400;
      throw err;
    }
    const err = new Error(
      "Supabase Storage is required to save standing driver photos on the live site.",
    );
    err.status = 400;
    throw err;
  }

  if (!driverId) {
    const err = new Error("Missing driver_id.");
    err.status = 400;
    throw err;
  }

  return saveToLocalFile(uploadBuffer, filename, body);
}
