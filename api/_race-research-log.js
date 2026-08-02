import { randomUUID } from 'crypto';

export function createResearchOperationId() {
  return randomUUID().slice(0, 8);
}

/**
 * Sanitized Vercel log line for race research ops (no transcript text, keys, or auth).
 */
export function logResearchOperation(fields = {}) {
  const payload = {
    component: 'race-research',
    opId: fields.opId || createResearchOperationId(),
    action: fields.action || 'unknown',
    seasonId: fields.seasonId != null ? String(fields.seasonId) : undefined,
    raceNumber: fields.raceNumber != null ? Number(fields.raceNumber) : undefined,
    sourceType: fields.sourceType,
    sourceIdShort: fields.sourceId ? String(fields.sourceId).slice(0, 8) : undefined,
    chunkCount: fields.chunkCount,
    processingMode: fields.processingMode,
    created: fields.created,
    updated: fields.updated,
    skipped: fields.skipped,
    durationMs: fields.durationMs,
    status: fields.status || 'ok',
    error: fields.error ? String(fields.error).slice(0, 200) : undefined,
  };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  console.log(JSON.stringify(payload));
  return payload.opId;
}

export function researchErrorResponse(message, opId, status = 500) {
  return {
    status,
    error: String(message || 'Request failed.').slice(0, 500),
    operationId: opId || null,
  };
}
