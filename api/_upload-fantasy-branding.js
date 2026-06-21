import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  photoCacheVersion,
  stripPhotoUrlQuery,
  supabase,
  withPhotoCacheBust,
} from "./_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const STORAGE_BUCKET = "site-assets";

const HERO_STORAGE_FILENAME = "fantasy/hero-background.jpg";
const HERO_LOCAL_REL_PATH = "assets/fantasy/hero-background.jpg";
const LOGO_STORAGE_FILENAME = "fantasy/fantasy-logo.png";
const LOGO_LOCAL_REL_PATH = "assets/fantasy/fantasy-logo.png";

const STORAGE_SETUP_SQL = `insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do update set public = true;

create policy "Public read site assets"
on storage.objects
for select
using (bucket_id = 'site-assets');`;

function readUploadBuffer(body) {
  const raw = body.imageBase64 || body.image || "";
  const base64 = String(raw)
    .replace(/^data:image\/(?:png|jpeg|jpg);base64,/, "")
    .trim();
  if (!base64) {
    throw new Error("No image data provided.");
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
  return `${base}/storage/v1/object/public/${STORAGE_BUCKET}/${filename
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
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
    throw new Error(`Could not remove existing image: ${error.message}`);
  }
}

async function upsertFantasyHeroSettings(sb, storedUrl) {
  const updatedAt = storedUrl ? new Date().toISOString() : null;
  const patch = {
    id: 1,
    fantasyHeroBackgroundUrl: stripPhotoUrlQuery(storedUrl || ""),
    fantasyHeroBackgroundUpdatedAt: updatedAt,
  };

  const { data, error } = await sb
    .from("site_settings")
    .upsert(patch, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Could not save fantasy hero settings: ${error.message}`);
  }

  return data;
}

async function upsertFantasyLogoSettings(sb, storedUrl) {
  const updatedAt = storedUrl ? new Date().toISOString() : null;
  const patch = {
    id: 1,
    fantasyHeaderLogoUrl: stripPhotoUrlQuery(storedUrl || ""),
    fantasyHeaderLogoUpdatedAt: updatedAt,
  };

  const { data, error } = await sb
    .from("site_settings")
    .upsert(patch, { onConflict: "id" })
    .select()
    .single();

  if (error) {
    throw new Error(`Could not save fantasy logo settings: ${error.message}`);
  }

  return data;
}

function resolveFantasyHeroDisplayUrl(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeroBackgroundUrl || "");
  if (!stored) return "";
  const version =
    photoCacheVersion(settings.fantasyHeroBackgroundUpdatedAt) || Date.now();
  return withPhotoCacheBust(stored, version);
}

function resolveFantasyLogoDisplayUrl(settings = {}) {
  const stored = stripPhotoUrlQuery(settings.fantasyHeaderLogoUrl || "");
  if (!stored) return "";
  const version =
    photoCacheVersion(settings.fantasyHeaderLogoUpdatedAt) || Date.now();
  return withPhotoCacheBust(stored, version);
}

function validateHeroBuffer(uploadBuffer) {
  if (uploadBuffer.length > 12 * 1024 * 1024) {
    throw new Error("File too large (max 12MB).");
  }

  const isPng =
    uploadBuffer.length >= 8 &&
    uploadBuffer[0] === 0x89 &&
    uploadBuffer[1] === 0x50 &&
    uploadBuffer[2] === 0x4e &&
    uploadBuffer[3] === 0x47;
  const isJpeg =
    uploadBuffer.length >= 3 &&
    uploadBuffer[0] === 0xff &&
    uploadBuffer[1] === 0xd8 &&
    uploadBuffer[2] === 0xff;

  if (!isPng && !isJpeg) {
    throw new Error("Only PNG or JPG files are supported for the hero background.");
  }
}

function validateLogoBuffer(uploadBuffer) {
  if (uploadBuffer.length > 8 * 1024 * 1024) {
    throw new Error("File too large (max 8MB).");
  }

  const isPng =
    uploadBuffer.length >= 8 &&
    uploadBuffer[0] === 0x89 &&
    uploadBuffer[1] === 0x50 &&
    uploadBuffer[2] === 0x4e &&
    uploadBuffer[3] === 0x47;
  if (!isPng) {
    throw new Error("Only PNG files are supported for the fantasy header logo.");
  }
}

async function saveHeroToSupabaseStorage(sb, uploadBuffer) {
  const bucketError = await verifyStorageBucket(sb);
  if (bucketError) {
    const err = new Error(bucketError.error);
    err.details = bucketError;
    throw err;
  }

  await removeExistingStorageObject(sb, HERO_STORAGE_FILENAME);

  const contentType =
    uploadBuffer[0] === 0xff && uploadBuffer[1] === 0xd8
      ? "image/jpeg"
      : "image/png";

  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(HERO_STORAGE_FILENAME, uploadBuffer, {
      contentType,
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

  const storedUrl = stripPhotoUrlQuery(publicStorageUrl(HERO_STORAGE_FILENAME));
  const settings = await upsertFantasyHeroSettings(sb, storedUrl);

  return {
    filename: HERO_STORAGE_FILENAME,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${HERO_STORAGE_FILENAME})`,
    fantasyHeroBackgroundUrl: resolveFantasyHeroDisplayUrl(settings),
    fantasyHeroBackgroundUrlStored: storedUrl,
    fantasyHeroBackgroundUpdatedAt: settings.fantasyHeroBackgroundUpdatedAt,
    cacheVersion: photoCacheVersion(settings.fantasyHeroBackgroundUpdatedAt),
    storage: "supabase",
  };
}

function saveHeroToLocalFile(uploadBuffer) {
  const rel = HERO_LOCAL_REL_PATH.replace(/\\/g, "/");
  const resolved = path.join(PUBLIC_DIR, rel);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);

  const storedUrl = `/${rel}`;
  const updatedAt = new Date().toISOString();

  return {
    filename: path.basename(rel),
    savedTo: `public/${rel}`,
    fantasyHeroBackgroundUrl: withPhotoCacheBust(
      storedUrl,
      photoCacheVersion(updatedAt),
    ),
    fantasyHeroBackgroundUrlStored: storedUrl,
    fantasyHeroBackgroundUpdatedAt: updatedAt,
    cacheVersion: photoCacheVersion(updatedAt),
    storage: "local",
  };
}

async function saveLogoToSupabaseStorage(sb, uploadBuffer) {
  const bucketError = await verifyStorageBucket(sb);
  if (bucketError) {
    const err = new Error(bucketError.error);
    err.details = bucketError;
    throw err;
  }

  await removeExistingStorageObject(sb, LOGO_STORAGE_FILENAME);

  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(LOGO_STORAGE_FILENAME, uploadBuffer, {
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

  const storedUrl = stripPhotoUrlQuery(publicStorageUrl(LOGO_STORAGE_FILENAME));
  const settings = await upsertFantasyLogoSettings(sb, storedUrl);

  return {
    filename: LOGO_STORAGE_FILENAME,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${LOGO_STORAGE_FILENAME})`,
    fantasyHeaderLogoUrl: resolveFantasyLogoDisplayUrl(settings),
    fantasyHeaderLogoUrlStored: storedUrl,
    fantasyHeaderLogoUpdatedAt: settings.fantasyHeaderLogoUpdatedAt,
    cacheVersion: photoCacheVersion(settings.fantasyHeaderLogoUpdatedAt),
    storage: "supabase",
  };
}

function saveLogoToLocalFile(uploadBuffer) {
  const rel = LOGO_LOCAL_REL_PATH.replace(/\\/g, "/");
  const resolved = path.join(PUBLIC_DIR, rel);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);

  const storedUrl = `/${rel}`;
  const updatedAt = new Date().toISOString();

  return {
    filename: path.basename(rel),
    savedTo: `public/${rel}`,
    fantasyHeaderLogoUrl: withPhotoCacheBust(
      storedUrl,
      photoCacheVersion(updatedAt),
    ),
    fantasyHeaderLogoUrlStored: storedUrl,
    fantasyHeaderLogoUpdatedAt: updatedAt,
    cacheVersion: photoCacheVersion(updatedAt),
    storage: "local",
  };
}

export async function uploadFantasyHeroBackgroundImage(body) {
  const uploadBuffer = readUploadBuffer(body);
  validateHeroBuffer(uploadBuffer);

  const sb = supabase();
  if (sb) {
    const result = await saveHeroToSupabaseStorage(sb, uploadBuffer);
    if (isLocalDev()) {
      try {
        saveHeroToLocalFile(uploadBuffer);
      } catch {
        // Local mirror is optional when Supabase is configured.
      }
    }
    return result;
  }

  if (!isLocalDev()) {
    const err = new Error(
      "Supabase Storage is required to upload the fantasy hero background on the live site.",
    );
    err.status = 400;
    throw err;
  }

  return saveHeroToLocalFile(uploadBuffer);
}

export async function removeFantasyHeroBackgroundImage() {
  const sb = supabase();
  if (sb) {
    await removeExistingStorageObject(sb, HERO_STORAGE_FILENAME);
    const settings = await upsertFantasyHeroSettings(sb, "");
    return {
      removed: true,
      fantasyHeroBackgroundUrl: "",
      fantasyHeroBackgroundUrlStored: "",
      fantasyHeroBackgroundUpdatedAt: settings.fantasyHeroBackgroundUpdatedAt,
    };
  }

  const rel = HERO_LOCAL_REL_PATH.replace(/\\/g, "/");
  const resolved = path.join(PUBLIC_DIR, rel);
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }

  return {
    removed: true,
    fantasyHeroBackgroundUrl: "",
    fantasyHeroBackgroundUrlStored: "",
    fantasyHeroBackgroundUpdatedAt: null,
    storage: "local",
  };
}

export async function uploadFantasyHeaderLogoImage(body) {
  const uploadBuffer = readUploadBuffer(body);
  validateLogoBuffer(uploadBuffer);

  const sb = supabase();
  if (sb) {
    const result = await saveLogoToSupabaseStorage(sb, uploadBuffer);
    if (isLocalDev()) {
      try {
        saveLogoToLocalFile(uploadBuffer);
      } catch {
        // Local mirror is optional when Supabase is configured.
      }
    }
    return result;
  }

  if (!isLocalDev()) {
    const err = new Error(
      "Supabase Storage is required to upload the fantasy header logo on the live site.",
    );
    err.status = 400;
    throw err;
  }

  return saveLogoToLocalFile(uploadBuffer);
}

export async function removeFantasyHeaderLogoImage() {
  const sb = supabase();
  if (sb) {
    await removeExistingStorageObject(sb, LOGO_STORAGE_FILENAME);
    const settings = await upsertFantasyLogoSettings(sb, "");
    return {
      removed: true,
      fantasyHeaderLogoUrl: "",
      fantasyHeaderLogoUrlStored: "",
      fantasyHeaderLogoUpdatedAt: settings.fantasyHeaderLogoUpdatedAt,
    };
  }

  const rel = LOGO_LOCAL_REL_PATH.replace(/\\/g, "/");
  const resolved = path.join(PUBLIC_DIR, rel);
  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }

  return {
    removed: true,
    fantasyHeaderLogoUrl: "",
    fantasyHeaderLogoUrlStored: "",
    fantasyHeaderLogoUpdatedAt: null,
    storage: "local",
  };
}
