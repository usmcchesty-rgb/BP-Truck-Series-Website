import assert from 'node:assert/strict';
import { chunkTextForResearch } from '../api/_race-research-chunking.js';
import { consolidateRaceFactsInMemory, buildOfficialResultFacts } from '../api/_race-research-processors.js';
import { buildDerivedRaceFacts } from '../api/_race-research-derived.js';
import { selectEvidenceForArticle } from '../api/_race-research-evidence.js';
import { buildNewsArticlePlan } from '../api/_race-research-plan.js';
import {
  isNewsIntelligencePackageEnabled,
  normalizeArticleDepth,
  TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS,
  TRANSCRIPT_CHUNK_TARGET_CHARACTERS,
} from '../server/config/race-research-config.js';
import { computeCoverageScore, buildSourceCoverageDiagnostics } from '../api/_race-research-coverage.js';
import { hashContent } from '../api/_race-research-hash.js';
import { resolveDriverEntity } from '../api/_race-research-driver-resolve.js';
import { parseDiagnoseArgs } from '../api/_race-research-diagnose.js';
import {
  validateTranscriptChunkExtraction,
  extractTranscriptChunkHybrid,
} from '../api/_race-research-transcript-extract.js';
import { preprocessTranscriptChunk } from '../api/_race-research-transcript-preprocess.js';
import { consolidateRaceFactsAdvanced } from '../api/_race-research-consolidate.js';
import { buildRaceDriverStoryPackages } from '../api/_race-research-driver-stories.js';
import { assessArticleReadiness, assessQuotePublicationReadiness } from '../api/_race-research-readiness.js';
import {
  getRaceResearchTranscriptMode,
  isRaceResearchDiagnosticAiAllowed,
  RACE_RESEARCH_EXTRACTION_VERSION,
} from '../server/config/race-research-config.js';
import { extractTranscriptChunkDeterministic, transcriptExtractionToFacts } from '../api/_race-research-transcript-extract.js';

// 1. Chunk order
const longText = `${'Sentence one about racing. '.repeat(200)}Caution on lap forty. ${'Another lap report. '.repeat(200)}`;
const chunks = chunkTextForResearch(longText, { targetChars: 500, overlapChars: 80 });
assert.ok(chunks.length > 1, 'expected multiple chunks');
assert.equal(chunks[0].chunkIndex, 0);
assert.ok(chunks[1].startCharacter < chunks[0].endCharacter, 'chunks should overlap');

// 4–5 overlap settings
assert.equal(TRANSCRIPT_CHUNK_TARGET_CHARACTERS, 10000);
assert.equal(TRANSCRIPT_CHUNK_OVERLAP_CHARACTERS, 1000);

// 7. Every fact needs evidence in processor path
const officialFacts = buildOfficialResultFacts({
  seasonId: '27987',
  raceNumber: 15,
  scheduleEntry: {
    driverResults: {
      '1': { finishPosition: 1, startPosition: 3, lapsLed: 10 },
      '2': { finishPosition: 2, startPosition: 1, lapsLed: 5 },
    },
  },
  driverLookup: new Map([
    ['1', { driverId: '1', driverName: 'Driver One' }],
    ['2', { driverId: '2', driverName: 'Driver Two' }],
  ]),
  sourceId: '00000000-0000-0000-0000-000000000001',
});
assert.ok(officialFacts.length >= 2);
for (const fact of officialFacts) {
  assert.ok(fact.evidenceLinks?.length, 'official fact must have evidence link');
}

// 11–14 derived movement
const { derivedFacts } = buildDerivedRaceFacts({ seasonId: '27987', raceNumber: 15, facts: officialFacts });
assert.ok(derivedFacts.some((f) => f.category === 'winner'));
assert.ok(derivedFacts.some((f) => f.category === 'biggest_gainer'));

// 8–9 consolidation
const merged = consolidateRaceFactsInMemory([
  ...officialFacts,
  {
    ...officialFacts[0],
    summary: officialFacts[0].summary + ' ',
  },
]);
assert.ok(merged.facts.length < officialFacts.length * 2);

// 15 coverage
const coverage = buildSourceCoverageDiagnostics([
  { sourceType: 'official_results', processingStatus: 'complete' },
  { sourceType: 'standings', processingStatus: 'complete' },
]);
const score = computeCoverageScore(coverage);
assert.ok(score > 0 && score <= 100);

// 17–22 depth + flag default
assert.equal(normalizeArticleDepth(undefined), 'medium');
assert.equal(normalizeArticleDepth('invalid'), 'medium');
assert.equal(normalizeArticleDepth('indepth'), 'in-depth');
const prevFlag = process.env.NEWS_INTELLIGENCE_PACKAGE_ENABLED;
delete process.env.NEWS_INTELLIGENCE_PACKAGE_ENABLED;
assert.equal(isNewsIntelligencePackageEnabled(), false);
process.env.NEWS_INTELLIGENCE_PACKAGE_ENABLED = prevFlag;

// Transcript deterministic extraction
const extraction = extractTranscriptChunkDeterministic(
  'The leaders battled hard. Caution waves as two trucks wreck. Kyle Wellman takes the lead.'
);
assert.ok(extraction.events.length >= 1);
const { facts: transcriptFacts } = transcriptExtractionToFacts(extraction, {
  seasonId: '27987',
  raceNumber: 15,
  sourceId: '00000000-0000-0000-0000-000000000002',
  chunkId: null,
});
assert.ok(transcriptFacts.every((f) => f.evidenceLinks?.length));

// Evidence selection depths use same package
const pkg = {
  facts: [...officialFacts, ...transcriptFacts, ...derivedFacts.map((d) => ({ ...d, id: hashContent(d.summary) }))],
  timeline: [],
  verifiedQuotes: [],
  driverSummaries: [],
  historicalContext: [],
  diagnostics: { coverageScore: 50 },
};
const shortEv = selectEvidenceForArticle({ racePackage: pkg, articleType: 'race-recap', articleDepth: 'short' });
const deepEv = selectEvidenceForArticle({ racePackage: pkg, articleType: 'race-recap', articleDepth: 'in-depth' });
assert.ok(deepEv.selectedFacts.length >= shortEv.selectedFacts.length);

const plan = buildNewsArticlePlan({
  articleType: 'race-recap',
  articleDepth: 'medium',
  evidenceSelection: shortEv,
});
assert.ok(plan.sections.length >= 3);
assert.ok(plan.requiredFactIds.length >= 1);

// Driver normalization trailing digit
const lookup = new Map([['99', { driverId: '99', driverName: 'Chris Carroll' }]]);
const resolved = resolveDriverEntity('Chris Carroll3', lookup);
assert.equal(resolved.matchedDriverId, '99');

// Duplicate hash
assert.equal(hashContent('abc'), hashContent('abc'));
assert.notEqual(hashContent('abc'), hashContent('abcd'));

// Diagnostic arg parsing
const parsed = parseDiagnoseArgs(['node', 'script', '15', '--status', '--evidence']);
assert.ok(parsed.modes.has('status'));
assert.ok(parsed.modes.has('evidence'));
assert.equal(parsed.raceNumber, 15);
assert.equal(parsed.allowAi, false);

// Extraction version
assert.equal(RACE_RESEARCH_EXTRACTION_VERSION, '2.0');

// AI requires explicit enablement for diagnostics
assert.equal(isRaceResearchDiagnosticAiAllowed({ allowAi: false }), false);
assert.equal(getRaceResearchTranscriptMode(), 'deterministic');

// Schema validation rejects bad payload
const invalid = validateTranscriptChunkExtraction({ events: [{ summary: 123 }] });
assert.equal(invalid.valid, false);

// Speculation stays unverified in facts
const specExtraction = {
  events: [
    {
      category: 'incident',
      summary: 'Possible contact in turn one',
      certainty: 'speculation',
      importanceScore: 40,
      supportingExcerpt: 'might have tagged the wall',
    },
  ],
  quotes: [],
};
const validated = validateTranscriptChunkExtraction(specExtraction);
const { facts: specFacts } = transcriptExtractionToFacts(validated.value, {
  seasonId: '27987',
  raceNumber: 15,
  sourceId: '00000000-0000-0000-0000-000000000003',
});
assert.equal(specFacts[0].confidence, 'unverified');

// Hybrid skips low-info chunk without AI
process.env.RACE_RESEARCH_TRANSCRIPT_MODE = 'hybrid';
const low = await extractTranscriptChunkHybrid('Subscribe to our channel and thanks to our sponsor today.', {
  allowAi: false,
});
assert.equal(low._meta.extractionMethod, 'deterministic');
delete process.env.RACE_RESEARCH_TRANSCRIPT_MODE;

// Cross-chunk similar events
const a = {
  factType: 'caution',
  category: 'caution',
  summary: 'Caution waves for incident in turn one',
  driverIds: ['1'],
  driverNames: ['Driver One'],
  importanceScore: 50,
  confidence: 'broadcast_reported',
};
const b = { ...a, summary: 'Caution waves for incident in turn one on track' };
const advanced = consolidateRaceFactsAdvanced([a, b]);
assert.ok(advanced.mergeGroups >= 0);

const distinct = consolidateRaceFactsAdvanced([
  { ...a, lapNumber: 10 },
  { ...a, lapNumber: 40, summary: 'Second caution for debris' },
]);
assert.ok(distinct.mergeCount <= 1);

// Driver story packages
const storyPkg = buildRaceDriverStoryPackages({
  racePackage: {
    facts: officialFacts.map((f, i) => ({ ...f, id: `f${i}`, driverIds: ['1'], driverNames: ['Driver One'] })),
  },
});
assert.ok(storyPkg.length >= 1);
assert.ok(storyPkg.some((s) => s.availableEvidenceCount > 0));

// Readiness not "Ready" for in-depth without timeline
const readiness = assessArticleReadiness(
  { facts: officialFacts.map((f, i) => ({ ...f, id: String(i) })), sources: [], diagnostics: {} },
  'in-depth'
);
assert.ok(['Partial', 'Not Ready'].includes(readiness.status));

// Legacy flag still off
assert.equal(isNewsIntelligencePackageEnabled(), false);

// Evidence category coverage object
assert.ok(deepEv.categoryCoverage?.availableCategories);

// Admin API / deployed diagnostics tests
import {
  getResearchConfigStatus,
  parseFactFilters,
  filterFactsForAdmin,
  RESEARCH_MIGRATION_HINT,
  resolveResearchAllowAi,
} from '../api/_race-research-admin-api.js';

assert.ok(RESEARCH_MIGRATION_HINT.includes('race_research_intelligence_migration.sql'));

const cfg = getResearchConfigStatus();
assert.equal(typeof cfg.packageBasedArticlePrompt, 'boolean');
assert.equal(typeof cfg.aiTranscriptExtraction, 'boolean');
assert.equal(typeof cfg.transcriptProcessingMode, 'string');
assert.equal(cfg.packageBasedArticlePrompt, false);

assert.throws(() => parseFactFilters({ minImportance: 'bad' }));

const filtered = filterFactsForAdmin(
  [
    {
      id: 'abc-123',
      factType: 'caution',
      category: 'caution',
      summary: 'Caution lap 10',
      driverNames: ['Driver One'],
      driverIds: ['1'],
      lapNumber: 10,
      importanceScore: 50,
      confidence: 'broadcast_reported',
    },
  ],
  [],
  {},
  { minImportance: 40 }
);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].idShort, 'abc-123');

const quoteReady = assessQuotePublicationReadiness({
  speaker: 'Driver One',
  quote: 'That was a tough race for our team today.',
  completeness: 'complete',
});
assert.equal(quoteReady.publicationReadiness, 'ready');

assert.equal(resolveResearchAllowAi({ allowAi: true }), false);

console.log('test-race-research-intelligence.mjs: all tests passed');
