/**
 * Race research persistence & processing safety tests (no Supabase, no OpenAI).
 */
import assert from 'node:assert/strict';
import { chunksMatchSourceContent, validatePlannedChunkSet } from '../api/_race-research-chunk-validate.js';
import { shouldRegenerateChunks } from '../api/_race-research-chunk-sync.js';
import { validateProposedFacts } from '../api/_race-research-fact-replace.js';
import { chunkTextForResearch } from '../api/_race-research-chunking.js';
import { RACE_RESEARCH_CHUNKING_POLICY_VERSION } from '../server/config/race-research-config.js';
import { isNewsIntelligencePackageEnabled } from '../server/config/race-research-config.js';

const source = { contentHash: 'hash-a' };

assert.equal(chunksMatchSourceContent([], source), false);

assert.equal(
  chunksMatchSourceContent(
    [{ chunkIndex: 0, sourceContentHash: 'hash-a', chunkingPolicyVersion: RACE_RESEARCH_CHUNKING_POLICY_VERSION }],
    source
  ),
  true
);

assert.equal(
  chunksMatchSourceContent([{ chunkIndex: 0, sourceContentHash: 'hash-b' }], source),
  false
);

assert.equal(chunksMatchSourceContent([{ chunkIndex: 0, sourceContentHash: null }], source), false);

const regen = shouldRegenerateChunks(source, [
  { chunkIndex: 0, sourceContentHash: 'hash-old', chunkingPolicyVersion: RACE_RESEARCH_CHUNKING_POLICY_VERSION },
]);
assert.equal(regen.stale, true);

const planned = chunkTextForResearch('Word. '.repeat(500)).map((c, i) => ({
  ...c,
  chunkIndex: i,
  sourceContentHash: 'hash-a',
  chunkingPolicyVersion: RACE_RESEARCH_CHUNKING_POLICY_VERSION,
}));
const v = validatePlannedChunkSet(planned, { sourceContentHash: 'hash-a', rawTextLength: 3000 });
assert.equal(v.valid, true);

const validFacts = validateProposedFacts(
  [
    {
      factType: 'caution',
      summary: 'Caution lap 10',
      evidenceLinks: [{ sourceId: 'src-1', supportType: 'primary' }],
    },
  ],
  'src-1'
);
assert.equal(validFacts.valid, true);

const invalidFacts = validateProposedFacts([{ factType: 'x', summary: '', evidenceLinks: [] }], 'src-1');
assert.equal(invalidFacts.valid, false);

// Raw source patch guard: updateResearchSource must not accept rawText (unit contract)
const repoSource = await import('../api/_race-research-repository.js');
assert.equal(repoSource.updateResearchSource.toString().includes('patch.rawText'), false);

assert.equal(isNewsIntelligencePackageEnabled(), false);

console.log('test-race-research-safety.mjs: all tests passed');
