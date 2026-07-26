import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(join(__dirname, '../public/news-article-body.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(code, context);
const { render, normalizeArticleMarkdown } = context.window.NewsArticleBody;

const sample = `Opening paragraph.
### Track Spotlight
Track description.
### Drivers to Watch
1. Driver One
2. Driver Two
### Championship Battle
Closing text.`;

const html = render(sample);

assert.match(html, /<p>Opening paragraph\.<\/p>/);
assert.doesNotMatch(html, /###/);
assert.match(html, /<h3 class="news-article-h3[^"]*">Track Spotlight<\/h3>/);
assert.match(html, /<p>Track description\.<\/p>/);
assert.match(html, /<h3[^>]*>Drivers to Watch<\/h3>/);
assert.match(html, /<ol class="news-article-list news-article-list--numbered">/);
assert.match(html, /<li>Driver One<\/li>/);
assert.match(html, /<li>Driver Two<\/li>/);
assert.match(html, /<h3[^>]*>Championship Battle<\/h3>/);
assert.match(html, /<p>Closing text\.<\/p>/);

const glued = 'Paragraph text.\n### Track Spotlight\nMore here.';
const normalized = normalizeArticleMarkdown(glued);
assert.match(normalized, /Paragraph text\.\n\n### Track Spotlight\n\nMore here\./);

const xss = 'Hello\n### Title\n<script>alert(1)</script>';
const safe = render(xss);
assert.doesNotMatch(safe, /<script/i);
assert.match(safe, /&lt;script&gt;/);

console.log('news-article-body: all scenarios passed');
