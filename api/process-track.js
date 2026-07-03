import { processTrackPng } from "../server/process-track-image.mjs";
import { safeFilename } from "../server/track-upload-shared.mjs";
import { saveTrackImage } from "./_upload-track-image.js";

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

    const hasBase64Image = body.imageBase64 || body.image;
    if (!hasBase64Image) {
      json(res, 400, {
        error:
          'No image received. Expected JSON field "imageBase64" with a PNG data URL.',
        expectedFileField: "imageBase64",
        receivedKeys: Object.keys(body || {}),
      });
      return;
    }

    const uploadBuffer = readUploadBuffer(body);
    const rawOutput =
      body.outputFilename || body.filename || body.name || "track.png";
    const filename = safeFilename(rawOutput);

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

    const whiteTrackNoOutline = body.whiteTrackNoOutline === true;
    const processed = await processTrackPng(uploadBuffer, { whiteTrackNoOutline });
    const saved = await saveTrackImage(processed, filename);

    json(res, 200, {
      ...saved,
      before: `data:image/png;base64,${uploadBuffer.toString("base64")}`,
      after: `data:image/png;base64,${processed.toString("base64")}`,
    });
  } catch (err) {
    const status = err.status || 400;
    json(res, status, {
      error: err.message || "Processing failed.",
      details: err.details || undefined,
    });
  }
}
