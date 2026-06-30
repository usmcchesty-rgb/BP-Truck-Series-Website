import { supabase, withPhotoCacheBust } from "./_lib.js";
import { safeFilename } from "../server/track-upload-shared.mjs";

function normalizeVersionsMap(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const slug = String(key || "").trim().toLowerCase();
    const version = Number(value);
    if (!slug || !Number.isFinite(version) || version <= 0) continue;
    out[slug] = version;
  }
  return out;
}

export function trackSlugFromFilename(filename) {
  return safeFilename(filename).replace(/\.png$/i, "").toLowerCase();
}

export async function loadTrackImageVersions() {
  const sb = supabase();
  if (!sb) return {};
  const { data, error } = await sb
    .from("site_settings")
    .select("trackImageVersions")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.warn("[track-image-versions] load failed:", error.message);
    return {};
  }
  return normalizeVersionsMap(data?.trackImageVersions);
}

export async function recordTrackImageVersion(filename) {
  const sb = supabase();
  const slug = trackSlugFromFilename(filename);
  const version = Date.now();
  if (!sb || !slug) return version;

  const current = await loadTrackImageVersions();
  const next = { ...current, [slug]: version };

  const { error } = await sb
    .from("site_settings")
    .upsert({ id: 1, trackImageVersions: next }, { onConflict: "id" });

  if (error) {
    console.warn("[track-image-versions] save failed:", error.message);
  }

  return version;
}

export function publicTrackImageUrl(baseUrl, slug, versions = {}) {
  const cleanBase = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!cleanBase || !slug) return null;
  const url = `${cleanBase}/${encodeURIComponent(`${slug}.png`)}`;
  const version = versions[slug];
  return withPhotoCacheBust(url, version);
}
