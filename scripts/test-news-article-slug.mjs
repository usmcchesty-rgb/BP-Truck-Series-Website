import assert from 'node:assert/strict';
import {
  buildArticleSlugBase,
  resolveUniqueSlug,
  slugWithSuffix,
} from '../api/_news-article-slug.js';

assert.equal(buildArticleSlugBase('Talladega Race Recap'), 'talladega-race-recap');
assert.equal(slugWithSuffix('talladega-race-recap', 1), 'talladega-race-recap');
assert.equal(slugWithSuffix('talladega-race-recap', 2), 'talladega-race-recap-2');
assert.equal(slugWithSuffix('talladega-race-recap', 3), 'talladega-race-recap-3');

const taken = new Set(['talladega-race-recap', 'talladega-race-recap-2']);
const slug = await resolveUniqueSlug({
  base: 'talladega-race-recap',
  slugExists: async (candidate) => taken.has(candidate),
});
assert.equal(slug, 'talladega-race-recap-3');

const fresh = await resolveUniqueSlug({
  base: 'july-10-weekend-preview',
  slugExists: async () => false,
});
assert.equal(fresh, 'july-10-weekend-preview');

console.log('news-article-slug: all scenarios passed');
