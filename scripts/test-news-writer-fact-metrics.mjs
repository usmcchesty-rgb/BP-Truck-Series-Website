import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FACT_DIAGNOSTIC,
  applyFactGroundingValidationGuard,
  summarizeFactLedgerMetrics,
  summarizeTakeawayCoverage,
} from '../api/_news-writer-fact-metrics.js';
import { computePackageFingerprint } from '../api/_news-writer-fingerprint.js';
import { validateMultipassDraft } from '../api/_news-writer-multipass-validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const fakeOutline = {
  sections: [
    { sectionId: 'introduction', title: 'Introduction' },
    { sectionId: 'race_summary', title: 'Race Summary' },
  ],
};

const fakeStoryPlan = {
  articleDepth: 'in-depth',
  articleType: 'race-recap',
  readerTakeaways: [
    { takeawayId: 't1', label: 'Justin Levine won after starting 25th' },
    { takeawayId: 't2', label: 'Six cautions shaped the race strategy' },
  ],
};

const longBody =
  'Justin Levine won after starting 25th. Six cautions shaped the race strategy. '.repeat(40);

{
  // A) no facts available
  const metrics = summarizeFactLedgerMetrics({
    articleType: 'race-recap',
    ledgerSnapshot: { totalFacts: 0, factsUsed: 0, criticalTotal: 0, criticalUsed: 0 },
    sectionDrafts: [],
    takeaways: [],
    body: '',
  });
  assert.equal(metrics.factsAvailable, 0);
  assert.equal(metrics.factsUsed, 0);
  assert.equal(metrics.factsVerified, 0);
  assert.equal(metrics.criticalCoveragePercent, null);
  assert.equal(metrics.takeawayCoveragePercent, null);
  assert.equal(metrics.diagnosticCode, FACT_DIAGNOSTIC.FACTS_UNAVAILABLE);
}

{
  // B) facts available, none verified
  const metrics = summarizeFactLedgerMetrics({
    articleType: 'race-recap',
    ledgerSnapshot: { totalFacts: 55, factsUsed: 0, criticalTotal: 10, criticalUsed: 0 },
    sectionDrafts: [],
    takeaways: [{ takeawayId: 't1', label: 'Driver won race' }],
    body: 'No matching takeaway tokens here.',
  });
  assert.equal(metrics.factsAvailable, 55);
  assert.equal(metrics.factsVerified, 0);
  assert.equal(metrics.criticalCoveragePercent, 0);
  assert.equal(metrics.diagnosticCode, FACT_DIAGNOSTIC.FACT_VERIFICATION_FAILED);

  const guard = applyFactGroundingValidationGuard({
    articleType: 'race-recap',
    factMetrics: metrics,
    validationScore: 92,
  });
  assert.equal(guard.guarded, true);
  assert.equal(guard.validationScore <= 59, true);
  assert.equal(guard.diagnosticCode, FACT_DIAGNOSTIC.FACT_VERIFICATION_FAILED);
}

{
  // C) facts available, partial usage
  const metrics = summarizeFactLedgerMetrics({
    articleType: 'race-recap',
    ledgerSnapshot: { totalFacts: 20, factsUsed: 7, criticalTotal: 8, criticalUsed: 3 },
    sectionDrafts: [],
    takeaways: [],
    body: '',
  });
  assert.equal(metrics.factsUsed, 7);
  assert.equal(metrics.criticalCoveragePercent, 37.5);
}

{
  // D) all critical facts used
  const metrics = summarizeFactLedgerMetrics({
    articleType: 'race-recap',
    ledgerSnapshot: { totalFacts: 20, factsUsed: 10, criticalTotal: 5, criticalUsed: 5 },
    sectionDrafts: [],
    takeaways: [],
    body: '',
  });
  assert.equal(metrics.criticalCoveragePercent, 100);
}

{
  // E/F) takeaway denominator behavior
  const none = summarizeTakeawayCoverage('', []);
  assert.equal(none.percent, null);
  assert.equal(none.available, 0);

  const all = summarizeTakeawayCoverage(
    'Justin Levine won after starting 25th. Six cautions shaped the race strategy.',
    fakeStoryPlan.readerTakeaways,
  );
  assert.equal(all.available, 2);
  assert.equal(all.covered, 2);
  assert.equal(all.percent, 100);
}

{
  // Validation guard integration.
  const validation = validateMultipassDraft({
    editedArticle: { body: longBody, summary: 'Recap' },
    headlinePack: { headline: 'Race recap headline', subheadline: '' },
    storyPlan: fakeStoryPlan,
    requiredRecap: { items: [], missingRequired: [] },
    ledgerSnapshot: { totalFacts: 55, factsUsed: 0, criticalTotal: 9, criticalUsed: 0, criticalCoveragePercent: 0 },
    coverageTargets: { targets: { critical: 85 } },
    allowedDriverNames: ['Justin Levine'],
    sectionDrafts: [],
    outline: fakeOutline,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.factGroundingGuard?.diagnosticCode, FACT_DIAGNOSTIC.FACT_VERIFICATION_FAILED);
  assert.equal(validation.validationScore <= 59, true);
}

{
  // Fingerprint immutability check against fact metrics adapters.
  const pkg = JSON.parse(JSON.stringify(fixture));
  const before = computePackageFingerprint(pkg, '27987', 17);
  summarizeFactLedgerMetrics({
    articleType: 'race-recap',
    racePackage: pkg,
    preparedFacts: pkg.facts || [],
    ledgerSnapshot: { totalFacts: (pkg.facts || []).length, factsUsed: 3, criticalTotal: 1, criticalUsed: 1 },
    sectionDrafts: [{ usedFactIds: ['a', 'b', 'c'] }],
    takeaways: fakeStoryPlan.readerTakeaways,
    body: longBody,
  });
  const after = computePackageFingerprint(pkg, '27987', 17);
  assert.equal(before, after);
}

console.log('test-news-writer-fact-metrics.mjs: all checks passed');
