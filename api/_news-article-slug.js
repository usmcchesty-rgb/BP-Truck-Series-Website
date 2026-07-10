import { slugify } from './_lib.js';

export function buildArticleSlugBase(headline = '') {
  return slugify(headline || 'news-article') || 'news-article';
}

export function slugWithSuffix(base, suffixIndex = 1) {
  const safeBase = String(base || 'news-article').trim() || 'news-article';
  if (!suffixIndex || suffixIndex <= 1) return safeBase;
  return `${safeBase}-${suffixIndex}`;
}

export async function resolveUniqueSlug({
  base,
  slugExists,
  maxAttempts = 50,
} = {}) {
  const safeBase = String(base || 'news-article').trim() || 'news-article';
  if (typeof slugExists !== 'function') {
    return safeBase;
  }

  for (let suffixIndex = 1; suffixIndex <= maxAttempts; suffixIndex += 1) {
    const candidate = slugWithSuffix(safeBase, suffixIndex);
    if (!(await slugExists(candidate))) return candidate;
  }

  return `${safeBase}-${Date.now()}`;
}

export async function resolveUniqueSlugForTable(sb, headline, excludeId = null) {
  const base = buildArticleSlugBase(headline);
  return resolveUniqueSlug({
    base,
    slugExists: async (candidate) => {
      let query = sb.from('news_articles').select('id').eq('slug', candidate);
      if (excludeId != null) query = query.neq('id', excludeId);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message || 'Failed to check article slug.');
      return Boolean(data?.id);
    },
  });
}
