import { hashContent } from './_race-research-hash.js';
import { collectDriverFields, resolveDriverEntity } from './_race-research-driver-resolve.js';

function normalizeSummary(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function factDedupeKey(fact) {
  return [
    fact.factType,
    fact.category || '',
    fact.lapNumber ?? '',
    normalizeSummary(fact.summary),
  ].join('|');
}

const CONFIDENCE_RANK = {
  official: 7,
  officially_confirmed: 6,
  manual: 5,
  derived: 4,
  historical: 3,
  broadcast_reported: 2,
  unverified: 1,
  conflicting: 0,
};

export function mergeFactConfidence(existing, incoming) {
  const a = CONFIDENCE_RANK[existing] ?? 0;
  const b = CONFIDENCE_RANK[incoming] ?? 0;
  if (existing === 'conflicting' || incoming === 'conflicting') return 'conflicting';
  if (existing && incoming && existing !== incoming && Math.abs(a - b) <= 1 && a > 1 && b > 1) {
    return a >= b ? existing : incoming;
  }
  return a >= b ? existing : incoming;
}

/**
 * Merge duplicate fact payloads before insert (in-memory).
 * Returns { facts, conflictsDetected }
 */
export function consolidateRaceFactsInMemory(facts = []) {
  const map = new Map();
  let conflictsDetected = 0;

  for (const fact of facts) {
    const key = factDedupeKey(fact);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...fact, evidenceLinks: [...(fact.evidenceLinks || [])] });
      continue;
    }

    if (existing.summary !== fact.summary && existing.factType === fact.factType) {
      conflictsDetected += 1;
      existing.confidence = 'conflicting';
      existing.structuredData = {
        ...(existing.structuredData || {}),
        conflictNotes: [
          ...(existing.structuredData?.conflictNotes || []),
          fact.summary,
        ],
      };
    } else {
      existing.confidence = mergeFactConfidence(existing.confidence, fact.confidence);
    }

    existing.importanceScore = Math.max(existing.importanceScore || 0, fact.importanceScore || 0);
    existing.evidenceLinks.push(...(fact.evidenceLinks || []));
  }

  return { facts: [...map.values()], conflictsDetected };
}

export async function consolidateRaceFacts({ seasonId, raceNumber }) {
  const { listRaceFactsForRace } = await import('./_race-research-repository.js');
  const facts = await listRaceFactsForRace(seasonId, raceNumber);
  const withLinks = facts.map((f) => ({ ...f, evidenceLinks: [] }));
  return consolidateRaceFactsInMemory(withLinks);
}

export function buildOfficialResultFacts({
  seasonId,
  raceNumber,
  raceId,
  scheduleEntry,
  driverLookup,
  sourceId,
}) {
  if (!scheduleEntry?.driverResults) return [];

  const facts = [];
  let order = 0;

  let lookup = driverLookup;
  if (Array.isArray(driverLookup)) {
    lookup = new Map(driverLookup.map((d) => [String(d.driverId), d]));
  }

  for (const [driverId, result] of Object.entries(scheduleEntry.driverResults)) {
    if (!result?.finishPosition) continue;
    const profile = lookup?.get?.(String(driverId));
    const displayName = profile?.driverName || result.driverName || `Driver ${driverId}`;
    const resolved = resolveDriverEntity(displayName, lookup, {
      allowTrailingDigitFix: true,
    });
    const { driverIds, driverNames } = collectDriverFields([
      {
        ...resolved,
        matchedDriverId: resolved.matchedDriverId || String(driverId),
        canonicalName: resolved.canonicalName || displayName,
      },
    ]);

    const start = result.startPosition ?? result.startingPos ?? null;
    const finish = result.finishPosition;
    const positionsGained =
      Number.isFinite(start) && Number.isFinite(finish) ? start - finish : null;

    facts.push({
      seasonId,
      raceNumber,
      raceId,
      factType: 'result',
      category: 'official_finish',
      summary: `${driverNames[0] || driverId} finished P${finish}${Number.isFinite(start) ? ` from P${start}` : ''}.`,
      driverIds: driverIds.length ? driverIds : [String(driverId)],
      driverNames,
      lapNumber: null,
      sequenceOrder: order++,
      importanceScore: finish === 1 ? 100 : finish <= 3 ? 70 : finish <= 10 ? 40 : 20,
      confidence: 'official',
      structuredData: {
        finishPosition: finish,
        startPosition: start,
        positionsGained,
        lapsLed: result.lapsLed ?? null,
        incidents: result.incidents ?? null,
        averageRunningPosition: result.averageRunningPosition ?? result.avgPos ?? null,
        driverId: String(driverId),
      },
      evidenceLinks: [
        {
          sourceId,
          supportType: 'primary',
          sourceExcerpt: `finish P${finish}`,
        },
      ],
    });

    if (Number.isFinite(start)) {
      facts.push({
        seasonId,
        raceNumber,
        raceId,
        factType: 'qualifying',
        category: 'starting_grid',
        summary: `${driverNames[0] || driverId} started P${start}.`,
        driverIds: driverIds.length ? driverIds : [String(driverId)],
        driverNames,
        sequenceOrder: order++,
        importanceScore: start === 1 ? 55 : 25,
        confidence: 'official',
        structuredData: { startPosition: start, driverId: String(driverId) },
        evidenceLinks: [{ sourceId, supportType: 'primary' }],
      });
    }
  }

  return facts;
}

export function buildStandingsFacts({ seasonId, raceNumber, standingsRows, sourceId }) {
  const facts = [];
  let order = 0;
  for (const row of standingsRows || []) {
    const movement =
      Number.isFinite(row.previousPosition) && Number.isFinite(row.position)
        ? row.previousPosition - row.position
        : null;
    const movementText =
      movement == null
        ? ''
        : movement > 0
          ? ` (up ${movement} positions)`
          : movement < 0
            ? ` (down ${Math.abs(movement)} positions)`
            : ' (unchanged)';

    facts.push({
      seasonId,
      raceNumber,
      factType: 'championship',
      category: 'standings_snapshot',
      summary: `${row.driverName} is P${row.position} with ${row.points} points${movementText}.`,
      driverIds: [String(row.driverId)],
      driverNames: [row.driverName],
      sequenceOrder: order++,
      importanceScore: row.position <= 5 ? 60 : row.position <= 10 ? 40 : 15,
      confidence: 'official',
      structuredData: {
        position: row.position,
        previousPosition: row.previousPosition,
        points: row.points,
        wins: row.wins,
        top5: row.top5,
        top10: row.top10,
        movement,
      },
      evidenceLinks: [{ sourceId, supportType: 'primary' }],
    });
  }
  return facts;
}

export function buildScheduleMetadataFacts({ seasonId, raceNumber, scheduleRace, sourceId }) {
  if (!scheduleRace) return [];
  return [
    {
      seasonId,
      raceNumber,
      factType: 'race_event',
      category: 'schedule_metadata',
      summary: `Race ${raceNumber} at ${scheduleRace.track || 'unknown track'}${scheduleRace.date ? ` on ${scheduleRace.date}` : ''}${scheduleRace.winner ? ` — winner ${scheduleRace.winner}` : ''}.`,
      importanceScore: 80,
      confidence: 'official',
      structuredData: {
        track: scheduleRace.track,
        date: scheduleRace.date,
        winner: scheduleRace.winner,
      },
      evidenceLinks: [{ sourceId, supportType: 'primary' }],
    },
  ];
}

export function buildRaceControlFacts({ seasonId, raceNumber, report, sourceId, driverLookup }) {
  const facts = [];
  if (!report?.parsedJson) return facts;

  const json = report.parsedJson;
  let order = 0;

  for (const result of json.results || []) {
    const name = result.driverName || result.name;
    const resolved = resolveDriverEntity(name, driverLookup);
    const { driverIds, driverNames } = collectDriverFields([resolved]);
    facts.push({
      seasonId,
      raceNumber,
      factType: 'result',
      category: 'race_control_results',
      summary: `${driverNames[0] || name} listed P${result.position} in Race Control results.`,
      driverIds,
      driverNames: driverNames.length ? driverNames : [name].filter(Boolean),
      sequenceOrder: order++,
      importanceScore: result.position === 1 ? 95 : 35,
      confidence: 'official',
      structuredData: { position: result.position, carNumber: result.carNumber ?? null },
      evidenceLinks: [{ sourceId, supportType: 'primary' }],
    });
  }

  for (const event of json.raceEvents || []) {
    const text = event.message || event.text || event.description || JSON.stringify(event);
    facts.push({
      seasonId,
      raceNumber,
      factType: mapRaceControlEventType(event),
      category: event.type || event.category || 'race_control',
      summary: String(text).slice(0, 500),
      lapNumber: Number.isFinite(Number(event.lap)) ? Number(event.lap) : null,
      sequenceOrder: order++,
      importanceScore: 50,
      confidence: 'official',
      structuredData: { raw: event },
      evidenceLinks: [{ sourceId, supportType: 'primary', sourceExcerpt: String(text).slice(0, 240) }],
    });
  }

  if (json.cautionCount != null) {
    facts.push({
      seasonId,
      raceNumber,
      factType: 'caution',
      category: 'race_control_summary',
      summary: `Race Control reports ${json.cautionCount} caution(s).`,
      importanceScore: 65,
      confidence: 'official',
      structuredData: { cautionCount: json.cautionCount },
      evidenceLinks: [{ sourceId, supportType: 'primary' }],
    });
  }

  return facts;
}

function mapRaceControlEventType(event) {
  const type = String(event?.type || event?.category || '').toLowerCase();
  if (type.includes('caution')) return 'caution';
  if (type.includes('penalty')) return 'penalty';
  if (type.includes('incident')) return 'incident';
  if (type.includes('lead')) return 'lead_change';
  return 'race_event';
}

export function buildManualNotesFacts({ seasonId, raceNumber, notes, sourceId }) {
  const text = String(notes || '').trim();
  if (!text) return [];
  return [
    {
      seasonId,
      raceNumber,
      factType: 'manual_note',
      category: 'admin_notes',
      summary: text.slice(0, 2000),
      importanceScore: 75,
      confidence: 'manual',
      structuredData: { length: text.length, contentHash: hashContent(text) },
      evidenceLinks: [{ sourceId, supportType: 'primary', sourceExcerpt: text.slice(0, 400) }],
    },
  ];
}
