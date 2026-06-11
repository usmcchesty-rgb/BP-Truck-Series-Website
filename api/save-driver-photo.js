import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

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

// Turn the driver's Photo URL (e.g. "assets/drivers/mark-arthur.png")
// into a safe absolute path inside public/.
function resolvePhotoOutputPath(photoUrl) {
  let rel = String(photoUrl || "").trim();
  if (!rel) {
    throw new Error("Driver has no Photo URL set.");
  }
  if (/^https?:\/\//i.test(rel)) {
    throw new Error(
      "Photo URL is an external link. Set a local path (e.g. assets/drivers/name.png) in Admin > Drivers first.",
    );
  }

  rel = rel.split("?")[0].split("#")[0];
  rel = rel.replace(/^\/+/, ""); // allow "/assets/..." too

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

    const { resolved, rel } = resolvePhotoOutputPath(body.photoUrl);
    const filename = path.basename(resolved);

    if (process.env.VERCEL_ENV === "production") {
      json(res, 501, {
        error:
          "Saving driver photos is only supported in local vercel dev. Commit saved PNGs from your machine.",
        filename,
      });
      return;
    }

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, uploadBuffer);

    json(res, 200, {
      success: true,
      filename,
      savedTo: `public/${rel}`,
      photoUrl: rel,
    });
  } catch (err) {
    json(res, 400, { error: err.message || "Save failed." });
  }
}
