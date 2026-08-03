/**
 * Phase 3b multi-pass writer — mocked OpenAI, fixture package, no Supabase.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { isNewsWriterMultipassEnabled, runMultipassWriterPipeline } from '../api/_news-writer-orchestrator.js';
import { buildDeterministicArticlePlan } from '../api/_news-writer-deterministic-plan.js';
import { SECTION_WRITE_ORDER } from '../server/config/news-writer-multipass-config.js';
import { applySectionDraftToLedger, cloneLedger } from '../api/_news-writer-ledger-writer.js';
import { validateMultipassDraft } from '../api/_news-writer-multipass-validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const racePackage = { ...fixture, facts: fixture.facts };
const driverLookup = fixture.planningDriverLookup;

const prevFlag = process.env.NEWS_WRITER_MULTIPASS_ENABLED;
process.env.NEWS_WRITER_MULTIPASS_ENABLED = 'true';

assert.equal(isNewsWriterMultipassEnabled(), true);

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
assert.ok(sectionIdsInOrder.length >= 3, 'outline has ordered sections');

function sectionMock(sectionId, factIds) {
  return {
    sectionText: `Section ${sectionId} covering verified race evidence with professional tone.`,
    usedFactIds: factIds.slice(0, 2),
    usedCanonicalIds: [],
    sectionSummary: `Summary for ${sectionId}`,
    entitiesIntroduced: ['Justin Levine'],
    tone: 'newsroom',
  };
}

const mockResponses = [];
for (const sid of sectionIdsInOrder) {
  const section = plan.outline.sections.find((s) => s.sectionId === sid);
  mockResponses.push(sectionMock(sid, section.evidence.factIds));
}
const longBody =
  'Justin Levine won after starting 25th. Six cautions shaped the race. Championship margin tightened. Pit strategy influenced the final outcome. Justin Levine earned third victory of the season. Chris Carroll gained points momentum. '.repeat(
    35
  );

mockResponses.push({
  headline: 'Placeholder',
  subheadline: 'Placeholder sub',
  summary: 'Justin Levine won after starting 25th. Six cautions shaped the race.',
  body: longBody,
  rewriteSectionId: null,
});
mockResponses.push({
  headline: 'Justin Levine Wins From Deep in the Field',
  subheadline: 'Championship battle tightens after Race 17',
  seoDescription: 'Recap of Race 17 with winner, cautions, and points impact.',
  socialTeaser: 'Levine wins from P25; title fight heats up.',
});
// spare if bounded repair runs
mockResponses.push(sectionMock(sectionIdsInOrder[0], plan.outline.sections[0].evidence.factIds));
mockResponses.push({
  headline: 'Placeholder',
  subheadline: 'Placeholder sub',
  summary: 'Repair pass summary.',
  body: longBody,
  rewriteSectionId: null,
});
mockResponses.push({
  headline: 'Justin Levine Wins From Deep in the Field',
  subheadline: 'Championship battle tightens after Race 17',
  seoDescription: 'Recap of Race 17.',
  socialTeaser: 'Levine wins from P25.',
});

const responseQueue = [...mockResponses];
const callOpenAi = async () => {
  const next = responseQueue.shift();
  if (!next) throw new Error('Mock OpenAI queue exhausted');
  return {
    parsed: next,
    usage: { promptTokens: 10, completionTokens: 12, totalTokens: 22 },
    model: 'mock',
    elapsedMs: 1,
  };
};

const pipeline = await runMultipassWriterPipeline({
  seasonId: '27987',
  raceNumber: 17,
  articleDepth: 'medium',
  driverLookup,
  racePackageOverride: racePackage,
  callOpenAi,
  previewOnly: true,
  forceRun: true,
});

assert.equal(pipeline.generatedSections.length, sectionIdsInOrder.length);
assert.equal(
  pipeline.generatedSections.map((s) => s.sectionId).join(','),
  sectionIdsInOrder.join(',')
);
assert.ok(pipeline.article.body.length > 100);
assert.ok(pipeline.headlinePack.headline.includes('Levine'));
assert.ok(pipeline.validation);
assert.ok(pipeline.openAiUsage.calls >= sectionIdsInOrder.length + 2);

let ledger = cloneLedger(plan.factUsageLedger);
for (const draft of pipeline.generatedSections) {
  applySectionDraftToLedger(ledger, draft);
}
assert.ok(Object.values(ledger.facts).some((e) => e.status === 'used'), 'ledger marks used facts');

const validation = validateMultipassDraft({
  editedArticle: { body: longBody, summary: longBody.slice(0, 200), headline: 'Justin Levine Wins' },
  headlinePack: { headline: 'Justin Levine Wins', subheadline: 'Test' },
  storyPlan: plan.storyPlan,
  requiredRecap: plan.requiredRecap,
  ledgerSnapshot: { criticalCoveragePercent: 90 },
  coverageTargets: plan.coverageTargets,
  allowedDriverNames: ['Justin Levine', 'Chris Carroll'],
});
assert.ok(typeof validation.ok === 'boolean');

const legacySrc = readFileSync(join(__dirname, '../api/_news-generator.js'), 'utf8');
assert.ok(!legacySrc.includes('_news-writer-orchestrator'), 'legacy generator not wired to multipass');

process.env.NEWS_WRITER_MULTIPASS_ENABLED = prevFlag;
assert.equal(isNewsWriterMultipassEnabled(), prevFlag === 'true');

console.log('test-news-writer-phase3b.mjs: all tests passed');
console.log('Sections written:', pipeline.generatedSections.length);
console.log('OpenAI calls (mock):', pipeline.openAiUsage.calls);
