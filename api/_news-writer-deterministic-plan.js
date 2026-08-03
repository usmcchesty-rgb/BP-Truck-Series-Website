import { buildStoryPlan, refreshTakeawaysForOutline } from './_news-writer-planner.js';
import { buildArticleOutline } from './_news-writer-outline.js';
import {
  initFactUsageLedger,
  assignFactsToStories,
  assignFactsToOutlineSections,
  getLedgerCoverageSummary,
  getUnusedCriticalFacts,
  getUnusedFactDiagnostics,
  getExcludedPlanningFacts,
} from './_news-writer-ledger.js';
import { computePackageFingerprint, deterministicOperationId } from './_news-writer-fingerprint.js';
import { prepareFactsForPlanning } from './_news-writer-fact-quality.js';
import { buildRequiredRecapFacts } from './_news-writer-required-recap.js';
import {
  injectRequiredFactsIntoOutline,
  assignOrphanFactsToOutline,
  evaluateCoverageTargets,
} from './_news-writer-section-assign.js';

/**
 * Phase 3a — deterministic planning only (no OpenAI).
 */
export function buildDeterministicArticlePlan({
  racePackage,
  seasonId,
  raceNumber,
  articleType = 'race-recap',
  articleDepth = 'medium',
  driverLookup = null,
}) {
  const fingerprint = computePackageFingerprint(racePackage, seasonId, raceNumber);
  const operationId = deterministicOperationId(fingerprint, articleDepth);

  const preparedFacts = prepareFactsForPlanning(racePackage, driverLookup);
  const requiredRecap = buildRequiredRecapFacts(preparedFacts);

  let storyPlan = buildStoryPlan({
    racePackage,
    preparedFacts,
    seasonId,
    raceNumber,
    articleType,
    articleDepth,
    operationId,
    driverLookup,
    requiredRecap,
  });

  let outline = buildArticleOutline({ storyPlan, articleType, articleDepth });
  outline = injectRequiredFactsIntoOutline(outline, requiredRecap);
  outline = assignOrphanFactsToOutline(outline, preparedFacts);

  storyPlan = refreshTakeawaysForOutline(storyPlan, preparedFacts, articleDepth, outline);

  let ledger = initFactUsageLedger(preparedFacts, { operationId, packageFingerprint: fingerprint });
  ledger = assignFactsToStories(ledger, storyPlan);
  ledger = assignFactsToOutlineSections(ledger, outline);

  const ledgerCoverage = getLedgerCoverageSummary(ledger);
  const coverageTargets = evaluateCoverageTargets(ledgerCoverage, storyPlan.articleDepth, requiredRecap);

  return {
    phase: '3a-deterministic-planning',
    operationId,
    storyPlan,
    outline,
    factUsageLedger: ledger,
    ledgerCoverage,
    coverageTargets,
    unusedCriticalFacts: getUnusedCriticalFacts(ledger),
    unusedFactDiagnostics: getUnusedFactDiagnostics(ledger),
    excludedPlanningFacts: getExcludedPlanningFacts(ledger),
    requiredRecap: {
      items: requiredRecap.items,
      missingRequired: requiredRecap.missingRequired,
      requiredCoveragePercent: coverageTargets.requiredRecapPercent,
    },
  };
}
