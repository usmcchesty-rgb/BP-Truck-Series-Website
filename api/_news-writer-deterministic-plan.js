import { buildStoryPlan } from './_news-writer-planner.js';
import { buildArticleOutline } from './_news-writer-outline.js';
import {
  initFactUsageLedger,
  assignFactsToStories,
  assignFactsToOutlineSections,
  getLedgerCoverageSummary,
  getUnusedCriticalFacts,
} from './_news-writer-ledger.js';
import { computePackageFingerprint, deterministicOperationId } from './_news-writer-fingerprint.js';

/**
 * Phase 3a — deterministic planning only (no OpenAI).
 */
export function buildDeterministicArticlePlan({
  racePackage,
  seasonId,
  raceNumber,
  articleType = 'race-recap',
  articleDepth = 'medium',
}) {
  const fingerprint = computePackageFingerprint(racePackage, seasonId, raceNumber);
  const operationId = deterministicOperationId(fingerprint, articleDepth);

  const storyPlan = buildStoryPlan({
    racePackage,
    seasonId,
    raceNumber,
    articleType,
    articleDepth,
    operationId,
  });

  let ledger = initFactUsageLedger(racePackage, { operationId, packageFingerprint: fingerprint });
  ledger = assignFactsToStories(ledger, storyPlan);

  const outline = buildArticleOutline({ storyPlan, articleType, articleDepth });
  ledger = assignFactsToOutlineSections(ledger, outline);

  return {
    phase: '3a-deterministic-planning',
    operationId,
    storyPlan,
    outline,
    factUsageLedger: ledger,
    ledgerCoverage: getLedgerCoverageSummary(ledger),
    unusedCriticalFacts: getUnusedCriticalFacts(ledger),
  };
}
