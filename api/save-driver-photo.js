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
const STORAGE_BUCKET = "driver-photos";

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('driver-photos', 'driver-photos', true)
on conflict (id) do update set public = true;

create policy "Public read driver photos"
on storage.objects
for select
using (bucket_id = 'driver-photos');`;

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

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

function safeFilenameFromPhotoUrl(photoUrl) {
  const clean = stripPhotoUrlQuery(photoUrl);
  const last = path.basename(clean);
  if (!last.toLowerCase().endsWith(".png")) {
    throw new Error("Photo URL must end with .png");
  }
  if (!last || last.includes("..")) {
    throw new Error("Invalid filename.");
  }
  return last;
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

// Turn the driver's Photo URL (e.g. "assets/drivers/mark-arthur.png")
// into a safe absolute path inside public/.
function resolvePhotoOutputPath(photoUrl) {
  let rel = stripPhotoUrlQuery(photoUrl);
  if (!rel) {
    throw new Error("Driver has no Photo URL set.");
  }
  if (/^https?:\/\//i.test(rel)) {
    throw new Error(
      "Photo URL is an external link. Use a local assets/drivers/name.png path in Admin > Drivers for local file saves.",
    );
  }

  rel = rel.replace(/^\/+/, "");

  if (!rel.toLowerCase().endsWith(".png")) {
    throw new Error("Photo URL must end with .png");
  }
  if (rel.includes("..")) {
    throw new Error("Invalid Photo URL path.");
  }

  const resolved = path.resolve(path.join(PUBLIC_DIR, rel));
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    throw new Error("Invalid save path.");
  }

  return { resolved, rel };
}

async function upsertDriverPhotoUrl(sb, driverId, publicUrl, body) {
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
      "Missing driver profile. Open Admin > Drivers and save this driver once before uploading a photo.",
    );
  }

  const row = {
    driver_id: id,
    iracing_name: iracingName,
    display_name: displayName || iracingName,
    driver_name: displayName || iracingName,
    slug: slugify(displayName || iracingName || id),
    car_number: carNumber,
    truck_number: carNumber,
    photo_url: stripPhotoUrlQuery(publicUrl),
    active: existing?.active !== false,
    updated_at: new Date().toISOString(),
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
    console.warn("[save-driver-photo] remove before upload:", error.message);
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
  const profile = await upsertDriverPhotoUrl(sb, driverId, storedUrl, body);
  const cacheVersion = photoCacheVersion(profile?.updated_at) || Date.now();
  const displayUrl = withPhotoCacheBust(storedUrl, cacheVersion);

  return {
    filename,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${filename})`,
    photoUrl: displayUrl,
    publicUrl: displayUrl,
    photoUrlStored: storedUrl,
    cacheVersion,
    updatedAt: profile?.updated_at || null,
    profileUpdated: true,
    storage: "supabase",
  };
}

function saveToLocalFile(uploadBuffer, photoUrl) {
  const { resolved, rel } = resolvePhotoOutputPath(photoUrl);
  const filename = path.basename(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);
  const storedUrl = `/${rel.replace(/^\/+/, "")}`;
  const cacheVersion = Date.now();
  const displayUrl = withPhotoCacheBust(storedUrl, cacheVersion);
  return {
    filename,
    savedTo: `public/${rel}`,
    photoUrl: displayUrl,
    publicUrl: displayUrl,
    photoUrlStored: storedUrl,
    cacheVersion,
    updatedAt: new Date(cacheVersion).toISOString(),
    profileUpdated: false,
    storage: "local",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = parseBody(req);
    const password = process.env.ADMIN_PASSWORD;
    if (password && body.password !== password) {
      json(res, 401, { error: "Invalid admin password." });
      return;
    }

    const uploadBuffer = readUploadBuffer(body);

    if (uploadBuffer.length > 12 * 1024 * 1024) {
      json(res, 400, { error: "File too large (max 12MB)." });
      return;
    }

    const isPng =
      uploadBuffer.length >= 8 &&
      uploadBuffer[0] === 0x89 &&
      uploadBuffer[1] === 0x50 &&
      uploadBuffer[2] === 0x4e &&
      uploadBuffer[3] === 0x47;
    if (!isPng) {
      json(res, 400, { error: "Only PNG files are supported." });
      return;
    }

    const filename = safeFilenameFromPhotoUrl(body.photoUrl);
    const driverId = body.driver_id;
    const sb = supabase();
    const shouldUseSupabase = Boolean(sb && driverId);

    if (shouldUseSupabase) {
      const readyError = await assertSupabaseReady(sb);
      if (readyError) {
        json(res, 400, readyError);
        return;
      }

      const result = await saveToSupabaseStorage(
        sb,
        uploadBuffer,
        filename,
        driverId,
        body,
      );
      json(res, 200, { success: true, ...result });
      return;
    }

    if (!isLocalDev()) {
      const configError = getSupabaseConfigError();
      if (configError) {
        json(res, 400, configError);
        return;
      }
      if (!driverId) {
        json(res, 400, { error: "Missing driver_id." });
        return;
      }
      json(res, 400, {
        error: "Supabase Storage is required to save driver photos on the live site.",
      });
      return;
    }

    if (!driverId) {
      json(res, 400, { error: "Missing driver_id." });
      return;
    }

    const result = saveToLocalFile(uploadBuffer, body.photoUrl);
    json(res, 200, { success: true, ...result });
  } catch (err) {
    if (err.details?.setupSql) {
      json(res, 400, {
        error: err.details.error || err.message || "Save failed.",
        bucket: err.details.bucket,
        setupSql: err.details.setupSql,
      });
      return;
    }
    json(res, 400, { error: err.message || "Save failed." });
  }
}
