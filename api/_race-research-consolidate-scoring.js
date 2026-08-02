export function normalizeSummary(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenOverlap(a, b) {
  const ta = new Set(normalizeSummary(a).split(' ').filter((w) => w.length > 3));
  const tb = new Set(normalizeSummary(b).split(' ').filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

export function sameDrivers(a, b) {
  const da = new Set((a.driverIds || []).map(String));
  const db = new Set((b.driverIds || []).map(String));
  if (!da.size && !db.size) {
    const na = new Set((a.driverNames || []).map((n) => normalizeSummary(n)));
    const nb = new Set((b.driverNames || []).map((n) => normalizeSummary(n)));
    for (const n of na) if (nb.has(n)) return true;
    return false;
  }
  for (const id of da) if (db.has(id)) return true;
  return false;
}

export function mergeScore(a, b, linkMeta = {}) {
  if (a.factType !== b.factType) return 0;
  if (a.category && b.category && a.category !== b.category) {
    if (!['broadcast', 'broadcast_quote'].includes(a.category)) return 0;
  }

  const summarySim = tokenOverlap(a.summary, b.summary);
  if (summarySim < 0.45) return 0;

  const lapA = a.lapNumber ?? null;
  const lapB = b.lapNumber ?? null;
  if (lapA != null && lapB != null && lapA !== lapB) return 0;

  if (!sameDrivers(a, b) && summarySim < 0.75) return 0;

  let score = summarySim;
  if (linkMeta.adjacentChunks) score += 0.15;
  if (lapA != null && lapB != null && lapA === lapB) score += 0.2;
  return score;
}
