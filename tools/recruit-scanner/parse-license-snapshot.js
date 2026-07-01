import {
  evaluateProfileCompletion,
  mergeProfileWithTextFallbacks,
  profileDomToSnapshotFields,
} from './dom-profile-extractor.js';

const LICENSE_CLASS_VALUES = new Set(['R', 'D', 'C', 'B', 'A', 'PRO']);

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLicenseClass(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (upper === 'ROOKIE') return 'R';
  if (upper === 'PRO') return 'Pro';
  if (LICENSE_CLASS_VALUES.has(upper)) {
    return upper === 'PRO' ? 'Pro' : upper;
  }

  return null;
}

export function extractOvalSection(text) {
  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let startIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^Oval$/i.test(lines[i])) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) {
    const match = text.match(/\bOval\b/i);
    if (!match) return null;
    return text.slice(match.index, match.index + 1200);
  }

  const section = [];
  for (let i = startIndex; i < lines.length && section.length < 30; i += 1) {
    if (i > startIndex && /^(Road|Dirt Oval|Dirt Road|Sports Car|Formula Car)$/i.test(lines[i])) {
      break;
    }
    section.push(lines[i]);
  }

  return section.join('\n');
}

export function parseDisplayName(text) {
  const lines = normalizeWhitespace(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const skipPattern =
    /^(home|licenses|career|profile|settings|logout|dashboard|members|iracing|back|menu|road|oval|dirt oval|dirt road)$/i;

  for (const line of lines.slice(0, 20)) {
    if (skipPattern.test(line)) continue;
    if (line.length < 2 || line.length > 64) continue;
    if (/^\d+$/.test(line)) continue;
    if (/customer id/i.test(line)) continue;
    if (/^cust(?:omer)?[_\s-]?id/i.test(line)) continue;
    if (/license|irating|safety rating/i.test(line)) continue;
    return line;
  }

  const labeled = text.match(/(?:display name|member name|driver name)\s*[:\-]\s*(.+)$/im);
  return labeled ? labeled[1].trim() : null;
}

export function parseOvalLicenseClass(sectionText) {
  const section = String(sectionText ?? '');
  if (!section) return null;

  const patterns = [
    /(?:license\s*class|class|license)\s*[:\-]?\s*(rookie|pro|[a-z])/i,
    /\b(rookie|pro)\b/i,
    /\b([RDCBA])\b(?:\s*license|\s*class)?/i,
  ];

  for (const pattern of patterns) {
    const match = section.match(pattern);
    if (!match) continue;
    const normalized = normalizeLicenseClass(match[1]);
    if (normalized) return normalized;
  }

  return null;
}

export function parseOvalSafetyRating(sectionText) {
  const section = String(sectionText ?? '');
  if (!section) return null;

  const patterns = [
    /(?:safety rating|sr)\s*[:\-]?\s*(\d\.\d{2})/i,
    /(?:safety rating|sr)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = section.match(pattern);
    if (!match) continue;
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 5) {
      return value.toFixed(2);
    }
  }

  const fallback = section.match(/\b(\d\.\d{2})\b/);
  if (fallback) {
    const value = Number.parseFloat(fallback[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 5) {
      return value.toFixed(2);
    }
  }

  return null;
}

export function parseOvalIrating(sectionText) {
  const section = String(sectionText ?? '');
  if (!section) return null;

  const patterns = [
    /iRating\s*[:\-]?\s*(\d{1,5})/i,
    /iR\s*[:\-]?\s*(\d{1,5})/i,
  ];

  for (const pattern of patterns) {
    const match = section.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value >= 0 && value <= 99999) {
      return value;
    }
  }

  return null;
}

export function parseCountry(text) {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(/\n([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)*)\nLicenses\n/i);
  return match ? match[1].trim() : null;
}

export function parseMemberSince(text) {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(/\b(\d+\s+Years?)\b/i);
  return match ? match[1] : null;
}

export function parseLicenseSnapshot(rawText) {
  const text = normalizeWhitespace(rawText);
  const ovalSection = extractOvalSection(text);
  const searchText = ovalSection || text;

  const displayName = parseDisplayName(text);
  const country = parseCountry(text);
  const memberSince = parseMemberSince(text);
  const ovalLicenseClassRaw = parseOvalLicenseClass(searchText);
  const ovalSafetyRating = parseOvalSafetyRating(searchText);
  const ovalIrating = parseOvalIrating(searchText);

  const profileJson = {
    displayName,
    country,
    memberSince,
    licenses: {
      oval: {
        class: ovalLicenseClassRaw
          ? ovalLicenseClassRaw === 'Pro'
            ? 'Class Pro'
            : `Class ${ovalLicenseClassRaw}`
          : null,
        safetyRating: ovalSafetyRating,
        irating: ovalIrating,
      },
    },
  };

  const completion = evaluateProfileCompletion(profileJson);

  return {
    ...completion,
    display_name: displayName,
    oval_license_class: normalizeLicenseClass(profileJson.licenses.oval.class),
    oval_safety_rating: ovalSafetyRating,
    oval_irating: ovalIrating,
    profileJson,
  };
}

export function parseProfileDomSnapshot(domExtraction) {
  const merged = mergeProfileWithTextFallbacks(domExtraction, {
    parseDisplayName,
    parseOvalLicenseClass,
    parseOvalSafetyRating,
    parseOvalIrating,
    extractOvalSection,
  });

  return profileDomToSnapshotFields(merged);
}

export function sanitizeRawTextExcerpt(rawText, maxLength = 400) {
  const cleaned = normalizeWhitespace(rawText).replace(/\s+/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength)}…`;
}
