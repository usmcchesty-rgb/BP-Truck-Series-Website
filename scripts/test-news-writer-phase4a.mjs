/**
 * Phase 4a — deterministic depth enforcement (no OpenAI).
 */
import assert from 'node:assert/strict';
import {
  MULTIPASS_DEPTH_PROFILES,
  getMultipassDepthProfile,
  prepareSectionForDepthWrite,
  expandSectionFactIdsForDepth,
  buildDepthValidation,
  buildDepthComplianceReport,
  compareDepthProfilesOrdering,
  resolveEditorMaxTokens,
} from '../api/_news-writer-depth-enforcement.js';
import {
  shouldUseDeterministicEditorStitch,
  validationRequiresDepthRepair,
} from '../api/_news-writer-pipeline-diagnostics.js';
import { validateMultipassDraft } from '../api/_news-writer-multipass-validation.js';
import { buildDeterministicArticlePlan } from '../api/_news-writer-deterministic-plan.js';
import { prepareFactsForPlanning } from '../api/_news-writer-fact-quality.js';
import { NEWS_WRITER_PLANNER_VERSION } from '../api/_news-writer-config.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const preparedFacts = prepareFactsForPlanning(fixture, fixture.planningDriverLookup);

const order = compareDepthProfilesOrdering();
assert.equal(order.ordered, true, 'Short < Medium < Long word targets');
assert.ok(order.medium > order.short);
assert.ok(order.long > order.medium);

const shortFacts = getMultipassDepthProfile('short').factRange.target;
const medFacts = getMultipassDepthProfile('medium').factRange.target;
const longFacts = getMultipassDepthProfile('in-depth').factRange.target;
assert.ok(shortFacts < medFacts && medFacts < longFacts, 'evidence targets scale with depth');

const plan = buildDeterministicArticlePlan({
  racePackage: fixture,
  seasonId: '27987',
  raceNumber: 17,
  articleDepth: 'medium',
  driverLookup: fixture.planningDriverLookup,
});
assert.equal(plan.storyPlan.plannerVersion, NEWS_WRITER_PLANNER_VERSION);

const section = plan.outline.sections.find((s) => s.sectionId === 'battle_for_win');
const enriched = prepareSectionForDepthWrite(section, 'medium', preparedFacts);
assert.ok(enriched.targetWords >= 120, 'medium battle section gets deterministic word budget');
assert.ok((enriched.evidence.factIds || []).length >= 6, 'medium battle expands verified facts');
assert.ok(enriched.depthMaxFacts >= 6);

const expanded = expandSectionFactIdsForDepth(section, preparedFacts, 'medium');
assert.ok(expanded.length >= section.evidence.factIds.length);

const shallowBody = 'Justin Levine won from deep in the field after a long day at Homestead.'.repeat(8);
const shallowValidation = validateMultipassDraft({
  editedArticle: { body: shallowBody, summary: 'Recap' },
  headlinePack: { headline: 'Levine Wins', subheadline: '' },
  storyPlan: plan.storyPlan,
  requiredRecap: plan.requiredRecap,
  ledgerSnapshot: { criticalCoveragePercent: 80, factsUsed: 14 },
  coverageTargets: plan.coverageTargets,
  sectionDrafts: [{ sectionId: 'introduction', usedFactIds: ['a', 'b'], wordCount: 40, sectionText: 'x' }],
  outline: plan.outline,
});
assert.ok(shallowValidation.depthValidation?.scorePenalty > 0);
assert.ok(
  shallowValidation.errors.some((e) => e.type === 'depth_words_low') ||
    shallowValidation.depthValidation.checks.some((c) => c.id === 'depth_words_low' && !c.ok)
);

let factCounter = 0;
const denseSections = plan.outline.sections.map((s) => {
  const prep = prepareSectionForDepthWrite(s, 'medium', preparedFacts);
  const factCount = Math.min(prep.depthMaxFacts || 4, 7);
  return {
    sectionId: s.sectionId,
    usedFactIds: Array.from({ length: factCount }, () => `used-fact-${factCounter++}`),
    wordCount: prep.writingBrief.depthEnforcement.wordTarget,
    sectionText: 'word '.repeat(prep.writingBrief.depthEnforcement.wordTarget),
  };
});
const denseBody = denseSections.map((s) => s.sectionText).join('\n\n');
const denseVal = buildDepthValidation({
  articleDepth: 'medium',
  body: denseBody,
  sectionDrafts: denseSections,
  outline: plan.outline,
  ledgerSnapshot: { factsUsed: 32 },
});
assert.ok(shallowValidation.depthRepairRequired === true);
assert.ok(validationRequiresDepthRepair(shallowValidation));
assert.ok(!shallowValidation.ok);

assert.ok(
  shouldUseDeterministicEditorStitch({
    articleDepth: 'medium',
    sectionDrafts: denseSections.map((s) => ({ ...s, sectionText: s.sectionText })),
    editedBody: shallowBody,
  }),
  'stitch when drafts meet material threshold but editor body below floor'
);

assert.ok(denseVal.depthCompliance.actual.words >= 700);
assert.ok(denseVal.depthCompliance.actual.facts >= 20);

assert.ok(resolveEditorMaxTokens('medium') > resolveEditorMaxTokens('short'));

const report = buildDepthComplianceReport({
  articleDepth: 'medium',
  body: shallowBody,
  sectionDrafts: [],
  outline: plan.outline,
  ledgerSnapshot: { factsUsed: 14 },
});
assert.ok(report.overallDepthScore < 50);

console.log('Phase 4a depth enforcement tests passed.');
