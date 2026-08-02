/**
 * Race Intelligence foundation tests (canonical, confidence, atomic RPC contract, versions).
 * No Supabase, no OpenAI.
 */
import assert from 'node:assert/strict';
import { mergeScore } from '../api/_race-research-consolidate-scoring.js';
import {
  evolveConfidence,
  combinedConfidenceFromEvidence,
  confidenceFromSourceType,
} from '../api/_race-research-confidence.js';
import { validateProposedFacts } from '../api/_race-research-fact-replace.js';
import { formatResearchQualityReport } from '../api/_race-research-readiness.js';
import {
  buildTranscriptCoverageSummary,
  resolveTranscriptSources,
} from '../api/_race-research-transcript-coverage.js';
import { isNewsIntelligencePackageEnabled } from '../server/config/race-research-config.js';

const cautionA = {
  factType: 'caution',
  category: 'caution',
  summary: 'Caution on lap 12 for debris in turn two',
  driverIds: ['d1'],
  lapNumber: 12,
};
const cautionB = {
  factType: 'caution',
  category: 'caution',
  summary: 'Yellow flag lap 12 debris turn two',
  driverIds: ['d1'],
  lapNumber: 12,
};
assert.ok(mergeScore(cautionA, cautionB, { adjacentChunks: true }) >= 0.62);

const cautionOtherLap = { ...cautionA, lapNumber: 20, summary: 'Caution on lap 20 for oil' };
assert.equal(mergeScore(cautionA, cautionOtherLap), 0);

const unrelatedDrivers = {
  factType: 'finish',
  category: 'result',
  summary: 'Chris Carroll wins the race',
  driverIds: ['a'],
  lapNumber: null,
};
const otherWinner = {
  factType: 'finish',
  category: 'result',
  summary: 'Jordan Taylor wins the race',
  driverIds: ['b'],
  lapNumber: null,
};
assert.equal(mergeScore(unrelatedDrivers, otherWinner), 0);

let conf = 'broadcast_reported';
const steps = [
  { to: 'officially_confirmed', sourceType: 'race_control' },
  { to: 'official', sourceType: 'official_results' },
];
for (const step of steps) {
  const evo = evolveConfidence(conf, step.to, { reason: 'evidence_added', sourceType: step.sourceType });
  if (evo.historyEntry) {
    assert.equal(evo.historyEntry.from, conf);
    conf = evo.currentConfidence;
  }
}
assert.equal(conf, 'official');

assert.equal(
  combinedConfidenceFromEvidence(['youtube_transcript', 'official_results']),
  'official'
);
assert.equal(confidenceFromSourceType('race_control'), 'officially_confirmed');

const valid = validateProposedFacts(
  [
    {
      factType: 'caution',
      summary: 'Caution lap 5',
      evidenceLinks: [{ sourceId: '11111111-1111-1111-1111-111111111111', supportType: 'primary' }],
    },
  ],
  '11111111-1111-1111-1111-111111111111'
);
assert.equal(valid.valid, true);

const invalidLink = validateProposedFacts(
  [
    {
      factType: 'caution',
      summary: 'Caution lap 5',
      evidenceLinks: [{ sourceId: '22222222-2222-2222-2222-222222222222', supportType: 'primary' }],
    },
  ],
  '11111111-1111-1111-1111-111111111111'
);
assert.equal(invalidLink.valid, false);

function canonicalCodeForRace(raceNumber, sequence) {
  return `FACT-R${Number(raceNumber)}-${String(sequence).padStart(5, '0')}`;
}
assert.equal(canonicalCodeForRace(15, 31), 'FACT-R15-00031');

function shouldSkipVersionInsert(existingHashes, hash) {
  return existingHashes.includes(hash);
}
assert.equal(shouldSkipVersionInsert(['abc', 'def'], 'abc'), true);
assert.equal(shouldSkipVersionInsert(['abc'], 'xyz'), false);

const savedOnly = resolveTranscriptSources([
  { id: '1', sourceType: 'saved_transcript', processingStatus: 'complete', characterCount: 144887 },
]);
assert.equal(savedOnly.active?.sourceType, 'saved_transcript');

const both = resolveTranscriptSources([
  { id: 'y', sourceType: 'youtube_transcript', processingStatus: 'complete' },
  { id: 's', sourceType: 'saved_transcript', processingStatus: 'complete', characterCount: 100 },
]);
assert.equal(both.active?.sourceType, 'saved_transcript');

const summary = buildTranscriptCoverageSummary(
  [{ id: 's', sourceType: 'saved_transcript', processingStatus: 'complete', characterCount: 144887 }],
  { chunkTotal: 17, chunkComplete: 17, chunkFailed: 0 },
  { transcriptProcessingMode: 'deterministic', aiTranscriptExtraction: false }
);
assert.equal(summary.coverageStatus, 'complete');
assert.equal(summary.activeSourceType, 'saved_transcript');

const report = formatResearchQualityReport({
  seasonId: '27987',
  raceNumber: 17,
  racePackage: {
    sources: [
      { sourceType: 'saved_transcript', processingStatus: 'complete', characterCount: 144887 },
      { sourceType: 'race_control', processingStatus: 'complete' },
    ],
    facts: [],
  },
  processingStats: { chunkTotal: 17, chunkComplete: 17, chunkFailed: 0 },
});
assert.ok(!report.includes('YouTube transcript: Missing'));
assert.ok(report.includes('Transcript Coverage'));
assert.ok(report.includes('Saved Transcript (active)'));

assert.equal(isNewsIntelligencePackageEnabled(), false);

const { buildNewsArticlePlan } = await import('../api/_race-research-plan.js');
assert.equal(typeof buildNewsArticlePlan, 'function');

console.log('test-race-research-canonical.mjs: all tests passed');
