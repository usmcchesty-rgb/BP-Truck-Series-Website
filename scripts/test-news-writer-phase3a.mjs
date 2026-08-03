/**
 * Phase 3a deterministic article planning tests — zero OpenAI, zero Supabase.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildDeterministicArticlePlan } from '../api/_news-writer-deterministic-plan.js';
import { buildStoryPlan, computeRaceTemperature } from '../api/_news-writer-planner.js';
import { prepareFactsForPlanning } from '../api/_news-writer-fact-quality.js';
import { NEWS_WRITER_PLANNER_VERSION } from '../api/_news-writer-config.js';
import { ARTICLE_DEPTH_WORD_RANGES } from '../server/config/race-research-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const racePackage = { ...fixture, facts: fixture.facts };
const driverLookup = fixture.planningDriverLookup;

const SEASON = '27987';
const RACE = 17;

function stableSnapshot(planResult) {
  return JSON.stringify({
    operationId: planResult.operationId,
    fingerprint: planResult.storyPlan.packageFingerprint,
    leadWinner: planResult.storyPlan.plannerDiagnostics?.leadWinner,
    temperature: planResult.storyPlan.raceTemperature?.primary,
    tempConfidence: planResult.storyPlan.raceTemperature?.confidence,
    takeawayLabels: planResult.storyPlan.readerTakeaways.map((t) => t.label),
    outlineWords: planResult.outline.sections.map((s) => s.targetWords),
    canonicalCritical: planResult.ledgerCoverage?.canonical?.criticalCoveragePercent,
    required: planResult.requiredRecap?.requiredCoveragePercent,
  });
}

const run1 = buildDeterministicArticlePlan({
  racePackage,
  seasonId: SEASON,
  raceNumber: RACE,
  articleDepth: 'medium',
  driverLookup,
});
const run2 = buildDeterministicArticlePlan({
  racePackage,
  seasonId: SEASON,
  raceNumber: RACE,
  articleDepth: 'medium',
  driverLookup,
});

assert.equal(stableSnapshot(run1), stableSnapshot(run2), 'Race 17 fixture must be deterministic');
assert.equal(run1.storyPlan.plannerVersion, NEWS_WRITER_PLANNER_VERSION);

const winnerId = 'fact-r17-winner-official';
const ledgerWinner = run1.factUsageLedger.facts[winnerId];
assert.ok(ledgerWinner, 'winner in ledger');
assert.ok(['planned', 'used', 'writing'].includes(ledgerWinner.status), 'official winner must be planned');
assert.ok(
  run1.outline.sections.some((s) => s.evidence.factIds.includes(winnerId)),
  'winner from P25 must appear in outline'
);

const cautionOfficial = 'fact-r17-caution-official';
assert.ok(
  run1.outline.sections.some((s) => s.evidence.factIds.includes(cautionOfficial)),
  'official caution count assigned'
);

const milestoneId = 'fact-r17-milestone';
assert.ok(
  run1.outline.sections.some((s) => s.evidence.factIds.includes(milestoneId)),
  'season-win milestone assigned'
);

const prepared = prepareFactsForPlanning(racePackage, driverLookup);
const tsFrag = prepared.find((f) => f.id === 'fact-r17-fragment-ts');
assert.ok(tsFrag.planningPriorityTier !== 'critical', 'timestamp fragment not critical');
const incFrag = prepared.find((f) => f.id === 'fact-r17-fragment-incomplete');
assert.ok(incFrag.planningPriorityTier !== 'critical', 'incomplete transcript not critical');
const specFrag = prepared.find((f) => f.id === 'fact-r17-fragment-spec');
assert.ok(specFrag.planningPriorityTier !== 'critical', 'speculative quote not critical');

const dup = prepared.find((f) => f.id === 'fact-r17-winner-transcript-dup');
assert.equal(dup.planningPriorityTier, 'supporting', 'canonical duplicate is supporting');

const champFact = prepared.find((f) => f.id === 'fact-r17-champ');
assert.ok(champFact.driverNames.includes('Chris Carroll'), 'Chris Carroll3 resolves to Chris Carroll');
assert.ok(!champFact.driverNames.some((n) => /Carroll3/.test(n)), 'no Carroll3 artifact in planning names');

const takeaways = run1.storyPlan.readerTakeaways;
assert.ok(takeaways.some((t) => /Justin Levine won after starting 25/i.test(t.label)), 'fact-specific winner takeaway');
assert.ok(!takeaways.some((t) => t.label === 'Race outcome defined the day'), 'no generic race outcome takeaway');
assert.ok(!takeaways.some((t) => t.label === 'Driver storyline stood out'), 'no generic driver storyline');

const words = run1.outline.sections.map((s) => s.targetWords);
const uniqueWords = new Set(words);
assert.ok(uniqueWords.size > 1, 'medium word targets are not all equal');
const totalWords = words.reduce((a, b) => a + b, 0);
const range = ARTICLE_DEPTH_WORD_RANGES.medium;
assert.ok(totalWords >= range.minimum && totalWords <= range.maximum + 120, 'total words near medium range');

assert.ok(
  !(run1.storyPlan.rankedDrivers || []).some((d) => /Carroll3|Unknown driver/i.test(d.displayName || '')),
  'ranked drivers use normalized names only'
);
assert.ok(
  !(run1.storyPlan.readerTakeaways || []).some((t) => /Carroll3|Unknown driver/i.test(t.label || '')),
  'takeaways use normalized names only'
);
assert.ok(run1.storyPlan.raceTemperature.confidence <= 99, 'fixture does not hit 100 confidence');

const leadScores = run1.storyPlan.plannerDiagnostics.leadCandidateScores;
assert.ok(
  leadScores.some((c) => /recovery|winner/i.test(c.candidateType)),
  'winner/recovery candidate in lead scoring'
);

assert.equal(run1.requiredRecap.requiredCoveragePercent, 100, 'required recap coverage 100%');

const unusedGenuine = run1.unusedCriticalFacts || [];
assert.ok(
  !unusedGenuine.some((u) => u.factId === winnerId),
  'official winner cannot remain unused critical'
);

const temp = computeRaceTemperature(prepared.filter((f) => f.preferredForPlanning));
assert.ok(temp.diagnostics?.length >= 1, 'temperature diagnostics present');

assert.ok(run1.ledgerCoverage.canonical.criticalCoveragePercent >= 85, 'medium critical canonical coverage target');

const writerModules = [
  '_news-writer-planner.js',
  '_news-writer-deterministic-plan.js',
  '_news-writer-fact-quality.js',
  '_news-writer-ledger.js',
  '_news-writer-outline.js',
  '_news-writer-section-assign.js',
  '_news-writer-required-recap.js',
];
for (const file of writerModules) {
  const src = readFileSync(join(__dirname, '../api', file), 'utf8');
  assert.ok(!/from\s+['"].*openai/i.test(src), `no OpenAI imports in ${file}`);
}

console.log('test-news-writer-phase3a.mjs: all tests passed');
console.log('Race 17 sample operationId (medium):', run1.operationId);
console.log('Temperature:', run1.storyPlan.raceTemperature.primary, run1.storyPlan.raceTemperature.confidence);
console.log('Canonical critical coverage:', run1.ledgerCoverage.canonical.criticalCoveragePercent);
