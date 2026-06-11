import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { slugify, supabase } from "./_lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const STORAGE_BUCKET = "driver-photos";

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
  const clean = String(photoUrl || "").split("?")[0].split("#")[0];
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

// Turn the driver's Photo URL (e.g. "assets/drivers/mark-arthur.png")
// into a safe absolute path inside public/.
function resolvePhotoOutputPath(photoUrl) {
  let rel = String(photoUrl || "").trim();
  if (!rel) {
    throw new Error("Driver has no Photo URL set.");
  }
  if (/^https?:\/\//i.test(rel)) {
    throw new Error(
      "Photo URL is an external link. Use a local assets/drivers/name.png path in Admin > Drivers for local file saves.",
    );
  }

  rel = rel.split("?")[0].split("#")[0];
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
    photo_url: publicUrl,
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

async function saveToSupabaseStorage(sb, uploadBuffer, filename, driverId, body) {
  const { error: uploadError } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(filename, uploadBuffer, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const publicUrl = publicStorageUrl(filename);
  await upsertDriverPhotoUrl(sb, driverId, publicUrl, body);

  return {
    filename,
    savedTo: `Supabase Storage (${STORAGE_BUCKET}/${filename})`,
    photoUrl: publicUrl,
    publicUrl,
    profileUpdated: true,
    storage: "supabase",
  };
}

function saveToLocalFile(uploadBuffer, photoUrl) {
  const { resolved, rel } = resolvePhotoOutputPath(photoUrl);
  const filename = path.basename(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, uploadBuffer);
  return {
    filename,
    savedTo: `public/${rel}`,
    photoUrl: rel,
    publicUrl: `/${rel.replace(/^\/+/, "")}`,
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
    if (sb && driverId) {
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

    if (!sb && !isLocalDev()) {
      json(res, 400, {
        error:
          "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel to save driver photos on the live site.",
      });
      return;
    }

    if (!driverId && !isLocalDev()) {
      json(res, 400, { error: "Missing driver_id." });
      return;
    }

    if (!isLocalDev()) {
      json(res, 400, {
        error: "Supabase Storage is required to save driver photos on the live site.",
      });
      return;
    }

    const result = saveToLocalFile(uploadBuffer, body.photoUrl);
    json(res, 200, { success: true, ...result });
  } catch (err) {
    json(res, 400, { error: err.message || "Save failed." });
  }
}
