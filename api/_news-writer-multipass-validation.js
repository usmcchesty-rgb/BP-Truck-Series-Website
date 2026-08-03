import {
  ARTICLE_DEPTH_WORD_RANGES,
  normalizeArticleDepth,
} from '../server/config/race-research-config.js';
import { CANONICAL_COVERAGE_TARGETS } from './_news-writer-config.js';
import { buildFactCorrectnessValidation } from './_news-writer-fact-verification.js';
import { buildNewsworthinessValidation } from './_news-writer-newsworthiness.js';

function normalizeText(text) {
  return String(text || '').toLowerCase();
}

function tokenizeLabel(label) {
  return normalizeText(label)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
}

export function validateMultipassDraft({
  editedArticle,
  headlinePack,
  storyPlan,
  requiredRecap,
  ledgerSnapshot,
  coverageTargets,
  allowedDriverNames = [],
  factVerification = null,
  newsworthinessReport = null,
}) {
  const errors = [];
  const warnings = [];
  const body = normalizeText(editedArticle.body);
  const headline = normalizeText(headlinePack?.headline || editedArticle.headline);

  const depth = normalizeArticleDepth(storyPlan.articleDepth);
  const range = ARTICLE_DEPTH_WORD_RANGES[depth];
  const words = String(editedArticle.body || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  if (words < range.minimum * 0.85) {
    errors.push({ type: 'word_count_low', message: `Body ${words} words below depth minimum ${range.minimum}.` });
  }
  if (words > range.maximum * 1.15) {
    warnings.push({ type: 'word_count_high', message: `Body ${words} words above depth maximum ${range.maximum}.` });
  }

  for (const item of requiredRecap?.items || []) {
    if (!item.required || !item.present) continue;
    const probe = normalizeText(item.label).slice(0, 40);
    if (probe.length >= 8 && !body.includes(probe.split(' ')[0])) {
      const winnerProbe = /won|winner|caution|championship/i.test(item.label);
      if (winnerProbe && !body.includes('win') && item.role === 'verified_winner') {
        errors.push({ type: 'missing_required_recap', role: item.role, message: `Required recap missing: ${item.role}` });
      }
    }
  }

  const takeaways = storyPlan.readerTakeaways || [];
  for (const t of takeaways.filter((x) => x.priority <= (depth === 'in-depth' ? 2 : 1))) {
    const tokens = tokenizeLabel(t.label);
    const hit = tokens.length === 0 || tokens.some((tok) => body.includes(tok));
    if (!hit) {
      errors.push({ type: 'missing_takeaway', takeawayId: t.takeawayId, message: `Takeaway not reflected: ${t.label}` });
    }
  }

  if (storyPlan.leadStoryId) {
    const leadTokens = ['win', 'race', 'championship', 'caution', 'lead'];
    if (!leadTokens.some((t) => body.includes(t))) {
      warnings.push({ type: 'lead_story_weak', message: 'Lead story emphasis may be weak in body.' });
    }
  }

  const canonCritical = coverageTargets?.targets?.critical ?? CANONICAL_COVERAGE_TARGETS[depth]?.critical ?? 85;
  const criticalPct = ledgerSnapshot?.criticalCoveragePercent ?? 0;
  if (criticalPct < canonCritical * 0.85) {
    warnings.push({
      type: 'canonical_coverage_low',
      message: `Critical fact usage ${criticalPct}% below planning target ${canonCritical}%.`,
    });
  }

  for (const name of allowedDriverNames) {
    const artifact = /(\w+\d{1,2})$/.exec(name);
    if (artifact && body.includes(normalizeText(artifact[0]))) {
      errors.push({ type: 'hallucinated_driver_artifact', message: `Driver artifact detected: ${artifact[0]}` });
    }
  }

  if (headline && body.length > 100) {
    const headToken = headline.split(/[^a-z0-9]+/).find((t) => t.length >= 5);
    if (headToken && !body.includes(headToken)) {
      warnings.push({ type: 'headline_body_mismatch', message: 'Headline may not match body emphasis.' });
    }
  }

  const paragraphs = String(editedArticle.body || '').split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const seen = new Set();
  for (const p of paragraphs) {
    const key = p.slice(0, 80);
    if (seen.has(key)) {
      warnings.push({ type: 'duplicate_paragraph', message: 'Duplicate major paragraph detected.' });
      break;
    }
    seen.add(key);
  }

  const factCorrectness = buildFactCorrectnessValidation(factVerification, {
    body: editedArticle.body,
    headline: headlinePack?.headline || editedArticle.headline,
  });
  const newsworthinessValidation = buildNewsworthinessValidation(newsworthinessReport, {
    body: editedArticle.body,
    headline: headlinePack?.headline || editedArticle.headline,
    summary: editedArticle.summary,
  });
  for (const check of factCorrectness.checks) {
    if (check.warn && check.ok) {
      warnings.push({ type: check.id, message: check.label });
    } else if (!check.ok && !check.warn) {
      errors.push({ type: check.id, message: check.label });
    } else if (!check.ok && check.warn) {
      warnings.push({ type: check.id, message: check.label });
    }
  }

  for (const check of newsworthinessValidation.checks) {
    if (!check.ok) {
      warnings.push({ type: check.id, message: check.label });
    }
  }

  const stylePenalty = errors.filter((e) => !String(e.type).includes('verified') && !String(e.type).includes('unsupported')).length * 8;
  const factPenalty = factCorrectness.scorePenalty;
  const newsPenalty = newsworthinessValidation.scorePenalty;
  const validationScore = Math.max(0, 100 - stylePenalty - factPenalty - newsPenalty);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    wordCount: words,
    validationScore,
    factCorrectness,
    newsworthinessValidation,
    checksRun: [
      'required_recap',
      'lead_story',
      'reader_takeaways',
      'canonical_coverage',
      'word_count',
      'driver_artifacts',
      'headline_match',
      'duplicate_paragraphs',
      'fact_correctness',
      'newsroom_intelligence',
    ],
  };
}

export function buildRepairHints(validation) {
  if (validation.ok) return null;
  return {
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
    instruction: 'Fix validation errors without inventing facts. Prefer adjusting one section only.',
  };
}
