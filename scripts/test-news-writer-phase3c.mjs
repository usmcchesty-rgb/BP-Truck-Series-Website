/**
 * Phase 3c fact verification — deterministic only, no OpenAI.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  buildFactVerificationReport,
  sanitizeWriterText,
  sanitizeHeadlinePack,
  buildFactCorrectnessValidation,
} from '../api/_news-writer-fact-verification.js';
import { prepareFactsForPlanning } from '../api/_news-writer-fact-quality.js';
import { validateMultipassDraft } from '../api/_news-writer-multipass-validation.js';
import { applyVerificationToSectionEvidence } from '../api/_news-writer-fact-verification.js';
import { buildDeterministicArticlePlan } from '../api/_news-writer-deterministic-plan.js';
import { NEWS_WRITER_PLANNER_VERSION } from '../api/_news-writer-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const baseFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const conflictFacts = [
  ...baseFixture.facts,
  {
    id: 'fact-carroll-761-official',
    factType: 'championship',
    category: 'standings_snapshot',
    summary: 'Chris Carroll has 761 championship points after Race 17.',
    driverIds: ['99'],
    driverNames: ['Chris Carroll'],
    importanceScore: 90,
    confidence: 'official',
    structuredData: { points: 761, position: 1 },
    canonicalFactId: 'can-champ-points-carroll',
    primarySourceType: 'official_standings',
  },
  {
    id: 'fact-carroll-782-derived',
    factType: 'championship',
    category: 'points_leader',
    summary: 'Chris Carroll leads with 782 points.',
    driverIds: ['99'],
    driverNames: ['Chris Carroll'],
    importanceScore: 55,
    confidence: 'derived',
    structuredData: { points: 782, position: 1 },
    canonicalFactId: 'can-champ-points-carroll',
    primarySourceType: 'other',
  },
];

const racePackage = { ...baseFixture, facts: conflictFacts };
const driverLookup = baseFixture.planningDriverLookup;
const preparedFacts = prepareFactsForPlanning(racePackage, driverLookup);

const report = buildFactVerificationReport({ racePackage, preparedFacts });
assert.ok(report.canonicalIssues.length >= 1, 'expected canonical conflict');
assert.ok(report.suppressedFactIds.includes('fact-carroll-782-derived'));
assert.ok(report.suppressedNumericTokens.includes('782'));
assert.equal(report.verifiedCategories.championship, false);
assert.ok(report.repairSuggestions.length >= 1);

const sanitized = sanitizeWriterText('Carroll now leads with 782 points after Homestead.', report);
assert.ok(!sanitized.includes('782'), 'disputed points stripped from prose');

const headline = sanitizeHeadlinePack(
  { headline: 'Carroll leads with 782 points', subheadline: 'Title fight' },
  report
);
assert.ok(!headline.headline.includes('782'), 'headline must not keep disputed number');

const evidence = {
  facts: [
    { factId: 'fact-carroll-761-official', summary: '761' },
    { factId: 'fact-carroll-782-derived', summary: '782' },
  ],
};
const filtered = applyVerificationToSectionEvidence(evidence, report);
assert.equal(filtered.facts.length, 1);
assert.ok(filtered.factVerificationGuidance.suppressedNumericTokens.includes('782'));

const validation = validateMultipassDraft({
  editedArticle: { body: 'Carroll retained the championship lead after Homestead.', summary: 'Recap' },
  headlinePack: { headline: 'Carroll Keeps Title Lead', subheadline: 'After Homestead' },
  storyPlan: { articleDepth: 'medium', readerTakeaways: [], leadStoryId: 'winner_story' },
  requiredRecap: { items: [] },
  ledgerSnapshot: { criticalCoveragePercent: 90 },
  coverageTargets: { targets: { critical: 85 } },
  factVerification: report,
});
assert.ok(validation.factCorrectness);
assert.ok(validation.validationScore != null);
const badBody = validateMultipassDraft({
  editedArticle: { body: 'Carroll has 782 points.', summary: 'x' },
  headlinePack: { headline: 'Lead', subheadline: '' },
  storyPlan: { articleDepth: 'medium', readerTakeaways: [], leadStoryId: null },
  requiredRecap: { items: [] },
  ledgerSnapshot: {},
  coverageTargets: { targets: { critical: 85 } },
  factVerification: report,
});
assert.ok(
  badBody.factCorrectness.checks.some((c) => c.id === 'unsupported_stat_in_body' && !c.ok)
);

const plan = buildDeterministicArticlePlan({
  racePackage: baseFixture,
  seasonId: '27987',
  raceNumber: 17,
  articleDepth: 'medium',
  driverLookup,
});
assert.equal(plan.storyPlan.plannerVersion, NEWS_WRITER_PLANNER_VERSION);
assert.equal(NEWS_WRITER_PLANNER_VERSION, '1.2.0');

const fc = buildFactCorrectnessValidation(report, { body: 'safe', headline: 'safe' });
assert.ok(fc.checks.some((c) => c.id === 'championship_verified'));

console.log('test-news-writer-phase3c.mjs: all tests passed');
console.log('Canonical issues:', report.canonicalIssues.length);
console.log('Suppressed tokens:', report.suppressedNumericTokens.join(', '));
