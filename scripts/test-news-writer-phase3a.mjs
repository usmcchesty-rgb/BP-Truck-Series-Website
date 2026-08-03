/**
 * Phase 3a deterministic article planning tests — zero OpenAI, zero Supabase.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildDeterministicArticlePlan } from '../api/_news-writer-deterministic-plan.js';
import { buildStoryPlan, computeRaceTemperature } from '../api/_news-writer-planner.js';
import { NEWS_WRITER_PLANNER_VERSION } from '../api/_news-writer-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const racePackage = JSON.parse(readFileSync(fixturePath, 'utf8'));

const SEASON = '27987';
const RACE = 17;

function stableSnapshot(planResult) {
  return JSON.stringify({
    operationId: planResult.operationId,
    fingerprint: planResult.storyPlan.packageFingerprint,
    leadStoryId: planResult.storyPlan.leadStoryId,
    temperature: planResult.storyPlan.raceTemperature,
    takeawayIds: planResult.storyPlan.readerTakeaways.map((t) => t.takeawayId),
    storyIds: planResult.storyPlan.stories.filter((s) => !s.empty).map((s) => s.storyId),
    outlineSections: planResult.outline.sections.map((s) => s.sectionId),
    coverage: planResult.ledgerCoverage,
  });
}

const run1 = buildDeterministicArticlePlan({
  racePackage,
  seasonId: SEASON,
  raceNumber: RACE,
  articleDepth: 'medium',
});
const run2 = buildDeterministicArticlePlan({
  racePackage,
  seasonId: SEASON,
  raceNumber: RACE,
  articleDepth: 'medium',
});

assert.equal(stableSnapshot(run1), stableSnapshot(run2), 'Race 17 fixture must be deterministic');
assert.equal(run1.operationId, run2.operationId);
assert.equal(run1.storyPlan.plannerVersion, NEWS_WRITER_PLANNER_VERSION);

const lead = run1.storyPlan.stories.find((s) => s.storyId === 'lead_story');
assert.ok(lead && !lead.empty);
assert.ok(lead.factIds.length > 0);

assert.ok(run1.storyPlan.raceTemperature.primary);
assert.ok(run1.storyPlan.raceTemperature.confidence >= 40);
assert.ok(run1.storyPlan.readerTakeaways.length > 0);

assert.ok(run1.outline.sections.length >= 3);
assert.ok(run1.ledgerCoverage.totalFacts === racePackage.facts.length);
assert.ok(run1.ledgerCoverage.coveragePercent > 0);

const temp = computeRaceTemperature(racePackage.facts);
assert.ok(temp.primary === 'chaotic' || temp.primary === 'championship_defining' || temp.primary === 'competitive');

const shortPlan = buildStoryPlan({
  racePackage,
  seasonId: SEASON,
  raceNumber: RACE,
  articleDepth: 'short',
  operationId: 'test-short',
});
assert.ok(shortPlan.readerTakeaways.length <= 3);

console.log('test-news-writer-phase3a.mjs: all tests passed');
console.log('Race 17 sample operationId (medium):', run1.operationId);
console.log('Race 17 temperature:', run1.storyPlan.raceTemperature.primary, run1.storyPlan.raceTemperature.secondary);
console.log('Race 17 outline sections:', run1.outline.sections.map((s) => s.sectionId).join(', '));
