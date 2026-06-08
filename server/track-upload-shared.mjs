import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, "..");
export const TRACKS_DIR = path.join(ROOT, "public", "assets", "tracks");

export function safeFilename(original) {
  const base = path.basename(String(original || ""));
  if (!base || base.includes("..") || base.includes("/") || base.includes("\\")) {
    throw new Error("Invalid filename.");
  }
  if (!base.toLowerCase().endsWith(".png")) {
    throw new Error("Filename must end with .png");
  }
  return base;
}

export function ensureTracksDir() {
  fs.mkdirSync(TRACKS_DIR, { recursive: true });
}

export function resolveTrackOutputPath(filename) {
  ensureTracksDir();
  const outputPath = path.join(TRACKS_DIR, filename);
  const resolved = path.resolve(outputPath);
  if (!resolved.startsWith(path.resolve(TRACKS_DIR))) {
    throw new Error("Invalid save path.");
  }
  return resolved;
}
