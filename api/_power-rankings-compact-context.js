export const OPENAI_INTER_CALL_DELAY_MS = 400;
export const PROMPT_TOKEN_SOFT_LIMIT = 20000;
export const PROMPT_TOKEN_HARD_LIMIT = 30000;

export function estimatePromptTokens(text) {
  const value = String(text || '');
  if (!value) return 0;
  return Math.ceil(value.length / 4);
}

export function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, message) => {
    const content = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content || '');
    return sum + estimatePromptTokens(content) + 4;
  }, 0);
}

export function guardPromptMessages(messages, options = {}) {
  const softLimit = options.softLimit ?? PROMPT_TOKEN_SOFT_LIMIT;
  const hardLimit = options.hardLimit ?? PROMPT_TOKEN_HARD_LIMIT;
  let strippedOptionalContext = false;
  let workingMessages = messages;

  let estimatedTokens = estimateMessagesTokens(workingMessages);
  if (estimatedTokens > softLimit && typeof options.stripOptional === 'function') {
    workingMessages = options.stripOptional(workingMessages);
    strippedOptionalContext = true;
    estimatedTokens = estimateMessagesTokens(workingMessages);
  }

  if (estimatedTokens > hardLimit) {
    const error = new Error(
      `Prompt too large (${estimatedTokens} estimated tokens, limit ${hardLimit}). Reduce race notes or transcript context and try again.`
    );
    error.estimatedPromptTokens = estimatedTokens;
    throw error;
  }

  return {
    messages: workingMessages,
    estimatedTokens,
    strippedOptionalContext,
  };
}

function truncateText(value, maxLength) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function getTopFinishersFromRace(race, driverLookup, limit = 5) {
  if (!race?.finishes) return [];
  return Object.entries(race.finishes)
    .map(([driverId, finish]) => ({
      driverId: String(driverId),
      finish: Number(finish),
      driverName: driverLookup.get(String(driverId))?.driverName || `Driver ${driverId}`,
    }))
    .filter((entry) => Number.isFinite(entry.finish))
    .sort((a, b) => a.finish - b.finish)
    .slice(0, limit)
    .map((entry) => ({
      place: entry.finish,
      driverName: entry.driverName,
      driverId: entry.driverId,
    }));
}

function getMajorStandingsShifts(standings, limit = 5) {
  return standings
    .filter((row) => row.previousPosition && row.previousPosition !== row.position)
    .map((row) => ({
      driverName: row.driverName,
      from: row.previousPosition,
      to: row.position,
      change: row.previousPosition - row.position,
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, limit);
}

function extractRecentFacts(grounding, limit = 3) {
  const facts = [];
  if (!grounding) return facts;

  for (const race of grounding.verifiedRaceWins || []) {
    facts.push(`Won Race ${race.pointsRaceNumber} at ${race.track}.`);
  }
  for (const race of grounding.recentRaceFinishes || []) {
    facts.push(`Race ${race.raceNumber}: P${race.finish}${race.track ? ` at ${race.track}` : ''}.`);
  }
  if (grounding.last3RaceAverageFinish != null) {
    facts.push(`Last 3-race average finish: ${grounding.last3RaceAverageFinish}.`);
  }
  if (grounding.bestFinishLast3 != null) {
    facts.push(`Best finish in last 3: P${grounding.bestFinishLast3}.`);
  }

  return [...new Set(facts)].slice(0, limit);
}

function extractCareerFacts(grounding, limit = 2) {
  const facts = [];
  if (!grounding) return facts;

  const summary =
    grounding.truckSeriesCareerHistory?.leagueCareerSummary ||
    grounding.careerHistory?.truckSeriesCareerHistory?.leagueCareerSummary ||
    '';
  if (summary) {
    facts.push(truncateText(summary, 160));
  }

  const tenure = grounding.truckSeriesCareerHistory?.tenureLabel;
  if (tenure) {
    facts.push(truncateText(tenure, 120));
  }

  return facts.filter(Boolean).slice(0, limit);
}

export function buildCompactSharedRaceSummary({
  raceNumber,
  scheduleRaces,
  standings,
  alignedRaces,
  recentFormAnalysis,
  previousRankings,
  contextMeta,
  manualRaceNotes,
  driverLookup,
}) {
  const currentRace = scheduleRaces?.find(
    (race) => Number(race.officialPointsRaceNumber) === Number(raceNumber)
  );
  const mostRecentAligned = alignedRaces?.[alignedRaces.length - 1] || null;
  const transcriptSummary = truncateText(contextMeta?.broadcastContext?.summary || '', 600);
  const manualNotesExcerpt = truncateText(manualRaceNotes || '', 800);

  const previousEntries = (previousRankings?.entries || []).map((entry) => ({
    rank: entry.rank,
    driverId: String(entry.driverId),
    driverName: entry.driverName,
  }));

  const biggestMovers = [];
  if (previousRankings?.entries?.length) {
    const prevRankByDriver = Object.fromEntries(
      previousRankings.entries.map((entry) => [String(entry.driverId), Number(entry.rank)])
    );
    for (const row of standings.slice(0, 20)) {
      const prev = prevRankByDriver[String(row.driverId)];
      if (!prev) continue;
      const projected = row.position;
      if (Math.abs(prev - projected) >= 3) {
        biggestMovers.push({
          driverName: row.driverName,
          previousPowerRank: prev,
          pointsPosition: projected,
        });
      }
    }
  }

  return {
    raceNumber,
    track: currentRace?.track || mostRecentAligned?.track || null,
    winner: mostRecentAligned?.winner || recentFormAnalysis?.mostRecentRaceWinner?.driverName || null,
    top5Finishers: mostRecentAligned
      ? getTopFinishersFromRace(mostRecentAligned, driverLookup || new Map())
      : [],
    biggestMovers: biggestMovers.slice(0, 5),
    notableNotes: manualNotesExcerpt || transcriptSummary || null,
    championshipTop10: standings.slice(0, 10).map((row) => ({
      driverName: row.driverName,
      carNumber: row.carNumber,
      pointsPosition: row.position,
      points: row.points,
      wins: row.wins,
    })),
    majorStandingsShifts: getMajorStandingsShifts(standings),
    recentFormHighlights: {
      mostRecentWinner: recentFormAnalysis?.mostRecentRaceWinner?.driverName || null,
      backToBackWinners: (recentFormAnalysis?.backToBackWinners || [])
        .map((driver) => driver?.driverName)
        .filter(Boolean),
      last2RaceWinners: (recentFormAnalysis?.last2RaceWinners || [])
        .map((driver) => driver?.driverName)
        .filter(Boolean),
      hotDriversOutsideTop10: (recentFormAnalysis?.hotDriversOutsideTop10 || [])
        .map((driver) => driver?.driverName)
        .filter(Boolean),
    },
    previousPowerRankings: previousEntries,
    transcriptMode: contextMeta?.transcriptMode || 'none',
    transcriptUsed: contextMeta?.transcriptUsed === true,
  };
}

export function buildCompactDriverContext({
  rank,
  driver,
  previousPowerRank,
  grounding,
  includeOptional = true,
}) {
  const context = {
    rank,
    driverName: driver?.driverName || '',
    carNumber: driver?.carNumber || '',
    pointsPosition: driver?.position ?? null,
    points: driver?.points ?? null,
    wins: driver?.wins ?? null,
    top5: driver?.top5 ?? null,
    top10: driver?.top10 ?? null,
  };

  if (grounding) {
    if (grounding.last3RaceAverageFinish != null) {
      context.averageFinish = grounding.last3RaceAverageFinish;
    }
    if (grounding.bestFinishLast3 != null) {
      context.bestFinish = grounding.bestFinishLast3;
    }
    if (grounding.recentRaceFinishes?.length) {
      context.last3Finishes = grounding.recentRaceFinishes.map(
        (race) => `R${race.raceNumber} P${race.finish}`
      );
    }
  }

  if (previousPowerRank) {
    context.previousRanking = previousPowerRank;
    context.positionChange = previousPowerRank - Number(rank);
  }

  if (includeOptional) {
    const recentFacts = extractRecentFacts(grounding, 3);
    const careerFacts = extractCareerFacts(grounding, 2);
    if (recentFacts.length) context.recentFacts = recentFacts;
    if (careerFacts.length) context.careerFacts = careerFacts;
  }

  return context;
}

function summarizeCandidateDriver(row, grounding) {
  const summary = {
    driverId: String(row.driverId),
    driverName: row.driverName,
    carNumber: row.carNumber,
    pointsPosition: row.position,
    points: row.points,
    wins: row.wins,
    top5: row.top5,
    top10: row.top10,
  };

  if (grounding?.recentRaceFinishes?.length) {
    summary.last3Finishes = grounding.recentRaceFinishes.map(
      (race) => `R${race.raceNumber} P${race.finish}`
    );
  }
  if (grounding?.last3RaceAverageFinish != null) {
    summary.last3AvgFinish = grounding.last3RaceAverageFinish;
  }

  return summary;
}

export function buildCompactSubtitlePayload({ raceNumber, selectedTop10, compactShared }) {
  return {
    raceNumber,
    season: 'Blazing Pedals Truck Series',
    selectionMode: 'calculated-power-score',
    sharedRaceSummary: compactShared,
    entries: selectedTop10.map((row) => ({
      rank: row.rank,
      driverId: row.driverId,
      driverName: row.driverName,
      carNumber: row.carNumber,
      powerScore: row.powerScore,
      previousRank: row.previousRank,
      scoreBreakdown: row.scoreBreakdown,
    })),
    rules:
      'Subtitles only. Ranks and driverIds are fixed — do not change order or swap drivers.',
  };
}

export function buildCompactRankingStructurePayload({
  raceNumber,
  standings,
  factualGrounding,
  compactShared,
}) {
  const candidateDrivers = standings.slice(0, 25).map((row) =>
    summarizeCandidateDriver(row, factualGrounding?.drivers?.[String(row.driverId)])
  );

  return {
    raceNumber,
    season: 'Blazing Pedals Truck Series',
    sharedRaceSummary: compactShared,
    candidateDrivers,
    rules:
      'Return exactly 10 ranked drivers with unique subtitles. Leave writeup empty. Power Rankings reflect recent form, not points order.',
  };
}

export function buildCompactWriteupPayload({
  raceNumber,
  rank,
  subtitle,
  compactShared,
  compactDriver,
  manualRaceNotes,
  transcriptUsed,
  includeOptional = true,
}) {
  const payload = {
    raceNumber,
    rank,
    subtitle,
    sharedRaceSummary: compactShared,
    driver: compactDriver,
    transcriptUsed: transcriptUsed === true,
    transcriptMode: compactShared?.transcriptMode || 'none',
  };

  const notesExcerpt = truncateText(manualRaceNotes || '', includeOptional ? 1200 : 400);
  if (notesExcerpt) {
    payload.manualRaceNotesExcerpt = notesExcerpt;
  }

  return payload;
}

export function stripOptionalFromWriteupPayload(payload) {
  const next = { ...payload };
  if (next.driver) {
    const { recentFacts, careerFacts, ...rest } = next.driver;
    next.driver = rest;
  }
  if (next.sharedRaceSummary) {
    next.sharedRaceSummary = {
      ...next.sharedRaceSummary,
      notableNotes: truncateText(next.sharedRaceSummary.notableNotes || '', 300),
      biggestMovers: (next.sharedRaceSummary.biggestMovers || []).slice(0, 3),
      majorStandingsShifts: (next.sharedRaceSummary.majorStandingsShifts || []).slice(0, 3),
    };
  }
  if (next.manualRaceNotesExcerpt) {
    next.manualRaceNotesExcerpt = truncateText(next.manualRaceNotesExcerpt, 400);
  }
  return next;
}
