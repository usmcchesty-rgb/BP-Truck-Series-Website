/**
 * Shadow mode — comparison metrics and identical-package wiring (mocked generators).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  buildComparisonMetrics,
  buildArticleDifferences,
  runWriterShadowComparison,
  takeawayCoverageScore,
} from '../api/_news-writer-shadow.js';
import { isNewsWriterMultipassEnabled, isNewsWriterShadowModeEnabled } from '../server/config/news-writer-multipass-config.js';
import { computePackageFingerprint } from '../api/_news-writer-fingerprint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json'), 'utf8')
);
const racePackage = { ...fixture, facts: fixture.facts };

assert.equal(isNewsWriterMultipassEnabled(), false);
assert.equal(isNewsWriterShadowModeEnabled(), false);

const fp = computePackageFingerprint(racePackage, '27987', 17);

const legacyMock = {
  article: {
    headline: 'Legacy Headline',
    body: 'Justin Levine won after starting 25th. Six cautions shaped the race. Championship margin tightened.',
  },
  validation: { valid: true, warnings: [] },
  promptSize: { totalEstimatedTokens: 12000 },
  repairAttempts: 1,
  generationTimeMs: 5000,
  intelligenceDiagnostics: { pinned: true, packageFingerprint: fp },
};

const multiMock = {
  article: {
    headline: 'Multipass Headline',
    body: 'Justin Levine won after starting 25th. Six cautions shaped the race. Championship margin tightened. Pit strategy influenced the final outcome.',
  },
  validation: { ok: true, errors: [], warnings: [] },
  openAiUsage: { calls: 10, promptTokens: 8000, completionTokens: 2200, elapsedMs: 12000 },
  ledgerCoverageAfterWrite: { criticalCoveragePercent: 92, factsUsed: 8, totalFacts: 13 },
  generatedSections: [{}, {}, {}, {}, {}, {}, {}, {}],
  repairAttempted: false,
  deterministicPlan: { storyPlan: { readerTakeaways: [{ label: 'Justin Levine won after starting 25th' }] } },
};

const metrics = buildComparisonMetrics({
  legacyResult: legacyMock,
  multipassResult: multiMock,
  packageFingerprint: fp,
  storyPlan: multiMock.deterministicPlan.storyPlan,
});
assert.ok(metrics.legacy.wordCount > 0);
assert.ok(metrics.multipass.sectionCount === 8);
assert.ok(metrics.multipass.estimatedCostUsd >= 0);

const diffs = buildArticleDifferences({
  legacyArticle: legacyMock.article,
  multipassArticle: multiMock.article,
  storyPlan: multiMock.deterministicPlan.storyPlan,
  legacyValidation: legacyMock.validation,
  multipassValidation: multiMock.validation,
});
assert.equal(diffs.headlineDiff.changed, true);

const cov = takeawayCoverageScore(multiMock.article.body, [
  { label: 'Justin Levine won after starting 25th' },
  { label: 'Six cautions shaped the race' },
]);
assert.ok(cov >= 50);

const shadow = await runWriterShadowComparison({
  seasonId: '27987',
  raceNumber: 17,
  articleDepth: 'medium',
  racePackageOverride: racePackage,
  legacyGenerator: async (opts) => {
    assert.equal(opts.pinnedPackageFingerprint, fp);
    assert.ok(String(opts.pinnedIntelligencePromptBlock || '').includes('Race Intelligence'));
    assert.equal(opts.skipIntelligenceAutoLoad, true);
    return { ...legacyMock };
  },
  multipassRunner: async (opts) => {
    assert.equal(opts.racePackageOverride, racePackage);
    assert.equal(opts.forceRun, true);
    return { ...multiMock };
  },
});

assert.equal(shadow.packageFingerprint, fp);
assert.equal(shadow.legacy.intelligenceDiagnostics?.packageFingerprint, fp);
assert.ok(shadow.differences.headlineDiff.changed);

console.log('test-news-writer-shadow.mjs: all tests passed');
