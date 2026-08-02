import {
  getRaceResearchTranscriptMode,
  isRaceResearchAiExtractionEnabled,
  isRaceResearchDiagnosticAiAllowed,
  RACE_RESEARCH_EXTRACTION_VERSION,
} from '../server/config/race-research-config.js';
import { preprocessTranscriptChunk } from './_race-research-transcript-preprocess.js';
import { collectDriverFields, resolveDriverNames } from './_race-research-driver-resolve.js';

const EVENT_KEYWORDS = [
  { pattern: /\bcaution\b/i, category: 'caution' },
  { pattern: /\byellow flag\b/i, category: 'caution' },
  { pattern: /\blead change\b/i, category: 'lead_change' },
  { pattern: /\btakes the lead\b/i, category: 'lead_change' },
  { pattern: /\bpenalty\b/i, category: 'penalty' },
  { pattern: /\bblack flag\b/i, category: 'penalty' },
  { pattern: /\bwreck\b|\bcrash\b|\bincident\b/i, category: 'incident' },
  { pattern: /\bpit stop\b|\bpit road\b/i, category: 'pit_stop' },
  { pattern: /\bwins?\b|\bvictory\b|\bcheckered\b/i, category: 'finish' },
  { pattern: /\brestart\b/i, category: 'restart' },
];

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

export function extractTranscriptChunkDeterministic(chunkText, preprocess = null) {
  const sentences = splitSentences(chunkText);
  const events = [];
  const quotes = [];
  const meta = preprocess || preprocessTranscriptChunk(chunkText);

  for (const sentence of sentences) {
    for (const { pattern, category } of EVENT_KEYWORDS) {
      if (!pattern.test(sentence)) continue;
      events.push({
        temporaryEventKey: `det-${hashSnippet(sentence)}`,
        category,
        summary: sentence.slice(0, 400),
        driverNames: [],
        lapNumber: null,
        lapNumberConfidence: 'unknown',
        certainty: 'reported_by_broadcast',
        importanceScore: category === 'finish' ? 80 : 45,
        supportingExcerpt: sentence.slice(0, 240),
      });
      break;
    }

    const quoteMatch = sentence.match(/"([^"]{8,180})"/);
    if (quoteMatch) {
      quotes.push({
        speakerRaw: 'Unknown',
        quote: quoteMatch[1],
        quoteCompleteness: 'uncertain',
        importanceScore: 40,
        supportingExcerpt: sentence.slice(0, 240),
      });
    }
  }

  return normalizeExtractionPayload({
    chunkSummary: {
      racePhase: meta.racePhase || 'unknown',
      primaryTopics: meta.primaryTopics || [],
      informationDensity: meta.informationDensity || 'medium',
    },
    events: events.slice(0, 40),
    quotes: quotes.slice(0, 8),
    driverStoryDevelopments: [],
    unresolvedReferences: [],
  });
}

function hashSnippet(text) {
  let h = 0;
  const s = String(text).slice(0, 80);
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return String(h);
}

export function validateTranscriptChunkExtraction(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Extraction must be an object'], value: null };
  }

  const errors = [];
  const events = Array.isArray(raw.events) ? raw.events : [];
  const quotes = Array.isArray(raw.quotes) ? raw.quotes : [];

  for (const event of events) {
    if (!event.summary || typeof event.summary !== 'string') errors.push('Event missing summary');
    if (event.lapNumber != null && event.lapNumberConfidence === 'unknown' && !Number.isFinite(Number(event.lapNumber))) {
      errors.push('Invalid lap number');
    }
    if (event.lapNumberConfidence === 'unknown' && event.lapNumber != null) {
      event.lapNumber = null;
    }
  }

  for (const quote of quotes) {
    if (!quote.quote || typeof quote.quote !== 'string') errors.push('Quote missing text');
  }

  if (errors.length) return { valid: false, errors: [...new Set(errors)], value: null };

  return { valid: true, errors: [], value: normalizeExtractionPayload(raw) };
}

function normalizeExtractionPayload(raw) {
  return {
    chunkSummary: {
      racePhase: raw.chunkSummary?.racePhase || 'unknown',
      primaryTopics: Array.isArray(raw.chunkSummary?.primaryTopics) ? raw.chunkSummary.primaryTopics : [],
      informationDensity: raw.chunkSummary?.informationDensity || 'medium',
    },
    events: (raw.events || []).map((e) => ({
      temporaryEventKey: e.temporaryEventKey || hashSnippet(e.summary),
      category: e.category || 'other',
      summary: String(e.summary || '').slice(0, 500),
      significance: e.significance ? String(e.significance).slice(0, 300) : null,
      driverNames: Array.isArray(e.driverNames) ? e.driverNames : [],
      carNumbers: Array.isArray(e.carNumbers) ? e.carNumbers : [],
      lapNumber:
        e.lapNumberConfidence === 'explicit' && Number.isFinite(Number(e.lapNumber))
          ? Number(e.lapNumber)
          : null,
      lapNumberConfidence: e.lapNumberConfidence || 'unknown',
      timestampStart: e.timestampStart ?? null,
      timestampEnd: e.timestampEnd ?? null,
      certainty: e.certainty || 'reported_by_broadcast',
      importanceScore: Number(e.importanceScore) || 40,
      supportingExcerpt: String(e.supportingExcerpt || e.summary || '').slice(0, 280),
    })),
    quotes: (raw.quotes || []).map((q) => ({
      speakerRaw: q.speakerRaw || q.speaker || 'Unknown',
      speakerRole: q.speakerRole || null,
      quote: String(q.quote || '').slice(0, 400),
      quoteCompleteness: q.quoteCompleteness || 'uncertain',
      context: q.context ? String(q.context).slice(0, 200) : null,
      timestampStart: q.timestampStart ?? null,
      timestampEnd: q.timestampEnd ?? null,
      importanceScore: Number(q.importanceScore) || 35,
      supportingExcerpt: String(q.supportingExcerpt || q.quote || '').slice(0, 280),
    })),
    driverStoryDevelopments: (raw.driverStoryDevelopments || []).map((d) => ({
      driverNames: Array.isArray(d.driverNames) ? d.driverNames : [],
      storylineType: d.storylineType || 'other',
      summary: String(d.summary || '').slice(0, 400),
      importanceScore: Number(d.importanceScore) || 35,
      supportingExcerpt: String(d.supportingExcerpt || d.summary || '').slice(0, 240),
    })),
    unresolvedReferences: Array.isArray(raw.unresolvedReferences) ? raw.unresolvedReferences : [],
  };
}

const AI_SYSTEM_PROMPT = `Extract race evidence from ONE broadcast transcript chunk. Return JSON only matching this schema:
chunkSummary { racePhase, primaryTopics[], informationDensity }
events[] { temporaryEventKey, category, summary, significance, driverNames[], carNumbers[], lapNumber, lapNumberConfidence, certainty, importanceScore, supportingExcerpt }
quotes[] { speakerRaw, speakerRole, quote, quoteCompleteness, context, importanceScore, supportingExcerpt }
driverStoryDevelopments[] { driverNames[], storylineType, summary, importanceScore, supportingExcerpt }
unresolvedReferences[] { text, likelyType }

Rules: extract ONLY facts supported by the chunk; distinguish confirmed_by_broadcast vs speculation; do NOT invent lap numbers (use lapNumberConfidence unknown); preserve uncertainty; ignore ads/chatter; no markdown.`;

export async function extractTranscriptChunkWithAi(chunkText, options = {}) {
  if (typeof options.extractor === 'function') {
    const raw = await options.extractor(chunkText, options);
    return validateTranscriptChunkExtraction(raw).value || extractTranscriptChunkDeterministic(chunkText, options.preprocess);
  }

  const allowPaid =
    options.allowAi === true
      ? isRaceResearchDiagnosticAiAllowed(options)
      : isRaceResearchAiExtractionEnabled();

  if (!allowPaid) {
    return extractTranscriptChunkDeterministic(chunkText, options.preprocess);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.RACE_RESEARCH_EXTRACTION_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const preprocess = options.preprocess || preprocessTranscriptChunk(chunkText, options.preprocessOptions || {});

  const userContent = JSON.stringify({
    chunkPreprocess: preprocess,
    chunkText: chunkText.slice(0, 12000),
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Transcript extraction failed (${response.status})`);
  }

  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  const parsed = JSON.parse(content);
  const validated = validateTranscriptChunkExtraction(parsed);
  if (!validated.valid) {
    throw new Error(`AI extraction validation failed: ${validated.errors.join('; ')}`);
  }
  validated.value._meta = {
    extractionMethod: 'ai',
    model,
    usage: data.usage || null,
  };
  return validated.value;
}

export async function extractTranscriptChunkHybrid(chunkText, options = {}) {
  const preprocess = preprocessTranscriptChunk(chunkText, options.preprocessOptions || {});
  const mode = options.transcriptMode || getRaceResearchTranscriptMode();

  if (mode === 'deterministic' || (mode === 'hybrid' && preprocess.skipAiInHybrid)) {
    const det = extractTranscriptChunkDeterministic(chunkText, preprocess);
    det._meta = { extractionMethod: 'deterministic', skippedAi: preprocess.skipAiInHybrid === true };
    return det;
  }

  if (mode === 'ai' || mode === 'hybrid') {
    try {
      const ai = await extractTranscriptChunkWithAi(chunkText, { ...options, preprocess });
      ai._meta = { ...(ai._meta || {}), extractionMethod: mode === 'hybrid' ? 'hybrid_ai' : 'ai' };
      return ai;
    } catch (error) {
      if (mode === 'ai') throw error;
      const det = extractTranscriptChunkDeterministic(chunkText, preprocess);
      det._meta = { extractionMethod: 'hybrid_fallback_deterministic', aiError: error.message };
      return det;
    }
  }

  return extractTranscriptChunkDeterministic(chunkText, preprocess);
}

function certaintyToConfidence(certainty) {
  switch (certainty) {
    case 'confirmed_by_broadcast':
      return 'broadcast_reported';
    case 'speculation':
    case 'unclear':
      return 'unverified';
    default:
      return 'broadcast_reported';
  }
}

export function transcriptExtractionToFacts(extraction, context) {
  const facts = [];
  let order = context.sequenceStart || 0;
  const { seasonId, raceNumber, raceId, sourceId, chunkId, driverLookup } = context;
  const method = extraction._meta?.extractionMethod || 'deterministic';

  for (const event of extraction.events || []) {
    const resolutions = resolveDriverNames(event.driverNames, driverLookup);
    const { driverIds, driverNames } = collectDriverFields(resolutions);

    facts.push({
      seasonId,
      raceNumber,
      raceId,
      factType: mapEventCategoryToFactType(event.category),
      category: event.category || 'broadcast',
      summary: String(event.significance ? `${event.summary} (${event.significance})` : event.summary).slice(0, 500),
      driverIds,
      driverNames,
      lapNumber: event.lapNumber,
      sequenceOrder: order++,
      importanceScore: Number(event.importanceScore) || 40,
      confidence: certaintyToConfidence(event.certainty),
      structuredData: {
        broadcast: true,
        extractionMethod: method,
        temporaryEventKey: event.temporaryEventKey,
        racePhase: extraction.chunkSummary?.racePhase,
        certainty: event.certainty,
        carNumbers: event.carNumbers || [],
      },
      evidenceLinks: [
        {
          sourceId,
          chunkId,
          supportType: 'primary',
          sourceExcerpt: event.supportingExcerpt || null,
        },
      ],
    });
  }

  for (const quote of extraction.quotes || []) {
    facts.push({
      seasonId,
      raceNumber,
      raceId,
      factType: 'quote',
      category: 'broadcast_quote',
      summary: `${quote.speakerRaw}: "${String(quote.quote || '').slice(0, 280)}"`,
      sequenceOrder: order++,
      importanceScore: Number(quote.importanceScore) || 35,
      confidence: 'broadcast_reported',
      structuredData: {
        speakerRaw: quote.speakerRaw,
        quote: quote.quote,
        quoteCompleteness: quote.quoteCompleteness,
        extractionMethod: method,
      },
      evidenceLinks: [
        {
          sourceId,
          chunkId,
          supportType: 'primary',
          sourceExcerpt: quote.supportingExcerpt || quote.quote,
        },
      ],
    });
  }

  for (const dev of extraction.driverStoryDevelopments || []) {
    const resolutions = resolveDriverNames(dev.driverNames, driverLookup);
    const { driverIds, driverNames } = collectDriverFields(resolutions);
    facts.push({
      seasonId,
      raceNumber,
      raceId,
      factType: 'trend',
      category: dev.storylineType || 'driver_story',
      summary: dev.summary,
      driverIds,
      driverNames,
      sequenceOrder: order++,
      importanceScore: Number(dev.importanceScore) || 40,
      confidence: 'broadcast_reported',
      structuredData: { extractionMethod: method, storylineType: dev.storylineType },
      evidenceLinks: [{ sourceId, chunkId, supportType: 'primary', sourceExcerpt: dev.supportingExcerpt }],
    });
  }

  return { facts, nextSequence: order };
}

function mapEventCategoryToFactType(category) {
  const map = {
    lead_change: 'lead_change',
    position_battle: 'lead_change',
    caution: 'caution',
    incident: 'incident',
    penalty: 'penalty',
    pit_stop: 'strategy',
    strategy: 'strategy',
    restart: 'race_event',
    finish: 'race_event',
    start: 'race_event',
    championship: 'championship',
    mechanical: 'incident',
    recovery: 'trend',
  };
  return map[String(category || '').toLowerCase()] || 'race_event';
}

export function compareExtractions(deterministic, ai) {
  const detEvents = deterministic?.events?.length || 0;
  const aiEvents = ai?.events?.length || 0;
  return {
    deterministic: {
      factsFound: detEvents + (deterministic?.quotes?.length || 0),
      events: detEvents,
      quotes: deterministic?.quotes?.length || 0,
    },
    ai: {
      factsFound: aiEvents + (ai?.quotes?.length || 0),
      events: aiEvents,
      quotes: ai?.quotes?.length || 0,
    },
  };
}
