/**
 * Checkpointed writer run engine — in-memory repo, mock OpenAI, no Supabase, no paid APIs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  advanceWriterRun,
  buildMultipassStepQueue,
  createInitialCheckpoint,
  verifyRunPackageFingerprint,
} from '../api/_news-writer-run-engine.js';
import { buildDeterministicArticlePlan } from '../api/_news-writer-deterministic-plan.js';
import { prepareFactsForPlanning } from '../api/_news-writer-fact-quality.js';
import { computePackageFingerprint } from '../api/_news-writer-fingerprint.js';
import { estimateWriterRunFromPlan } from '../api/_news-writer-cost-estimate.js';
import { SECTION_WRITE_ORDER } from '../server/config/news-writer-multipass-config.js';
import { isNewsWriterMultipassEnabled } from '../api/_news-writer-orchestrator.js';
import { writeArticleSection } from '../api/_news-writer-section-writer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const racePackage = { ...fixture, facts: fixture.facts };
const driverLookup = fixture.planningDriverLookup;

const plan = buildDeterministicArticlePlan({
  racePackage,
  seasonId: '27987',
  raceNumber: 17,
  articleDepth: 'medium',
  driverLookup,
});

const sectionIdsInOrder = SECTION_WRITE_ORDER.filter((id) =>
  plan.outline.sections.some((s) => s.sectionId === id)
);

function sectionMock(sectionId) {
  return {
    sectionText: `Section ${sectionId} with verified NASCAR truck series evidence.`,
    usedFactIds: ['f1'],
    usedCanonicalIds: [],
    sectionSummary: `Summary ${sectionId}`,
    entitiesIntroduced: ['Justin Levine'],
    tone: 'newsroom',
  };
}

const longBody =
  'Justin Levine won after starting 25th. Six cautions shaped the race. Championship margin tightened. '.repeat(40);

const mockQueue = [];
for (const sid of sectionIdsInOrder) mockQueue.push(sectionMock(sid));
mockQueue.push({
  headline: 'H',
  subheadline: 'S',
  summary: 'Justin Levine won after starting 25th.',
  body: longBody,
  rewriteSectionId: null,
});
mockQueue.push({
  headline: 'Justin Levine Wins From Deep in the Field',
  subheadline: 'Title fight tightens',
  seoDescription: 'Recap',
  socialTeaser: 'Win',
});
for (const sid of sectionIdsInOrder) mockQueue.push(sectionMock(sid));
mockQueue.push({
  headline: 'H',
  subheadline: 'S',
  summary: 'Justin Levine won after starting 25th.',
  body: longBody,
  rewriteSectionId: null,
});
mockQueue.push({
  headline: 'Justin Levine Wins From Deep in the Field',
  subheadline: 'Title fight tightens',
  seoDescription: 'Recap',
  socialTeaser: 'Win',
});

const callOpenAi = async () => {
  const next = mockQueue.shift();
  if (!next) throw new Error('mock queue exhausted');
  return {
    parsed: next,
    usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    model: 'mock',
    elapsedMs: 1,
  };
};

const fingerprint = computePackageFingerprint(racePackage, '27987', 17);
const stepQueue = buildMultipassStepQueue(plan.outline);
const checkpoint = createInitialCheckpoint({
  planResult: plan,
  runType: 'multipass_preview',
  stepQueue,
});

let run = {
  id: 'test-run-1',
  runType: 'multipass_preview',
  status: 'running',
  seasonId: '27987',
  raceNumber: 17,
  articleType: 'race-recap',
  articleDepth: 'medium',
  packageFingerprint: fingerprint,
  checkpoint,
};

const loadRunPackageContextFn = async () => ({
  racePackage,
  planResult: plan,
  fingerprint,
  preparedFacts: prepareFactsForPlanning(racePackage, driverLookup),
  driverLookup,
});

const persistRun = async (patch) => {
  run = { ...run, ...patch, checkpoint: patch.checkpoint ?? run.checkpoint };
  return run;
};

let openAiCalls = 0;
let maxTickCalls = 0;

while (run.status === 'running' || run.status === 'partial') {
  const tick = await advanceWriterRun(run, {
    persistRun,
    loadRunPackageContextFn,
    callOpenAi,
    writeArticleSectionFn: (opts) => writeArticleSection({ ...opts, callOpenAi }),
  });
  run = tick.run;
  maxTickCalls = Math.max(maxTickCalls, tick.tickOpenAiCalls || 0);
  openAiCalls += tick.tickOpenAiCalls || 0;
  if (tick.done || tick.stale) break;
}

assert.ok(maxTickCalls <= 2, `bounded OpenAI per request (max ${maxTickCalls})`);

assert.equal(run.status, 'complete', `expected complete, got ${run.status}`);
assert.ok(run.result, 'completed run should store result payload');
assert.ok(openAiCalls >= sectionIdsInOrder.length + 2, 'expected section+editor+headline calls');

const sectionStepCounts = {};
for (const s of run.checkpoint.completedSteps || []) {
  if (s.startsWith('section:')) sectionStepCounts[s] = (sectionStepCounts[s] || 0) + 1;
}
for (const sid of sectionIdsInOrder) {
  assert.equal(sectionStepCounts[`section:${sid}`] || 0, 1, `initial section ${sid} should run once`);
}

const stale = verifyRunPackageFingerprint({ storedFingerprint: fingerprint, liveFingerprint: 'deadbeef' });
assert.equal(stale.ok, false);

const estimate = estimateWriterRunFromPlan({ outline: plan.outline, articleDepth: 'medium' });
assert.ok(estimate.expectedOpenAiCalls >= sectionIdsInOrder.length + 2);
assert.ok(estimate.estimatedCostUsd >= 0);

assert.equal(isNewsWriterMultipassEnabled(), false, 'production multipass flag stays false by default');

console.log('test-news-writer-runs.mjs: all tests passed');
console.log('OpenAI mock calls:', openAiCalls);
console.log('Steps:', run.checkpoint.completedSteps.length);
