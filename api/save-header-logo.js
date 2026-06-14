import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  photoCacheVersion,
  resolveHeaderLogoDisplayUrl,
  stripPhotoUrlQuery,
  supabase,
  withPhotoCacheBust,
} from "./_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const STORAGE_BUCKET = "site-assets";
const STORAGE_FILENAME = "header-logo.png";
const LOCAL_REL_PATH = "assets/logos/custom-header-logo.png";

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do update set public = true;

create policy "Public read site assets"
on storage.objects
for select
using (bucket_id = 'site-assets');`;

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

function publicStorageUrl(filename) {
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("Supabase URL is not configured.");
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURIComponent(filename)}`;
}

function isLocalDev() {
  return process.env.VERCEL_ENV !== "production";
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
    throw new Error(`Could not remove existing logo: ${error.message}`);
  }
}

async function upsertHeaderLogoSettings(sb, storedUrl) {
  const updatedAt = new Date().toISOString();
  const patch = {
    id: 1,
    headerLogoUrl: stripPhotoUrlQuery(storedUrl),
    headerLogoUpdatedAt: updatedAt,
  };

  const { data, error } = await sb
    .from("site_settings")
    .upsert(patch, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Could not save header logo settings: ${error.message}`);
  }

  return data;
}

async function saveToSupabaseStorage(sb, uploadBuffer) {
  const bucketError = await verifyStorageBucket(sb);
  if (bucketError) {
    const err = new Error(bucketError.error);
    err.details = bucketError;
    throw err;
  }

  await removeExistingStorageObject(sb, STORAGE_FILENAME);

  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(STORAGE_FILENAME, uploadBuffer, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "60",
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

  const storedUrl = stripPhotoUrlQuery(publicStorageUrl(STORAGE_FILENAME));
  const settings = await upsertHeaderLogoSettings(sb, storedUrl);
  const displayUrl = resolveHeaderLogoDisplayUrl(settings);

  return {
    filename: STORAGE_FILENAME,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${STORAGE_FILENAME})`,
    headerLogoUrl: displayUrl,
    headerLogoUrlStored: storedUrl,
    headerLogoUpdatedAt: settings.headerLogoUpdatedAt,
    cacheVersion: photoCacheVersion(settings.headerLogoUpdatedAt),
    storage: "supabase",
  };
}

function saveToLocalFile(uploadBuffer) {
  const rel = LOCAL_REL_PATH.replace(/\\/g, "/");
  const resolved = path.join(PUBLIC_DIR, rel);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);

  const storedUrl = `/${rel}`;
  const updatedAt = new Date().toISOString();
  const displayUrl = withPhotoCacheBust(storedUrl, photoCacheVersion(updatedAt));

  return {
    filename: path.basename(rel),
    savedTo: `public/${rel}`,
    headerLogoUrl: displayUrl,
    headerLogoUrlStored: storedUrl,
    headerLogoUpdatedAt: updatedAt,
    cacheVersion: photoCacheVersion(updatedAt),
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

    if (uploadBuffer.length > 8 * 1024 * 1024) {
      json(res, 400, { error: "File too large (max 8MB)." });
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

    const sb = supabase();
    if (sb) {
      const result = await saveToSupabaseStorage(sb, uploadBuffer);
      json(res, 200, { success: true, ...result });
      return;
    }

    if (!isLocalDev()) {
      json(res, 400, {
        error:
          "Supabase Storage is required to upload the header logo on the live site.",
      });
      return;
    }

    const result = saveToLocalFile(uploadBuffer);
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
