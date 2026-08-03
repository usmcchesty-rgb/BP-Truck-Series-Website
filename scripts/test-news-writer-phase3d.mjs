/**
 * Phase 3d newsroom intelligence — deterministic only, no OpenAI.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  buildNewsworthinessReport,
  buildNewsworthinessValidation,
  NEWSWORTHINESS_VERSION,
  compactNewsroomGuidanceForPrompt,
} from '../api/_news-writer-newsworthiness.js';
import { buildDeterministicArticlePlan } from '../api/_news-writer-deterministic-plan.js';
import { prepareFactsForPlanning } from '../api/_news-writer-fact-quality.js';
import { buildFactVerificationReport } from '../api/_news-writer-fact-verification.js';
import { validateMultipassDraft } from '../api/_news-writer-multipass-validation.js';
import { NEWS_WRITER_PLANNER_VERSION } from '../api/_news-writer-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/race-intelligence/race-17-planning-fixture.json');
const baseFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const driverLookup = baseFixture.planningDriverLookup;

const SEASON = '27987';
const RACE = 17;

function planFor(pkg) {
  return buildDeterministicArticlePlan({
    racePackage: pkg,
    seasonId: SEASON,
    raceNumber: RACE,
    articleDepth: 'medium',
    driverLookup,
  });
}

const racePackage = { ...baseFixture, facts: baseFixture.facts };
const planResult = planFor(racePackage);
assert.equal(planResult.storyPlan.plannerVersion, NEWS_WRITER_PLANNER_VERSION);
assert.equal(NEWS_WRITER_PLANNER_VERSION, '1.2.0');

const preparedFacts = prepareFactsForPlanning(racePackage, driverLookup);
const factVerification = buildFactVerificationReport({ racePackage, preparedFacts });

const report = buildNewsworthinessReport({
  racePackage,
  preparedFacts,
  storyPlan: planResult.storyPlan,
  requiredRecap: planResult.requiredRecap,
  factVerification,
});

assert.equal(report.version, NEWSWORTHINESS_VERSION);
assert.equal(report.primaryNarrative, 'winner_from_deep_field');
assert.ok(report.overallNewsworthiness >= 70, 'deep-field win should score high');
assert.ok(
  report.secondaryNarratives.includes('championship_implications') ||
    report.classifications.some((c) => c.classificationId === 'championship_implications'),
  'championship impact should be detected for Race 17'
);

const winnerDriver = report.driverStoryImportance[0];
assert.ok(winnerDriver?.driverName?.includes('Levine'), 'winner tops driver importance');
assert.equal(winnerDriver.importance, 100);

const report2 = buildNewsworthinessReport({
  racePackage,
  preparedFacts,
  storyPlan: planResult.storyPlan,
  requiredRecap: planResult.requiredRecap,
  factVerification,
});
assert.equal(JSON.stringify(report), JSON.stringify(report2), 'newsworthiness must be deterministic');

const routinePkg = {
  ...baseFixture,
  facts: [
    {
      id: 'fact-routine-win',
      factType: 'result',
      category: 'winner',
      summary: 'Driver A won from the pole.',
      driverNames: ['Driver A'],
      importanceScore: 90,
      confidence: 'official',
      structuredData: { finishPosition: 1, startPosition: 1, positionsGained: 0 },
    },
    {
      id: 'fact-routine-caution',
      factType: 'caution',
      category: 'caution',
      summary: 'Two cautions.',
      importanceScore: 55,
      confidence: 'official',
      structuredData: { cautionCount: 2 },
    },
  ],
};
const routinePlan = planFor(routinePkg);
const routinePrepared = prepareFactsForPlanning(routinePkg, driverLookup);
const routineReport = buildNewsworthinessReport({
  racePackage: routinePkg,
  preparedFacts: routinePrepared,
  storyPlan: {
    ...routinePlan.storyPlan,
    raceTemperature: { primary: 'routine', secondary: 'routine', confidence: 65 },
  },
  requiredRecap: routinePlan.requiredRecap,
});
assert.ok(
  routineReport.overallNewsworthiness < report.overallNewsworthiness,
  'routine race should rank lower than P25 win'
);
assert.ok(
  routineReport.classifications.some((c) => c.classificationId === 'clean_race' || c.classificationId === 'routine_race'),
  'routine race should classify as lower news value'
);

const historicPkg = {
  ...baseFixture,
  facts: [
    ...baseFixture.facts.filter((f) => f.id === 'fact-r17-winner-official'),
    {
      id: 'fact-historic-record',
      factType: 'historical',
      category: 'record',
      summary: 'Most lead changes ever at Homestead.',
      importanceScore: 95,
      confidence: 'official',
    },
  ],
};
const historicPlan = planFor(historicPkg);
const historicPrepared = prepareFactsForPlanning(historicPkg, driverLookup);
const historicReport = buildNewsworthinessReport({
  racePackage: historicPkg,
  preparedFacts: historicPrepared,
  storyPlan: {
    ...historicPlan.storyPlan,
    raceTemperature: { primary: 'historic', secondary: 'competitive', confidence: 92 },
  },
  requiredRecap: historicPlan.requiredRecap,
});
assert.ok(
  historicReport.overallNewsworthiness >= report.overallNewsworthiness - 5 ||
    historicReport.classifications.some((c) =>
      ['historic_win', 'record_setting'].includes(c.classificationId)
    ),
  'historic signals should rank at or above standard strong race'
);

const guidance = compactNewsroomGuidanceForPrompt(report);
assert.ok(guidance?.editorialGuidance?.lead?.includes('P25') || guidance?.primaryNarrative === 'winner_from_deep_field');
assert.ok(Array.isArray(guidance.driverSpotlightOrder) && guidance.driverSpotlightOrder.length >= 1);

const goodValidation = buildNewsworthinessValidation(report, {
  headline: 'Levine Wins From P25 at Homestead',
  body: 'Justin Levine charged from P25 to win. Chris Carroll lost ground in the championship fight.',
  summary: 'Deep-field win reshapes title race.',
});
assert.ok(goodValidation.checks.find((c) => c.id === 'lead_matches_primary_narrative')?.ok);

const badValidation = buildNewsworthinessValidation(report, {
  headline: 'Quiet afternoon at Homestead',
  body: 'The race ran green with little drama.',
  summary: 'Standard event.',
});
assert.ok(badValidation.scorePenalty > 0);

const multipassVal = validateMultipassDraft({
  editedArticle: {
    body: 'Justin Levine won from P25 at Homestead in a dramatic charge through the field. Chris Carroll slipped in the championship standings.',
    summary: 'Levine from deep field',
  },
  headlinePack: { headline: 'Levine Wins From P25', subheadline: 'Title fight tightens' },
  storyPlan: planResult.storyPlan,
  requiredRecap: planResult.requiredRecap,
  ledgerSnapshot: { criticalCoveragePercent: 90 },
  coverageTargets: { targets: { critical: 85 } },
  factVerification,
  newsworthinessReport: report,
});
assert.ok(multipassVal.newsworthinessValidation);
assert.ok(multipassVal.checksRun.includes('newsroom_intelligence'));

console.log('Phase 3d newsroom intelligence tests passed.');
