import { isOfficialConfidence } from './_news-writer-fact-quality.js';

export const REQUIRED_RECAP_ROLES = [
  'verified_winner',
  'winner_start_position',
  'winner_finish_position',
  'winner_positions_gained',
  'official_caution_count',
  'major_milestone',
  'championship_impact',
  'decisive_race_development',
];

function findOfficialWinner(facts) {
  const winners = facts.filter(
    (f) =>
      f.category === 'winner' ||
      (f.factType === 'result' && Number(f.structuredData?.finishPosition) === 1 && isOfficialConfidence(f.confidence))
  );
  winners.sort((a, b) => (isOfficialConfidence(b.confidence) ? 1 : 0) - (isOfficialConfidence(a.confidence) ? 1 : 0));
  return winners[0] || null;
}

function findCautionCountFact(facts) {
  return (
    facts.find((f) => f.structuredData?.cautionCount != null) ||
    facts.find(
      (f) =>
        isOfficialConfidence(f.confidence) &&
        /\b(\d+)\s+cautions?\b/i.test(String(f.summary || '')) &&
        (f.factType === 'caution' || f.category === 'race_control' || f.factType === 'race_event')
    )
  );
}

function findMilestoneFact(facts, winner) {
  const winnerId = winner?.driverIds?.[0];
  return facts.find(
    (f) =>
      /third win|3rd win|three wins on the season|season win/i.test(String(f.summary || '')) &&
      (!winnerId || (f.driverIds || []).includes(winnerId) || !f.driverIds?.length)
  );
}

function findChampionshipImpact(facts) {
  return facts.find(
    (f) =>
      f.factType === 'championship' &&
      isOfficialConfidence(f.confidence) &&
      (f.structuredData?.movement != null || f.category === 'standings_snapshot' || f.category === 'points_leader')
  );
}

function findDecisiveDevelopment(facts) {
  const ranked = facts
    .filter(
      (f) =>
        ['lead_change', 'race_event', 'incident', 'penalty', 'restart'].includes(f.factType) &&
        f.planningEligible !== false &&
        (f.factQuality?.qualityScore ?? 50) >= 45
    )
    .sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));
  return ranked[0] || null;
}

export function buildRequiredRecapFacts(facts) {
  const winner = findOfficialWinner(facts);
  const items = [];

  if (winner) {
    items.push({
      role: 'verified_winner',
      factId: winner.id,
      label: 'Verified race winner',
      required: true,
      present: true,
    });
    const start = winner.structuredData?.startPosition;
    const finish = winner.structuredData?.finishPosition ?? 1;
    const gained =
      winner.structuredData?.positionsGained ??
      (start != null && finish != null ? start - finish : null);

    if (start != null) {
      items.push({
        role: 'winner_start_position',
        factId: winner.id,
        label: `Winner start P${start}`,
        required: true,
        present: true,
      });
    } else {
      items.push({ role: 'winner_start_position', factId: null, label: 'Winner starting position', required: false, present: false });
    }
    items.push({
      role: 'winner_finish_position',
      factId: winner.id,
      label: `Winner finish P${finish}`,
      required: true,
      present: true,
    });
    if (gained != null) {
      items.push({
        role: 'winner_positions_gained',
        factId: winner.id,
        label: `Winner positions ${gained >= 0 ? 'gained' : 'lost'}: ${Math.abs(gained)}`,
        required: true,
        present: true,
        positionsGained: gained,
      });
    }
  } else {
    items.push({ role: 'verified_winner', factId: null, label: 'Verified race winner', required: true, present: false });
  }

  const caution = findCautionCountFact(facts);
  items.push({
    role: 'official_caution_count',
    factId: caution?.id || null,
    label: caution ? String(caution.summary).slice(0, 80) : 'Official caution count',
    required: true,
    present: Boolean(caution),
  });

  const milestone = findMilestoneFact(facts, winner);
  items.push({
    role: 'major_milestone',
    factId: milestone?.id || null,
    label: milestone ? String(milestone.summary).slice(0, 80) : 'Major season milestone',
    required: Boolean(milestone),
    present: Boolean(milestone),
  });

  const champ = findChampionshipImpact(facts);
  items.push({
    role: 'championship_impact',
    factId: champ?.id || null,
    label: champ ? String(champ.summary).slice(0, 80) : 'Championship impact',
    required: Boolean(champ),
    present: Boolean(champ),
  });

  const decisive = findDecisiveDevelopment(facts);
  items.push({
    role: 'decisive_race_development',
    factId: decisive?.id || null,
    label: decisive ? String(decisive.summary).slice(0, 80) : 'Decisive race development',
    required: Boolean(decisive),
    present: Boolean(decisive),
  });

  return {
    items,
    winnerFact: winner,
    cautionFact: caution,
    milestoneFact: milestone,
    championshipFact: champ,
    requiredFactIds: [...new Set(items.map((i) => i.factId).filter(Boolean))],
    missingRequired: items.filter((i) => i.required && !i.present),
  };
}

function mergeFactIds(story, factIds) {
  const set = new Set(story.factIds || []);
  for (const id of factIds) if (id) set.add(id);
  story.factIds = [...set];
  story.empty = story.factIds.length === 0;
}

export function applyRequiredRecapToStories(stories, requiredRecap, allFacts) {
  const byId = new Map(stories.map((s) => [s.storyId, s]));
  const winner = requiredRecap.winnerFact;
  const gained = requiredRecap.items.find((i) => i.role === 'winner_positions_gained')?.positionsGained;

  const requiredIds = requiredRecap.requiredFactIds;
  if (winner) {
    mergeFactIds(byId.get('lead_story') || stories[0], [winner.id]);
    mergeFactIds(byId.get('secondary_story') || stories[1], [winner.id]);
    if (gained != null && gained >= 10) {
      mergeFactIds(byId.get('hidden_story'), [winner.id]);
    }
  }

  if (requiredRecap.cautionFact) {
    mergeFactIds(byId.get('secondary_story'), [requiredRecap.cautionFact.id]);
    mergeFactIds(byId.get('lead_story'), [requiredRecap.cautionFact.id]);
  }
  if (requiredRecap.milestoneFact) {
    mergeFactIds(byId.get('lead_story'), [requiredRecap.milestoneFact.id]);
    mergeFactIds(byId.get('feature_story'), [requiredRecap.milestoneFact.id]);
  }
  if (requiredRecap.championshipFact) {
    mergeFactIds(byId.get('championship_story'), [requiredRecap.championshipFact.id]);
  }
  if (requiredRecap.items.find((i) => i.role === 'decisive_race_development')?.factId) {
    const id = requiredRecap.items.find((i) => i.role === 'decisive_race_development').factId;
    mergeFactIds(byId.get('secondary_story'), [id]);
  }

  for (const id of requiredIds) {
    const fact = allFacts.find((f) => f.id === id);
    if (!fact) continue;
    if (fact.factType === 'championship') mergeFactIds(byId.get('championship_story'), [id]);
  }

  return stories;
}

export function winnerRecoveryLeadBoost(winner, requiredRecap) {
  if (!winner) return 0;
  const gained = requiredRecap.items.find((i) => i.role === 'winner_positions_gained')?.positionsGained;
  const start = winner.structuredData?.startPosition;
  if (gained != null && gained >= 15) return 45 + gained;
  if (start != null && start >= 20 && winner.structuredData?.finishPosition === 1) return 55 + start;
  if (gained != null && gained >= 8) return 25 + gained;
  return 0;
}
