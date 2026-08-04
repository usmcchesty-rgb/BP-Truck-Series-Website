/**
 * Phase 4a — deterministic multipass depth budgets (no new OpenAI stages).
 */
import { normalizeArticleDepth } from '../server/config/race-research-config.js';

export const MULTIPASS_DEPTH_VERSION = '1.0.0';

const SECTION_FACT_AFFINITY = {
  introduction: ['winner', 'result', 'historical', 'championship'],
  race_summary: ['winner', 'result', 'caution', 'championship', 'historical'],
  battle_for_win: ['winner', 'result', 'strategy', 'historical', 'lead_change'],
  strategy: ['strategy', 'caution'],
  key_incidents: ['incident', 'caution', 'penalty'],
  driver_stories: ['result', 'historical', 'quote', 'human'],
  championship_picture: ['championship'],
  looking_ahead: ['championship', 'historical'],
  controversy: ['incident', 'penalty'],
};

export const MULTIPASS_DEPTH_PROFILES = {
  short: {
    label: 'Short',
    wordRange: { min: 350, max: 500, target: 425 },
    factRange: { min: 8, max: 15, target: 12 },
    validationWordFloor: null,
    validationWordCeiling: 600,
    validationFactFloor: 8,
    sectionWordBudgets: {
      introduction: { min: 50, max: 90, target: 70 },
      race_summary: { min: 80, max: 120, target: 100 },
      battle_for_win: { min: 0, max: 0, target: 0 },
      strategy: { min: 40, max: 70, target: 55 },
      key_incidents: { min: 60, max: 90, target: 75 },
      driver_stories: { min: 0, max: 0, target: 0 },
      championship_picture: { min: 0, max: 0, target: 0 },
      looking_ahead: { min: 0, max: 0, target: 0 },
      controversy: { min: 0, max: 0, target: 0 },
    },
    sectionEvidenceBudgets: {
      introduction: { min: 2, max: 4, target: 3 },
      race_summary: { min: 3, max: 5, target: 4 },
      battle_for_win: { min: 0, max: 0, target: 0 },
      strategy: { min: 2, max: 3, target: 2 },
      key_incidents: { min: 2, max: 4, target: 3 },
      driver_stories: { min: 0, max: 0, target: 0 },
      championship_picture: { min: 0, max: 0, target: 0 },
      looking_ahead: { min: 0, max: 0, target: 0 },
      controversy: { min: 0, max: 0, target: 0 },
    },
  },
  medium: {
    label: 'Medium',
    wordRange: { min: 700, max: 1000, target: 850 },
    factRange: { min: 25, max: 40, target: 30 },
    validationWordFloor: 650,
    validationWordCeiling: null,
    validationFactFloor: 20,
    sectionWordBudgets: {
      introduction: { min: 80, max: 120, target: 100 },
      race_summary: { min: 70, max: 110, target: 90 },
      battle_for_win: { min: 120, max: 180, target: 150 },
      strategy: { min: 80, max: 120, target: 100 },
      key_incidents: { min: 70, max: 110, target: 90 },
      driver_stories: { min: 100, max: 150, target: 125 },
      championship_picture: { min: 100, max: 150, target: 125 },
      looking_ahead: { min: 80, max: 120, target: 100 },
      controversy: { min: 80, max: 120, target: 100 },
    },
    sectionEvidenceBudgets: {
      introduction: { min: 3, max: 5, target: 4 },
      race_summary: { min: 3, max: 5, target: 4 },
      battle_for_win: { min: 6, max: 8, target: 7 },
      strategy: { min: 4, max: 6, target: 5 },
      key_incidents: { min: 3, max: 5, target: 4 },
      driver_stories: { min: 6, max: 8, target: 7 },
      championship_picture: { min: 5, max: 7, target: 6 },
      looking_ahead: { min: 2, max: 4, target: 3 },
      controversy: { min: 3, max: 5, target: 4 },
    },
  },
  'in-depth': {
    label: 'Long',
    wordRange: { min: 1200, max: 1800, target: 1500 },
    factRange: { min: 45, max: 70, target: 55 },
    validationWordFloor: 1100,
    validationWordCeiling: null,
    validationFactFloor: 40,
    sectionWordBudgets: {
      introduction: { min: 100, max: 150, target: 125 },
      race_summary: { min: 120, max: 180, target: 150 },
      battle_for_win: { min: 180, max: 260, target: 220 },
      strategy: { min: 120, max: 180, target: 150 },
      key_incidents: { min: 120, max: 180, target: 150 },
      driver_stories: { min: 160, max: 220, target: 190 },
      championship_picture: { min: 140, max: 200, target: 170 },
      looking_ahead: { min: 100, max: 150, target: 125 },
      controversy: { min: 100, max: 150, target: 125 },
    },
    sectionEvidenceBudgets: {
      introduction: { min: 4, max: 6, target: 5 },
      race_summary: { min: 5, max: 8, target: 6 },
      battle_for_win: { min: 8, max: 12, target: 10 },
      strategy: { min: 6, max: 9, target: 7 },
      key_incidents: { min: 5, max: 8, target: 6 },
      driver_stories: { min: 8, max: 12, target: 10 },
      championship_picture: { min: 7, max: 10, target: 8 },
      looking_ahead: { min: 4, max: 6, target: 5 },
      controversy: { min: 4, max: 7, target: 5 },
    },
  },
};

export function getMultipassDepthProfile(articleDepth) {
  const depth = normalizeArticleDepth(articleDepth);
  return MULTIPASS_DEPTH_PROFILES[depth] || MULTIPASS_DEPTH_PROFILES.medium;
}

function factMatchesSection(fact, sectionId) {
  const aff = SECTION_FACT_AFFINITY[sectionId] || [];
  if (aff.includes(fact.factType)) return true;
  if (fact.category && aff.includes(fact.category)) return true;
  if (sectionId === 'driver_stories' && fact.factType === 'historical') return true;
  if (sectionId === 'battle_for_win' && (fact.category === 'winner' || fact.structuredData?.finishPosition === 1)) {
    return true;
  }
  if (sectionId === 'championship_picture' && fact.factType === 'championship') return true;
  if (sectionId === 'strategy' && fact.factType === 'strategy') return true;
  if (sectionId === 'key_incidents' && ['incident', 'caution', 'penalty'].includes(fact.factType)) return true;
  return false;
}

export function expandSectionFactIdsForDepth(section, preparedFacts, articleDepth, { suppressedFactIds = [] } = {}) {
  const profile = getMultipassDepthProfile(articleDepth);
  const budget = profile.sectionEvidenceBudgets[section.sectionId];
  if (!budget || budget.target <= 0) return [...new Set(section.evidence?.factIds || [])];

  const suppressed = new Set(suppressedFactIds || []);
  const ids = [...new Set(section.evidence?.factIds || [])];
  const have = new Set(ids);
  const candidates = (preparedFacts || [])
    .filter((f) => !suppressed.has(f.id))
    .filter((f) => factMatchesSection(f, section.sectionId))
    .sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));

  for (const f of candidates) {
    if (ids.length >= budget.max) break;
    if (have.has(f.id)) continue;
    ids.push(f.id);
    have.add(f.id);
  }
  while (ids.length < budget.min && candidates.length) {
    const next = candidates.find((f) => !have.has(f.id));
    if (!next) break;
    ids.push(next.id);
    have.add(next.id);
  }
  return ids.slice(0, budget.max || ids.length);
}

export function prepareSectionForDepthWrite(section, articleDepth, preparedFacts, { suppressedFactIds = [] } = {}) {
  const profile = getMultipassDepthProfile(articleDepth);
  const wordBudget = profile.sectionWordBudgets[section.sectionId] || { min: 80, max: 120, target: section.targetWords || 100 };
  const evidenceBudget = profile.sectionEvidenceBudgets[section.sectionId] || { min: 2, max: 6, target: 4 };
  const expandedFactIds = expandSectionFactIdsForDepth(section, preparedFacts, articleDepth, { suppressedFactIds });

  const targetWords = wordBudget.target > 0 ? wordBudget.target : section.targetWords;
  return {
    ...section,
    targetWords,
    evidence: {
      ...(section.evidence || {}),
      factIds: expandedFactIds,
    },
    writingBrief: {
      ...(section.writingBrief || {}),
      depthEnforcement: {
        version: MULTIPASS_DEPTH_VERSION,
        depth: normalizeArticleDepth(articleDepth),
        wordMin: wordBudget.min,
        wordMax: wordBudget.max,
        wordTarget: targetWords,
        factMin: evidenceBudget.min,
        factMax: evidenceBudget.max,
        factTarget: evidenceBudget.target,
        instruction:
          'Use the expanded verified evidence bundle. Do not pad with fluff — each sentence should carry a distinct verified fact, quote, or race detail.',
      },
    },
    depthMaxFacts: evidenceBudget.max || 14,
  };
}

export function compactDepthGuidanceForEditor(storyPlan, outline) {
  const profile = getMultipassDepthProfile(storyPlan?.articleDepth);
  return {
    version: MULTIPASS_DEPTH_VERSION,
    depth: normalizeArticleDepth(storyPlan?.articleDepth),
    articleWordTarget: profile.wordRange,
    articleFactTarget: profile.factRange,
    totalTargetWords: outline?.totalTargetWords || profile.wordRange.target,
    preserveUniqueFacts: true,
    editorRules: [
      'Do NOT compress medium or long articles by deleting unique verified facts.',
      'Remove duplicate ideas, repeated adjectives, and repeated transitions only.',
      'Preserve championship analysis, strategy detail, historical context, and driver-specific verified details.',
      'Merged body should meet the article word target range using information density, not filler adjectives.',
    ],
  };
}

export function resolveSectionMaxTokens(section, articleDepth) {
  const target = section?.targetWords || getMultipassDepthProfile(articleDepth).wordRange.target / 8;
  return Math.min(4096, Math.max(650, Math.round(target * 2.4)));
}

export function resolveEditorMaxTokens(articleDepth) {
  const profile = getMultipassDepthProfile(articleDepth);
  return Math.min(4096, Math.max(1800, Math.round(profile.wordRange.target * 2.2)));
}

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function countUniqueFactsUsed(sectionDrafts = [], ledgerSnapshot = null) {
  const fromSections = new Set();
  for (const s of sectionDrafts) {
    for (const id of s.usedFactIds || []) fromSections.add(id);
  }
  if (fromSections.size) return fromSections.size;
  return ledgerSnapshot?.factsUsed ?? ledgerSnapshot?.factsUsedCount ?? 0;
}

export function buildDepthComplianceReport({
  articleDepth,
  body,
  sectionDrafts = [],
  outline,
  ledgerSnapshot = null,
}) {
  const profile = getMultipassDepthProfile(articleDepth);
  const depth = normalizeArticleDepth(articleDepth);
  const words = wordCount(body);
  const factsUsed = countUniqueFactsUsed(sectionDrafts, ledgerSnapshot);
  const outlineSections = outline?.sections || [];
  const sectionsTarget = outlineSections.filter((s) => {
    const b = profile.sectionWordBudgets[s.sectionId];
    return b && b.target > 0;
  }).length;
  const sectionChecks = [];
  for (const s of outlineSections) {
    const budget = profile.sectionWordBudgets[s.sectionId];
    if (!budget || budget.target <= 0) continue;
    const draft = sectionDrafts.find((d) => d.sectionId === s.sectionId);
    const w = draft?.wordCount ?? wordCount(draft?.sectionText);
    const ok = w >= Math.round(budget.min * 0.55);
    sectionChecks.push({
      sectionId: s.sectionId,
      title: s.title,
      wordMin: budget.min,
      wordTarget: budget.target,
      actualWords: w,
      ok,
    });
  }
  const sectionsOk = sectionChecks.filter((c) => c.ok).length;

  const wordMid = profile.wordRange.target;
  const wordPct =
    words >= profile.wordRange.min && words <= profile.wordRange.max
      ? 100
      : words < profile.wordRange.min
        ? clampPct((words / profile.wordRange.min) * 100)
        : clampPct(100 - ((words - profile.wordRange.max) / profile.wordRange.max) * 50);

  const factPct =
    factsUsed >= profile.factRange.min && factsUsed <= profile.factRange.max
      ? 100
      : factsUsed < profile.factRange.min
        ? clampPct((factsUsed / profile.factRange.min) * 100)
        : clampPct(100 - ((factsUsed - profile.factRange.max) / profile.factRange.max) * 40);

  const sectionPct = sectionsTarget ? clampPct((sectionsOk / sectionsTarget) * 100) : 100;
  const overallDepthScore = clampPct(wordPct * 0.45 + factPct * 0.4 + sectionPct * 0.15);
  const informationDensity = words > 0 ? Math.round((factsUsed / words) * 1000) / 10 : 0;

  return {
    version: MULTIPASS_DEPTH_VERSION,
    depth,
    label: profile.label,
    targets: {
      words: profile.wordRange,
      facts: profile.factRange,
      sections: sectionsTarget,
    },
    actual: {
      words,
      facts: factsUsed,
      sectionsCompleted: sectionsOk,
      sectionsTotal: sectionsTarget,
    },
    sectionChecks,
    informationDensity,
    overallDepthScore,
    checks: {
      wordsOk: words >= profile.wordRange.min && words <= (profile.wordRange.max * 1.08),
      factsOk: factsUsed >= profile.factRange.min,
      sectionsOk: sectionsOk >= sectionsTarget * 0.85,
    },
    display: {
      wordsLine: `${words} / ${profile.wordRange.min}–${profile.wordRange.max}`,
      factsLine: `${factsUsed} / ${profile.factRange.target} target`,
      sectionsLine: `${sectionsOk} / ${sectionsTarget}`,
    },
  };
}

export function buildDepthValidation({
  articleDepth,
  body,
  sectionDrafts,
  outline,
  ledgerSnapshot,
}) {
  const report = buildDepthComplianceReport({
    articleDepth,
    body,
    sectionDrafts,
    outline,
    ledgerSnapshot,
  });
  const profile = getMultipassDepthProfile(articleDepth);
  const checks = [];
  let scorePenalty = 0;

  if (profile.validationWordFloor != null && report.actual.words < profile.validationWordFloor) {
    checks.push({
      id: 'depth_words_low',
      ok: false,
      label: `Article ${report.actual.words} words below ${profile.label} floor (${profile.validationWordFloor}).`,
    });
    scorePenalty += 18;
  }
  if (profile.validationWordCeiling != null && report.actual.words > profile.validationWordCeiling) {
    checks.push({
      id: 'depth_words_high',
      ok: false,
      warn: true,
      label: `Article ${report.actual.words} words above Short ceiling (${profile.validationWordCeiling}).`,
    });
    scorePenalty += 8;
  }
  if (profile.validationFactFloor != null && report.actual.facts < profile.validationFactFloor) {
    checks.push({
      id: 'depth_facts_low',
      ok: false,
      label: `Only ${report.actual.facts} verified facts used; ${profile.label} target ≥ ${profile.validationFactFloor}.`,
    });
    scorePenalty += 16;
  }

  for (const sc of report.sectionChecks) {
    if (!sc.ok) {
      checks.push({
        id: `depth_section_thin_${sc.sectionId}`,
        ok: false,
        warn: true,
        label: `${sc.title} thin (${sc.actualWords} words; min ~${sc.wordMin}).`,
      });
      scorePenalty += 4;
    }
  }

  if (report.checks.wordsOk) {
    checks.push({ id: 'depth_words_in_range', ok: true, label: 'Word count within depth target' });
  }
  if (report.checks.factsOk) {
    checks.push({ id: 'depth_facts_met', ok: true, label: 'Fact usage meets depth minimum' });
  }

  return {
    checks,
    scorePenalty,
    depthCompliance: report,
    informationDensity: report.informationDensity,
  };
}

export function compareDepthProfilesOrdering() {
  const short = MULTIPASS_DEPTH_PROFILES.short.wordRange.target;
  const medium = MULTIPASS_DEPTH_PROFILES.medium.wordRange.target;
  const long = MULTIPASS_DEPTH_PROFILES['in-depth'].wordRange.target;
  return { short, medium, long, ordered: short < medium && medium < long };
}
