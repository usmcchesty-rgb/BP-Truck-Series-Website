import { countUniqueFactsUsed } from './_news-writer-depth-enforcement.js';

export const FACT_DIAGNOSTIC = {
  FACTS_UNAVAILABLE: 'FACTS_UNAVAILABLE',
  FACT_VERIFICATION_FAILED: 'FACT_VERIFICATION_FAILED',
};

function roundPercent(value) {
  return Math.round(Number(value) * 10) / 10;
}

function safePercent(used, available) {
  if (!Number.isFinite(available) || available <= 0) return null;
  return roundPercent((Math.max(0, Number(used) || 0) / available) * 100);
}

function normalizeTakeawayTokens(label) {
  return String(label || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

export function summarizeTakeawayCoverage(body, takeaways) {
  const list = Array.isArray(takeaways) ? takeaways : [];
  const available = list.length;
  if (!available) {
    return { available: 0, covered: 0, percent: null };
  }
  const text = String(body || '').toLowerCase();
  let covered = 0;
  for (const takeaway of list) {
    const tokens = normalizeTakeawayTokens(takeaway?.label);
    if (tokens.some((tok) => text.includes(tok))) covered += 1;
  }
  return {
    available,
    covered,
    percent: safePercent(covered, available),
  };
}

export function summarizeFactLedgerMetrics({
  articleType = 'race-recap',
  ledgerSnapshot = null,
  sectionDrafts = [],
  preparedFacts = null,
  racePackage = null,
  takeaways = [],
  body = '',
}) {
  const factsAvailableFromLedger = Number(ledgerSnapshot?.totalFacts);
  const factsAvailableFromPrepared = Array.isArray(preparedFacts) ? preparedFacts.length : null;
  const factsAvailableFromPackage = Array.isArray(racePackage?.facts) ? racePackage.facts.length : null;
  const factsAvailable = Number.isFinite(factsAvailableFromLedger)
    ? factsAvailableFromLedger
    : Number.isFinite(factsAvailableFromPrepared)
      ? factsAvailableFromPrepared
      : Number.isFinite(factsAvailableFromPackage)
        ? factsAvailableFromPackage
        : 0;

  const factsUsed = countUniqueFactsUsed(sectionDrafts, ledgerSnapshot);
  const factsVerified = factsUsed;
  const criticalAvailable = Number(ledgerSnapshot?.criticalTotal) || 0;
  const criticalUsed = Number(ledgerSnapshot?.criticalUsed) || 0;
  const criticalCoveragePercent = safePercent(criticalUsed, criticalAvailable);

  const takeawayCoverage = summarizeTakeawayCoverage(body, takeaways);
  const requiresFactualGrounding = String(articleType || '').toLowerCase() === 'race-recap';

  let diagnosticCode = null;
  if (factsAvailable <= 0) {
    diagnosticCode = FACT_DIAGNOSTIC.FACTS_UNAVAILABLE;
  } else if (factsVerified <= 0) {
    diagnosticCode = FACT_DIAGNOSTIC.FACT_VERIFICATION_FAILED;
  }

  return {
    factsAvailable,
    factsUsed,
    factsVerified,
    criticalFactsAvailable: criticalAvailable,
    criticalFactsUsed: criticalUsed,
    criticalCoveragePercent,
    takeawaysAvailable: takeawayCoverage.available,
    takeawaysCovered: takeawayCoverage.covered,
    takeawayCoveragePercent: takeawayCoverage.percent,
    diagnosticCode,
    requiresFactualGrounding,
  };
}

export function applyFactGroundingValidationGuard({
  articleType = 'race-recap',
  factMetrics = null,
  validationScore = 0,
  scoreCap = 59,
}) {
  const metrics = factMetrics || {};
  const requiresFactualGrounding =
    metrics.requiresFactualGrounding ?? String(articleType || '').toLowerCase() === 'race-recap';

  if (!requiresFactualGrounding) {
    return { guarded: false, validationScore, capApplied: false, diagnosticCode: null };
  }
  if ((metrics.factsAvailable || 0) <= 0) {
    return {
      guarded: true,
      validationScore: Math.min(validationScore, scoreCap),
      capApplied: validationScore > scoreCap,
      diagnosticCode: FACT_DIAGNOSTIC.FACTS_UNAVAILABLE,
    };
  }
  if ((metrics.factsVerified || 0) <= 0) {
    return {
      guarded: true,
      validationScore: Math.min(validationScore, scoreCap),
      capApplied: validationScore > scoreCap,
      diagnosticCode: FACT_DIAGNOSTIC.FACT_VERIFICATION_FAILED,
    };
  }
  return { guarded: false, validationScore, capApplied: false, diagnosticCode: null };
}
