import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { processTrackPng } from "./process-track-image.mjs";
import {
  ROOT,
  TRACKS_DIR,
  resolveTrackOutputPath,
  safeFilename,
  ensureTracksDir,
} from "./track-upload-shared.mjs";

const PORT = Number(process.env.TRACK_TOOL_PORT || 3010);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || "").toLowerCase();
    if (!name.endsWith(".png") || file.mimetype !== "image/png") {
      cb(new Error("Only PNG files are supported."));
      return;
    }
    cb(null, true);
  },
});

const app = express();
app.use(express.static(path.join(ROOT, "public")));

app.post("/api/process-track", upload.single("image"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ error: "No PNG file uploaded." });
      return;
    }

    const password = process.env.ADMIN_PASSWORD;
    if (password && req.body?.password !== password) {
      res.status(401).json({ error: "Invalid admin password." });
      return;
    }

    const filename = safeFilename(req.file.originalname);
    const processed = await processTrackPng(req.file.buffer);
    const outputPath = resolveTrackOutputPath(filename);
    fs.writeFileSync(outputPath, processed);

    res.json({
      success: true,
      filename,
      savedTo: `public/assets/tracks/${filename}`,
      before: `data:image/png;base64,${req.file.buffer.toString("base64")}`,
      after: `data:image/png;base64,${processed.toString("base64")}`,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Processing failed." });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Upload failed." });
});

ensureTracksDir();
app.listen(PORT, () => {
  console.log(`Optional standalone track tool: http://127.0.0.1:${PORT}/admin/track-images.html`);
  console.log(`Saving processed PNGs to: ${TRACKS_DIR}`);
});
