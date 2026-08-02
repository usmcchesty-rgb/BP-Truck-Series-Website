import { createHash } from 'node:crypto';

export function hashContent(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export function hashJson(value) {
  return hashContent(JSON.stringify(value ?? null));
}
