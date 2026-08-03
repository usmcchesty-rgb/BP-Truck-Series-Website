/**
 * Phase 3c — deterministic canonical fact verification (no OpenAI, no planner changes).
 */
import { CONFIDENCE_RANK } from './_race-research-confidence.js';
import { isOfficialConfidence } from './_news-writer-fact-quality.js';

export const WRITER_VERIFICATION_VERSION = '1.0.0';

/** Highest rank wins for the same canonical event. */
export const SOURCE_PRIORITY = [
  { sourceTypes: ['official_results'], label: 'Official Results', rank: 100 },
  { sourceTypes: ['qualifying'], label: 'Official Results', rank: 98 },
  { sourceTypes: ['race_control'], label: 'Race Control', rank: 95 },
  { sourceTypes: ['official_standings', 'standings'], label: 'Official Standings', rank: 90 },
  { sourceTypes: ['schedule'], label: 'Official Schedule', rank: 85 },
  { sourceTypes: ['manual_notes'], label: 'Manual / Official Notes', rank: 80 },
  { sourceTypes: ['previous_article', 'historical_results'], label: 'Historical', rank: 55 },
  { sourceTypes: ['youtube_transcript', 'saved_transcript'], label: 'Broadcast Transcript', rank: 45 },
  { sourceTypes: ['other'], label: 'Derived', rank: 35 },
];

const CONFIDENCE_PRIORITY_BOOST = {
  official: 8,
  officially_confirmed: 7,
  manual: 6,
  derived: 4,
  historical: 3,
  broadcast_reported: 2,
  unverified: 1,
  conflicting: 0,
};

const NUMERIC_FACT_TYPES = new Set([
  'championship',
  'result',
  'race_event',
  'lead_change',
  'caution',
  'historical',
]);

function sourceRankForFact(fact, sourceById) {
  const types = factSourceTypes(fact, sourceById);
  let best = 20;
  let label = 'Unknown source';
  for (const st of types) {
    for (const row of SOURCE_PRIORITY) {
      if (row.sourceTypes.includes(st)) {
        if (row.rank > best) {
          best = row.rank;
          label = row.label;
        }
      }
    }
  }
  const confBoost = CONFIDENCE_PRIORITY_BOOST[fact.confidence] ?? 0;
  if (fact.canonicalFactId && isOfficialConfidence(fact.confidence)) {
    best = Math.max(best, 72);
    if (label === 'Unknown source') label = 'Canonical (official confidence)';
  }
  return { rank: best + confBoost, label, sourceTypes: types };
}

function sourceByIdFromPackage(racePackage) {
  const map = new Map();
  for (const s of racePackage?.sources || []) {
    if (s.id) map.set(String(s.id), s);
  }
  return map;
}

function factSourceTypes(fact, sourceById) {
  const out = new Set();
  if (fact.primarySourceType) out.add(fact.primarySourceType);
  if (fact.sourceType) out.add(fact.sourceType);
  for (const link of fact.evidenceLinks || []) {
    const src = sourceById.get(String(link.sourceId));
    if (src?.sourceType) out.add(src.sourceType);
  }
  if (!out.size && fact.category === 'standings_snapshot') out.add('official_standings');
  if (!out.size && fact.category === 'race_control') out.add('race_control');
  return [...out];
}

function extractNumericClaims(fact) {
  const claims = {};
  const sd = fact.structuredData || {};
  if (sd.points != null) claims.points = Number(sd.points);
  if (sd.championshipPoints != null) claims.points = Number(sd.championshipPoints);
  if (sd.totalPoints != null) claims.points = Number(sd.totalPoints);
  if (sd.cautionCount != null) claims.cautionCount = Number(sd.cautionCount);
  if (sd.finishPosition != null) claims.finishPosition = Number(sd.finishPosition);
  if (sd.startPosition != null) claims.startPosition = Number(sd.startPosition);
  if (sd.lapNumber != null) claims.lapNumber = Number(sd.lapNumber);
  if (sd.margin != null) claims.margin = Number(sd.margin);

  const summary = String(fact.summary || '');
  const pointsM = summary.match(/(\d{2,4})\s+points?\b/i);
  if (pointsM && claims.points == null) claims.points = Number(pointsM[1]);
  const leadM = summary.match(/(?:leads?|leader|trailing)\s+(?:by\s+)?(\d+)\s+points?\b/i);
  if (leadM && claims.points == null) claims.points = Number(leadM[1]);
  const cautM = summary.match(/(\d+)\s+cautions?\b/i);
  if (cautM && claims.cautionCount == null) claims.cautionCount = Number(cautM[1]);

  return claims;
}

function claimsConflict(a, b) {
  for (const key of Object.keys(a)) {
    if (a[key] != null && b[key] != null && a[key] !== b[key]) return { field: key, a: a[key], b: b[key] };
  }
  return null;
}

function topicLabel(factType, category) {
  if (factType === 'championship' || category?.includes('standings') || category?.includes('points')) {
    return 'Championship points';
  }
  if (category === 'winner' || factType === 'result') return 'Winner / finish';
  if (category === 'race_control' || factType === 'caution') return 'Caution count';
  if (category === 'official_finish') return 'Finishing positions';
  return factType || category || 'Canonical fact';
}

function verificationStatusForGroup(facts, conflict, preferred) {
  if (facts.some((f) => f.confidence === 'conflicting')) return 'conflicted';
  if (conflict) return 'conflicted';
  if (!preferred) return 'unsupported';
  if (isOfficialConfidence(preferred.confidence)) return 'verified';
  return 'verified';
}

function buildGroupRecord({
  canonicalFactId,
  facts,
  sourceById,
}) {
  const ranked = facts
    .map((f) => ({
      fact: f,
      priority: sourceRankForFact(f, sourceById),
    }))
    .sort((a, b) => b.priority.rank - a.priority.rank);

  const preferred = ranked[0]?.fact || null;
  let conflict = null;
  for (let i = 1; i < ranked.length; i += 1) {
    const c = claimsConflict(extractNumericClaims(preferred), extractNumericClaims(ranked[i].fact));
    if (c) {
      conflict = {
        ...c,
        lowerFactId: ranked[i].fact.id,
        lowerSummary: ranked[i].fact.summary,
        lowerSource: ranked[i].priority.label,
      };
      break;
    }
  }

  const status = verificationStatusForGroup(facts, conflict, preferred);
  const supportingCount = facts.filter((f) => f.id !== preferred?.id && !claimsConflict(
    extractNumericClaims(preferred || {}),
    extractNumericClaims(f)
  )).length;
  const conflictingCount = status === 'conflicted' ? facts.length - 1 : 0;

  return {
    canonicalFactId,
    topic: topicLabel(preferred?.factType, preferred?.category),
    status,
    preferredFactId: preferred?.id || null,
    preferredSummary: preferred?.summary || null,
    preferredSource: ranked[0]?.priority.label || null,
    preferredConfidence: preferred?.confidence || null,
    supportingSourceCount: supportingCount,
    conflictingSourceCount: conflictingCount,
    conflictDetail: conflict,
    factIds: facts.map((f) => f.id),
    verificationRecords: facts.map((f) => ({
      factId: f.id,
      summary: f.summary,
      confidence: f.confidence,
      factType: f.factType,
      category: f.category,
      sourceLabel: sourceRankForFact(f, sourceById).label,
      sourceTypes: sourceRankForFact(f, sourceById).sourceTypes,
      numericClaims: extractNumericClaims(f),
      canonicalFactId: f.canonicalFactId || null,
    })),
  };
}

function groupChampionshipByDriver(facts) {
  const groups = new Map();
  for (const f of facts.filter((x) => x.factType === 'championship')) {
    const driver = (f.driverNames?.[0] || f.driverIds?.[0] || 'unknown').toString().toLowerCase();
    const key = `championship-driver:${driver}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  return groups;
}

export function buildFactVerificationReport({ racePackage, preparedFacts }) {
  const facts = preparedFacts || racePackage?.facts || [];
  const sourceById = sourceByIdFromPackage(racePackage);
  const canonicalGroups = new Map();

  for (const f of facts) {
    const cid = f.canonicalFactId || null;
    if (!cid) continue;
    if (!canonicalGroups.has(cid)) canonicalGroups.set(cid, []);
    canonicalGroups.get(cid).push(f);
  }

  const canonicalIssues = [];
  const suppressedFactIds = new Set();
  const repairSuggestions = [];
  const verifiedCategories = {
    winner: true,
    championship: true,
    standings: true,
    race_control: true,
  };

  const preferredFactIds = new Set();

  for (const [cid, groupFacts] of canonicalGroups.entries()) {
    const record = buildGroupRecord({ canonicalFactId: cid, facts: groupFacts, sourceById });
    if (record.status === 'verified' && !record.conflictDetail) {
      if (record.preferredFactId) preferredFactIds.add(record.preferredFactId);
      continue;
    }

    if (record.status === 'conflicted' || record.conflictDetail) {
      canonicalIssues.push({
        ...record,
        action: 'Writer suppressed unsupported value',
      });
      verifiedCategories.winner = record.topic.includes('Winner') ? false : verifiedCategories.winner;
      verifiedCategories.championship = record.topic.includes('Championship') ? false : verifiedCategories.championship;
      verifiedCategories.race_control = record.topic.includes('Caution') ? false : verifiedCategories.race_control;

      if (record.preferredFactId) preferredFactIds.add(record.preferredFactId);

      for (const row of record.verificationRecords) {
        if (row.factId !== record.preferredFactId) {
          suppressedFactIds.add(row.factId);
        }
      }
      if (record.conflictDetail) {
        const lower = record.verificationRecords.find((r) => r.factId === record.conflictDetail.lowerFactId);
        if (lower) {
          repairSuggestions.push({
            factId: lower.factId,
            canonicalFactId: cid,
            currentValue: record.conflictDetail.b,
            preferredValue: record.conflictDetail.a,
            preferredFactId: record.preferredFactId,
            source: record.preferredSource,
            reason: `Lower-priority source disagrees on ${record.conflictDetail.field}`,
          });
        }
      }
    } else if (record.status === 'unsupported') {
      canonicalIssues.push({ ...record, action: 'No verified preferred fact' });
    }
  }

  for (const [key, groupFacts] of groupChampionshipByDriver(facts).entries()) {
    if (groupFacts.length < 2) continue;
    const record = buildGroupRecord({ canonicalFactId: key, facts: groupFacts, sourceById });
    const pointsClaims = groupFacts.map((f) => ({ id: f.id, claims: extractNumericClaims(f) }));
    const distinctPoints = new Set(pointsClaims.map((p) => p.claims.points).filter((v) => v != null));
    if (distinctPoints.size <= 1) continue;
    if (canonicalIssues.some((i) => i.topic === 'Championship points' && i.factIds?.includes(groupFacts[0].id))) {
      continue;
    }
    canonicalIssues.push({
      ...record,
      topic: 'Championship points',
      action: 'Writer suppressed unsupported value',
    });
    verifiedCategories.championship = false;
    verifiedCategories.standings = false;
    if (record.preferredFactId) preferredFactIds.add(record.preferredFactId);
    for (const p of pointsClaims) {
      if (p.id !== record.preferredFactId) {
        suppressedFactIds.add(p.id);
      }
    }
    repairSuggestions.push({
      factId: pointsClaims.find((p) => p.id !== record.preferredFactId)?.id,
      canonicalFactId: key,
      currentValue: [...distinctPoints].pop(),
      preferredValue: extractNumericClaims(groupFacts.find((f) => f.id === record.preferredFactId) || groupFacts[0]).points,
      preferredFactId: record.preferredFactId,
      source: record.preferredSource,
      reason: 'Conflicting championship point totals across sources',
    });
  }

  for (const f of facts.filter((x) => x.confidence === 'conflicting')) {
    suppressedFactIds.add(f.id);
    canonicalIssues.push({
      canonicalFactId: f.canonicalFactId || `conflict:${f.id}`,
      topic: topicLabel(f.factType, f.category),
      status: 'conflicted',
      preferredFactId: null,
      preferredSummary: null,
      preferredSource: null,
      action: 'Writer suppressed conflicting fact',
      factIds: [f.id],
      verificationRecords: [
        {
          factId: f.id,
          summary: f.summary,
          confidence: f.confidence,
          sourceLabel: sourceRankForFact(f, sourceById).label,
          numericClaims: extractNumericClaims(f),
        },
      ],
    });
    if (f.factType === 'championship') verifiedCategories.championship = false;
  }

  for (const id of preferredFactIds) {
    suppressedFactIds.delete(id);
  }

  const suppressedNumericTokens = [];
  for (const f of facts) {
    if (!suppressedFactIds.has(f.id)) continue;
    for (const val of Object.values(extractNumericClaims(f))) {
      if (val != null) suppressedNumericTokens.push(String(val));
    }
  }

  const safePhrasingHints = [];
  if (!verifiedCategories.championship) {
    safePhrasingHints.push({
      topic: 'championship',
      hint: 'Describe championship impact without specific point totals unless verified.',
      example: 'Carroll retained the championship lead despite Levine\'s victory.',
    });
  }

  return {
    version: WRITER_VERIFICATION_VERSION,
    canonicalIssues,
    suppressedFactIds: [...suppressedFactIds],
    suppressedNumericTokens: [...new Set(suppressedNumericTokens)].filter(Boolean),
    repairSuggestions,
    verifiedCategories,
    safePhrasingHints,
    writerRules: [
      'Do not state numeric statistics that appear in suppressedNumericTokens.',
      'Use safe phrasing hints when championship or standings verification failed.',
      'Prefer verified quotes and racecraft detail over generic adjectives.',
      'Never invent cautions, margins, or points.',
    ],
    summary: {
      issueCount: canonicalIssues.length,
      suppressedFactCount: suppressedFactIds.size,
      repairSuggestionCount: repairSuggestions.length,
    },
  };
}

export function applyVerificationToSectionEvidence(evidence, factVerification) {
  if (!factVerification || !evidence) return evidence;
  const suppressed = new Set(factVerification.suppressedFactIds || []);
  const facts = (evidence.facts || []).filter((f) => !suppressed.has(f.factId));
  return {
    ...evidence,
    facts,
    factVerificationGuidance: {
      suppressedNumericTokens: factVerification.suppressedNumericTokens || [],
      safePhrasingHints: factVerification.safePhrasingHints || [],
      writerRules: factVerification.writerRules || [],
      verifiedCategories: factVerification.verifiedCategories || {},
    },
  };
}

export function sanitizeWriterText(text, factVerification) {
  if (!text || !factVerification?.suppressedNumericTokens?.length) return text;
  let out = String(text);
  for (const token of factVerification.suppressedNumericTokens) {
    const re = new RegExp(`\\b${token}\\b`, 'g');
    out = out.replace(re, '[[suppressed-stat]]');
  }
  return out.replace(/\[\[suppressed-stat\]\]\s*points?\b/gi, 'the championship lead').replace(/\[\[suppressed-stat\]\]/g, '').trim();
}

export function sanitizeHeadlinePack(headlinePack, factVerification) {
  if (!headlinePack || !factVerification) return headlinePack;
  const tokens = factVerification.suppressedNumericTokens || [];
  const hasBad = (s) => tokens.some((t) => t && String(s).includes(String(t)));
  let headline = headlinePack.headline;
  let subheadline = headlinePack.subheadline;
  if (hasBad(headline) || hasBad(subheadline)) {
    headline = headline.replace(/\d+/g, '').replace(/\s+/g, ' ').trim() || headlinePack.headline;
    subheadline = subheadline.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  }
  return { ...headlinePack, headline, subheadline };
}

export function buildFactCorrectnessValidation(factVerification, { body = '', headline = '' } = {}) {
  if (!factVerification) return { checks: [], scorePenalty: 0, flags: [] };
  const flags = [];
  const checks = [];
  const vc = factVerification.verifiedCategories || {};
  checks.push({ id: 'winner_verified', ok: vc.winner !== false, label: 'Winner verified' });
  checks.push({ id: 'championship_verified', ok: vc.championship !== false, label: 'Championship verified' });
  checks.push({ id: 'standings_verified', ok: vc.standings !== false, label: 'Standings verified' });
  checks.push({ id: 'race_control_verified', ok: vc.race_control !== false, label: 'Race control verified' });

  const suppressedConflict = (factVerification.canonicalIssues || []).length > 0;
  checks.push({
    id: 'conflict_suppressed',
    ok: suppressedConflict,
    warn: true,
    label: suppressedConflict ? 'Conflicting canonical fact suppressed' : 'No canonical conflicts',
  });

  let unsupportedRemoved = false;
  for (const token of factVerification.suppressedNumericTokens || []) {
    if (token && String(body).includes(String(token))) {
      unsupportedRemoved = true;
      break;
    }
  }
  checks.push({
    id: 'unsupported_stat_in_body',
    ok: !unsupportedRemoved,
    label: unsupportedRemoved ? 'Unsupported statistic still in body' : 'Unsupported statistic removed',
  });

  let headlineConflict = false;
  for (const token of factVerification.suppressedNumericTokens || []) {
    if (token && String(headline).includes(String(token))) headlineConflict = true;
  }
  checks.push({
    id: 'headline_verified',
    ok: !headlineConflict,
    label: headlineConflict ? 'Headline uses disputed fact' : 'Headline avoids disputed facts',
  });

  let scorePenalty = 0;
  for (const c of checks) {
    if (c.warn) continue;
    if (!c.ok) scorePenalty += c.id.includes('championship') || c.id.includes('winner') ? 18 : 10;
  }
  if (suppressedConflict) flags.push('conflicting_canonical_suppressed');
  if (unsupportedRemoved) flags.push('unsupported_statistic_in_body');

  return { checks, scorePenalty, flags };
}

export function factCorrectnessValidationScore(baseScore, factVerification, article) {
  const fc = buildFactCorrectnessValidation(factVerification, {
    body: article?.body || '',
    headline: article?.headline || '',
  });
  return Math.max(0, baseScore - fc.scorePenalty);
}
