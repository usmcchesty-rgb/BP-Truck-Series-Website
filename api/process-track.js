import fs from "fs";
import { processTrackPng } from "../server/process-track-image.mjs";
import {
  resolveTrackOutputPath,
  safeFilename,
} from "../server/track-upload-shared.mjs";

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
    const filename = safeFilename(body.filename || body.name || "track.png");

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

    const processed = await processTrackPng(uploadBuffer);

    if (process.env.VERCEL_ENV === "production") {
      json(res, 501, {
        error:
          "Saving track files is only supported in local vercel dev. Commit processed PNGs from your machine.",
        filename,
        before: `data:image/png;base64,${uploadBuffer.toString("base64")}`,
        after: `data:image/png;base64,${processed.toString("base64")}`,
      });
      return;
    }

    const outputPath = resolveTrackOutputPath(filename);
    fs.writeFileSync(outputPath, processed);

    json(res, 200, {
      success: true,
      filename,
      savedTo: `public/assets/tracks/${filename}`,
      before: `data:image/png;base64,${uploadBuffer.toString("base64")}`,
      after: `data:image/png;base64,${processed.toString("base64")}`,
    });
  } catch (err) {
    json(res, 400, { error: err.message || "Processing failed." });
  }
}
