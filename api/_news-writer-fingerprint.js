import { createHash } from 'crypto';
import { RACE_RESEARCH_PACKAGE_VERSION } from '../server/config/race-research-config.js';

export function computePackageFingerprint(racePackage, seasonId, raceNumber) {
  const facts = racePackage?.facts || [];
  const ids = facts.map((f) => f.id).sort();
  const canonicalCount = facts.filter((f) => f.canonicalFactId).length;
  const payload = [
    String(seasonId),
    String(raceNumber),
    RACE_RESEARCH_PACKAGE_VERSION,
    String(facts.length),
    String(canonicalCount),
    ids.join(','),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

export function createPlannerOperationId() {
  return createHash('sha256').update(`plan-${Date.now()}`).digest('hex').slice(0, 8);
}

/** Deterministic operation id for tests from fingerprint + depth. */
export function deterministicOperationId(fingerprint, articleDepth) {
  return createHash('sha256').update(`${fingerprint}:${articleDepth}`).digest('hex').slice(0, 8);
}
