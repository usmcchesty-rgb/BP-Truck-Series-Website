import { matchDriverIdByName } from './_power-rankings-recent-form.js';
import { getAlignedRaceFinishes } from './_power-rankings-results-audit.js';
import {
  SIMRACERHUB_DATA_AUDIT,
  extractFinishRacesFromSchedules,
  summarizeLast3RaceWindow,
} from './_simracerhub-schedule-results.js';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumeric(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function ordinalToNumber(value) {
  const map = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  const lower = String(value || '').toLowerCase();
  if (map[lower]) return map[lower];
  return parseNumeric(value);
}

function matchRaceByContext(text, alignedRaces) {
  const lower = normalizeText(text);
  for (const race of alignedRaces) {
    const track = normalizeText(race.track);
    if (!track) continue;
    if (lower.includes(track) || track.split(' ').every((token) => lower.includes(token))) {
      return race;
    }
    const tokens = track.split(' ').filter((token) => token.length > 2);
    const hits = tokens.filter((token) => lower.includes(token));
    if (hits.length >= Math.min(2, tokens.length)) return race;
  }

  const raceNumberMatch = lower.match(/\brace\s*(\d+)\b/);
  if (raceNumberMatch) {
    const target = Number(raceNumberMatch[1]);
    return alignedRaces.find((race) => race.pointsRaceNumber === target) || null;
  }

  if (/\b(last race|latest race|most recent race|this past race)\b/i.test(text)) {
    return alignedRaces[alignedRaces.length - 1] || null;
  }

  return null;
}

function getVerifiedFinishForDriver(driverId, race) {
  if (!race || !driverId) return null;
  const finish = race.finishes?.[String(driverId)];
  return Number.isFinite(finish) ? finish : null;
}

function isVerifiedWinner(driverId, race, recentResults, driverLookup) {
  const finish = getVerifiedFinishForDriver(driverId, race);
  if (finish === 1) return true;

  const recent = (recentResults || []).find(
    (entry) => Number(entry.raceNumber) === Number(race.pointsRaceNumber)
  );
  if (!recent?.winner) return false;

  const winnerId = matchDriverIdByName(recent.winner, driverLookup);
  return winnerId && String(winnerId) === String(driverId);
}

function claimSupportedInNotes(claimText, manualRaceNotes, transcriptSummary) {
  const claim = normalizeText(claimText);
  if (!claim) return false;
  const sources = [manualRaceNotes, transcriptSummary].filter(Boolean).map(normalizeText);
  return sources.some((source) => source.includes(claim) || claim.split(' ').filter((word) => word.length > 3 && source.includes(word)).length >= 2);
}

function buildDriverGrounding(driverId, alignedRaces, standingsRow, recentResults, driverLookup) {
  const verifiedRaceFinishes = alignedRaces
    .map((race) => {
      const finish = getVerifiedFinishForDriver(driverId, race);
      if (!Number.isFinite(finish)) return null;
      return {
        pointsRaceNumber: race.pointsRaceNumber,
        track: race.track,
        finishPosition: finish,
        source: 'SimRacerHub schedules API',
      };
    })
    .filter(Boolean);

  const verifiedWins = alignedRaces
    .filter((race) => isVerifiedWinner(driverId, race, recentResults, driverLookup))
    .map((race) => ({
      pointsRaceNumber: race.pointsRaceNumber,
      track: race.track,
      source: getVerifiedFinishForDriver(driverId, race) === 1
        ? 'SimRacerHub schedules API'
        : 'parsed schedule page (winner only)',
    }));

  const recentRaceFinishes = verifiedRaceFinishes.map((race) => ({
    raceNumber: race.pointsRaceNumber,
    track: race.track,
    finish: race.finishPosition,
  }));

  const last3Summary = summarizeLast3RaceWindow(recentRaceFinishes, alignedRaces, driverId);

  return {
    allowedSeasonStats: standingsRow
      ? {
          pointsPosition: standingsRow.position,
          pointsTotal: standingsRow.points,
          winsTotal: standingsRow.wins,
          top5Total: standingsRow.top5,
          top10Total: standingsRow.top10,
          source: 'standings API',
        }
      : null,
    verifiedRaceFinishes,
    verifiedRaceWins: verifiedWins,
    recentRaceFinishes,
    ...last3Summary,
  };
}

export function buildFactualGroundingContext({
  standings,
  scheduleRaces,
  raceNumber,
  schedules,
  driverLookup,
  recentResults,
  manualRaceNotes,
  transcriptSummary,
}) {
  const alignedRaces = getAlignedRaceFinishes(
    scheduleRaces,
    raceNumber,
    schedules,
    driverLookup
  );

  const finishRaces = extractFinishRacesFromSchedules(schedules);
  const alignedRacesWithFinishes = alignedRaces.filter(
    (race) => Object.keys(race.finishes || {}).length > 0
  ).length;

  const drivers = {};
  let driversWithRecentRaceFinishes = 0;
  let driversWithLast3Average = 0;

  for (const [driverId, driver] of driverLookup.entries()) {
    const standingsRow = standings.find((row) => String(row.driverId) === String(driverId));
    const grounding = {
      driverName: driver.driverName,
      ...buildDriverGrounding(
        driverId,
        alignedRaces,
        standingsRow,
        recentResults,
        driverLookup
      ),
    };

    if (grounding.recentRaceFinishes?.length) driversWithRecentRaceFinishes += 1;
    if (grounding.last3RaceAverageFinish != null) driversWithLast3Average += 1;

    drivers[String(driverId)] = grounding;
  }

  return {
    rules:
      'Every writeup must use 1-3 verified facts from this object to explain the ranking. Do not invent race-specific facts. Only cite exact finishes, wins, podiums, incidents, laps led, strategy, or points facts listed here or in manualRaceNotes/transcript summary.',
    manualNotesAvailable: Boolean(String(manualRaceNotes || '').trim()),
    transcriptSummaryAvailable: Boolean(String(transcriptSummary || '').trim()),
    recentResultsWinnersOnly: recentResults,
    simRacerHubDataAudit: SIMRACERHUB_DATA_AUDIT,
    schedulesResultsSummary: {
      totalSchedules: Object.keys(schedules || {}).length,
      schedulesWithOfficialResults: finishRaces.length,
      alignedRecentRaces: alignedRaces.length,
      alignedRacesWithFinishes,
      extractionMethod: SIMRACERHUB_DATA_AUDIT.officialSession,
    },
    diagnostics: {
      recentRaceFinishesUsed: driversWithRecentRaceFinishes > 0,
      driversWithRecentRaceFinishes,
      driversWithLast3Average,
      driversTotal: driverLookup.size,
    },
    alignedRaces: alignedRaces.map((race) => ({
      pointsRaceNumber: race.pointsRaceNumber,
      track: race.track,
      winner: race.winner,
      schedulesApiFinishesCount: Object.keys(race.finishes || {}).length,
      alignmentMethod: race.alignmentMethod,
      schedulePageScheduleId: race.schedulePageScheduleId ?? null,
      schedulesApiScheduleId: race.schedulesApiScheduleId ?? null,
      alignmentMismatchWarning: race.alignmentMismatchWarning ?? null,
    })),
    drivers,
  };
}

export function buildRecentRaceFinishDiagnostics(factualGrounding, rankedEntries = []) {
  const drivers = factualGrounding?.drivers || {};
  const rankedLast3 = {};

  for (const entry of rankedEntries) {
    const grounding = drivers[String(entry.driverId)];
    if (!grounding) continue;
    rankedLast3[String(entry.rank)] = {
      driverId: String(entry.driverId),
      driverName: grounding.driverName,
      recentRaceFinishes: grounding.recentRaceFinishes || [],
      last3RaceAverageFinish: grounding.last3RaceAverageFinish ?? null,
      last3RaceStarts: grounding.last3RaceStarts ?? null,
      last3RaceWindowSize: grounding.last3RaceWindowSize ?? null,
      last3RaceDnpCount: grounding.last3RaceDnpCount ?? null,
      missedRecentRaceNames: grounding.missedRecentRaceNames || [],
      bestFinishLast3: grounding.bestFinishLast3 ?? null,
      worstFinishLast3: grounding.worstFinishLast3 ?? null,
    };
  }

  return {
    recentRaceFinishesUsed: factualGrounding?.diagnostics?.recentRaceFinishesUsed === true,
    last3RaceAverageFinish: rankedLast3,
    schedulesResultsSummary: factualGrounding?.schedulesResultsSummary ?? null,
    simRacerHubDataAudit: factualGrounding?.simRacerHubDataAudit ?? null,
    coverage: factualGrounding?.diagnostics ?? null,
  };
}

function pushUnsupported(unsupported, item) {
  unsupported.push(item);
}

function validateRaceBandClaim({
  text,
  unsupported,
  driverId,
  alignedRaces,
  band,
  manualRaceNotes,
  transcriptSummary,
}) {
  const regex =
    band === 'podium'
      ? /\b(podium|top\s*-?\s*three|top\s*-?\s*3)\b[^.!?]{0,40}\b(at|in|from)\b[^.!?]+/gi
      : new RegExp(
          `\\btop\\s*-?\\s*(${band === 'top5' ? 'five|5' : 'ten|10'})\\b[^.!?]{0,40}\\b(at|in|from)\\b[^.!?]+`,
          'gi'
        );

  for (const match of text.matchAll(regex)) {
    const snippet = match[0];
    if (claimSupportedInNotes(snippet, manualRaceNotes, transcriptSummary)) continue;

    const race = matchRaceByContext(snippet, alignedRaces);
    const verifiedFinish = getVerifiedFinishForDriver(driverId, race);
    const maxFinish = band === 'podium' ? 3 : band === 'top5' ? 5 : 10;

    if (!race || !Number.isFinite(verifiedFinish)) {
      pushUnsupported(unsupported, {
        type: band,
        message: `Unsupported ${band} claim without verified finish data.`,
        claim: snippet.trim(),
        race: race?.track || null,
      });
      continue;
    }

    if (verifiedFinish > maxFinish) {
      pushUnsupported(unsupported, {
        type: band,
        message: `Claimed ${band} at ${race.track}, but verified finish is P${verifiedFinish}.`,
        claim: snippet.trim(),
        race: race.track,
        verifiedFinish,
      });
    }
  }
}

export function validateWriteupFactualGrounding(writeup, context = {}) {
  const text = String(writeup || '');
  const unsupported = [];
  const driverId = String(context.driverId || context.factualGrounding?.driverId || '');
  const grounding = context.factualGrounding || context.driverGrounding || null;
  const alignedRaces = context.alignedRaces || [];
  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';
  const recentResults = context.recentResults || [];
  const driverLookup = context.driverLookup;
  const seasonStats = grounding?.allowedSeasonStats || null;

  const exactFinishPatterns = [
    /\bfinished\s+(?:(\d+(?:st|nd|rd|th)?)|P(\d+)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b[^.!?]{0,50}\b(at|in|from)\b[^.!?]+/gi,
    /\b(?:a|his|her|their)\s+(?:(\d+(?:st|nd|rd|th)?)|P(\d+)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b[^.!?]{0,30}\b(at|in|from)\b[^.!?]+/gi,
    /\bP(\d+)\b[^.!?]{0,30}\b(at|in|from)\b[^.!?]+/gi,
  ];

  for (const pattern of exactFinishPatterns) {
    for (const match of text.matchAll(pattern)) {
      const snippet = match[0];
      if (claimSupportedInNotes(snippet, manualRaceNotes, transcriptSummary)) continue;

      const claimedFinish =
        ordinalToNumber(match[1] || match[2]) ??
        ordinalToNumber(
          snippet.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i)?.[1]
        );

      const race = matchRaceByContext(snippet, alignedRaces);
      const verifiedFinish = getVerifiedFinishForDriver(driverId, race);

      if (!Number.isFinite(claimedFinish)) continue;

      if (!race || !Number.isFinite(verifiedFinish)) {
        pushUnsupported(unsupported, {
          type: 'exact-finish',
          message: `Unsupported exact finish claim without verified race result.`,
          claim: snippet.trim(),
          race: race?.track || null,
          claimedFinish,
        });
        continue;
      }

      if (verifiedFinish !== claimedFinish) {
        pushUnsupported(unsupported, {
          type: 'exact-finish',
          message: `Claimed P${claimedFinish} at ${race.track}, but verified finish is P${verifiedFinish}.`,
          claim: snippet.trim(),
          race: race.track,
          claimedFinish,
          verifiedFinish,
        });
      }
    }
  }

  validateRaceBandClaim({
    text,
    unsupported,
    driverId,
    alignedRaces,
    band: 'podium',
    manualRaceNotes,
    transcriptSummary,
  });
  validateRaceBandClaim({
    text,
    unsupported,
    driverId,
    alignedRaces,
    band: 'top5',
    manualRaceNotes,
    transcriptSummary,
  });
  validateRaceBandClaim({
    text,
    unsupported,
    driverId,
    alignedRaces,
    band: 'top10',
    manualRaceNotes,
    transcriptSummary,
  });

  for (const match of text.matchAll(/\b(win(?:ning)?|victory|checkered flag)\b[^.!?]{0,40}\b(at|in|from)\b[^.!?]+/gi)) {
    const snippet = match[0];
    if (claimSupportedInNotes(snippet, manualRaceNotes, transcriptSummary)) continue;
    const race = matchRaceByContext(snippet, alignedRaces);
    if (!race || !isVerifiedWinner(driverId, race, recentResults, driverLookup)) {
      pushUnsupported(unsupported, {
        type: 'win',
        message: 'Unsupported race win claim without verified winner data.',
        claim: snippet.trim(),
        race: race?.track || null,
      });
    }
  }

  for (const match of text.matchAll(/\b(\d+)\s+laps?\s+led\b/gi)) {
    const snippet = match[0];
    if (!claimSupportedInNotes(snippet, manualRaceNotes, transcriptSummary)) {
      pushUnsupported(unsupported, {
        type: 'laps-led',
        message: 'Unsupported laps led claim.',
        claim: snippet.trim(),
      });
    }
  }

  for (const match of text.matchAll(
    /\b(wreck|crashed|spun|spin|contact|incident|penalty|pitted|pit strategy|started\s+(?:\d+|P\d+)|playoff|cutline|cut line)\b[^.!?]*/gi
  )) {
    const snippet = match[0];
    if (!claimSupportedInNotes(snippet, manualRaceNotes, transcriptSummary)) {
      pushUnsupported(unsupported, {
        type: 'race-event',
        message: 'Unsupported race event or strategy claim.',
        claim: snippet.trim(),
      });
    }
  }

  if (seasonStats) {
    for (const match of text.matchAll(/\b(\d+(?:st|nd|rd|th)|#(\d+))\s+in\s+(?:the\s+)?points\b/gi)) {
      const snippet = match[0];
      const claimed = parseNumeric(match[1] || match[2]);
      if (!Number.isFinite(claimed)) continue;
      if (claimed !== Number(seasonStats.pointsPosition)) {
        pushUnsupported(unsupported, {
          type: 'points-position',
          message: `Claimed points position ${claimed}, but verified position is ${seasonStats.pointsPosition}.`,
          claim: snippet.trim(),
          verifiedValue: seasonStats.pointsPosition,
        });
      }
    }

    for (const match of text.matchAll(/\b(\d[\d,]*)\s+points\b/gi)) {
      const snippet = match[0];
      const claimed = parseNumeric(match[1]);
      if (!Number.isFinite(claimed)) continue;
      if (claimed !== Number(seasonStats.pointsTotal)) {
        pushUnsupported(unsupported, {
          type: 'points-total',
          message: `Claimed ${claimed} points, but verified total is ${seasonStats.pointsTotal}.`,
          claim: snippet.trim(),
          verifiedValue: seasonStats.pointsTotal,
        });
      }
    }

    for (const match of text.matchAll(/\b(\d+)\s+wins?\b/gi)) {
      const snippet = match[0];
      const claimed = parseNumeric(match[1]);
      if (!Number.isFinite(claimed)) continue;
      if (/\b(at|in|from)\b/i.test(snippet)) continue;
      if (claimed !== Number(seasonStats.winsTotal)) {
        pushUnsupported(unsupported, {
          type: 'wins-total',
          message: `Claimed ${claimed} wins, but verified season wins total is ${seasonStats.winsTotal}.`,
          claim: snippet.trim(),
          verifiedValue: seasonStats.winsTotal,
        });
      }
    }
  } else {
    for (const match of text.matchAll(/\b(\d+(?:st|nd|rd|th)|#(\d+))\s+in\s+(?:the\s+)?points\b|\b(\d[\d,]*)\s+points\b/gi)) {
      pushUnsupported(unsupported, {
        type: 'points-fact',
        message: 'Unsupported points fact without standings data.',
        claim: match[0].trim(),
      });
    }
  }

  return { unsupported };
}

function claimSupportedByAnyRankedDriver(item, context = {}) {
  const {
    rankedDriverIds = [],
    factualGrounding,
    alignedRaces = [],
    recentResults = [],
    driverLookup,
    manualRaceNotes = '',
    transcriptSummary = '',
  } = context;

  if (claimSupportedInNotes(item.claim || '', manualRaceNotes, transcriptSummary)) {
    return true;
  }

  const race =
    item.race
      ? alignedRaces.find((entry) => entry.track === item.race) ||
        alignedRaces.find((entry) => Number(entry.pointsRaceNumber) === Number(item.race))
      : matchRaceByContext(item.claim || '', alignedRaces);

  if (item.type === 'points-position') {
    const match = String(item.claim || item.message || '').match(
      /\b(\d+(?:st|nd|rd|th)|#(\d+))\s+in\s+(?:the\s+)?points\b/i
    );
    const claimed = parseNumeric(match?.[1] || match?.[2]);
    if (Number.isFinite(claimed)) {
      return rankedDriverIds.some((driverId) => {
        const grounding = factualGrounding?.drivers?.[String(driverId)];
        return grounding?.allowedSeasonStats?.pointsPosition === claimed;
      });
    }
  }

  if (item.type === 'points-total') {
    const match = String(item.claim || item.message || '').match(/\b(\d[\d,]*)\s+points\b/i);
    const claimed = parseNumeric(match?.[1]);
    if (Number.isFinite(claimed)) {
      return rankedDriverIds.some((driverId) => {
        const grounding = factualGrounding?.drivers?.[String(driverId)];
        return grounding?.allowedSeasonStats?.pointsTotal === claimed;
      });
    }
  }

  if (item.type === 'wins-total') {
    const match = String(item.claim || item.message || '').match(/\b(\d+)\s+wins?\b/i);
    const claimed = parseNumeric(match?.[1]);
    if (Number.isFinite(claimed)) {
      return rankedDriverIds.some((driverId) => {
        const grounding = factualGrounding?.drivers?.[String(driverId)];
        return grounding?.allowedSeasonStats?.winsTotal === claimed;
      });
    }
  }

  if (item.type === 'exact-finish' && race && Number.isFinite(item.claimedFinish)) {
    return rankedDriverIds.some((driverId) => {
      const finish = getVerifiedFinishForDriver(String(driverId), race);
      return finish === item.claimedFinish;
    });
  }

  if ((item.type === 'podium' || item.type === 'top5' || item.type === 'top10') && race) {
    const maxFinish = item.type === 'podium' ? 3 : item.type === 'top5' ? 5 : 10;
    return rankedDriverIds.some((driverId) => {
      const finish = getVerifiedFinishForDriver(String(driverId), race);
      return Number.isFinite(finish) && finish <= maxFinish;
    });
  }

  if (item.type === 'win' && race) {
    return rankedDriverIds.some((driverId) =>
      isVerifiedWinner(String(driverId), race, recentResults, driverLookup)
    );
  }

  return false;
}

export function validateProphetTakeFactualGrounding(text, context = {}) {
  const rankedDriverIds = (context.rankedDriverIds || []).map(String);
  const drivers = context.factualGrounding?.drivers || {};
  const merged = new Map();

  for (const driverId of rankedDriverIds) {
    const grounding = drivers[driverId];
    const { unsupported } = validateWriteupFactualGrounding(text, {
      ...context,
      driverId,
      driverGrounding: grounding,
      factualGrounding: grounding,
    });
    for (const item of unsupported) {
      const key = `${item.type}:${item.claim || item.message}:${item.race || ''}:${item.claimedFinish || ''}`;
      if (!merged.has(key)) merged.set(key, item);
    }
  }

  const final = [];
  for (const item of merged.values()) {
    if (!claimSupportedByAnyRankedDriver(item, { ...context, rankedDriverIds })) {
      final.push(item);
    }
  }

  return { unsupported: final };
}

const ORDINAL_BY_NUMBER = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
  6: 'sixth',
  7: 'seventh',
  8: 'eighth',
  9: 'ninth',
  10: 'tenth',
};

const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const GENERIC_EVIDENCE_PHRASES = [
  'building momentum',
  'showing momentum',
  'building confidence',
  'finding speed',
  'showing promise',
  'staying competitive',
  'looking for a breakthrough',
  'room to grow',
  'remains in contention',
  'shows promise',
  'one to watch',
  'could surprise people',
  'has potential',
  'continues to improve',
  'steady performer',
  'consistent contender',
];

function getOrdinalSuffix(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  const mod10 = number % 10;
  if (mod10 === 1) return `${number}st`;
  if (mod10 === 2) return `${number}nd`;
  if (mod10 === 3) return `${number}rd`;
  return `${number}th`;
}

function parseCountToken(token) {
  if (!token) return null;
  const numeric = parseNumeric(token);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS[String(token).toLowerCase()] ?? null;
}

function textIncludesTrack(text, track) {
  const lower = normalizeText(text);
  const trackNorm = normalizeText(track);
  if (!trackNorm) return false;
  if (lower.includes(trackNorm)) return true;
  const tokens = trackNorm.split(' ').filter((token) => token.length > 2);
  if (!tokens.length) return false;
  const hits = tokens.filter((token) => lower.includes(token));
  return hits.length >= Math.min(2, tokens.length);
}

function matchPointsPosition(text, position) {
  const pos = Number(position);
  if (!Number.isFinite(pos)) return false;

  const patterns = [
    new RegExp(`\\b${pos}(?:st|nd|rd|th)\\s+in\\s+(?:the\\s+)?(?:points|standings)\\b`, 'i'),
    new RegExp(`\\b#${pos}\\s+in\\s+(?:points|standings)\\b`, 'i'),
    new RegExp(`\\b(?:currently|sits|ranked|positioned)\\s+${getOrdinalSuffix(pos)}\\b`, 'i'),
  ];

  const ordinalWord = ORDINAL_BY_NUMBER[pos];
  if (ordinalWord) {
    patterns.push(
      new RegExp(`\\b${ordinalWord}\\s+in\\s+(?:the\\s+)?(?:points|standings)\\b`, 'i')
    );
  }

  return patterns.some((pattern) => pattern.test(text));
}

function matchPointsTotal(text, total) {
  const value = Number(total);
  if (!Number.isFinite(value)) return false;
  const commaFlexible = String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '[,]?');
  return new RegExp(`\\b${commaFlexible}\\s+points\\b`, 'i').test(text);
}

function matchSeasonCount(text, count, kind) {
  const value = Number(count);
  if (!Number.isFinite(value)) return false;

  const digitPattern =
    kind === 'wins'
      ? `\\b${value}\\s+wins?\\b`
      : kind === 'top5'
        ? `\\b${value}\\s+top\\s*-?\\s*fives?\\b|\\b${value}\\s+top-5s?\\b`
        : `\\b${value}\\s+top\\s*-?\\s*tens?\\b|\\b${value}\\s+top-10s?\\b`;

  if (new RegExp(digitPattern, 'i').test(text) && !/\b(at|in|from)\b/i.test(text)) {
    return true;
  }

  const word = Object.entries(NUMBER_WORDS).find(([, num]) => num === value)?.[0];
  if (!word) return false;

  const wordPattern =
    kind === 'wins'
      ? `\\b${word}\\s+wins?\\b`
      : kind === 'top5'
        ? `\\b${word}\\s+top\\s*-?\\s*fives?\\b`
        : `\\b${word}\\s+top\\s*-?\\s*tens?\\b`;

  return new RegExp(wordPattern, 'i').test(text);
}

function matchVerifiedRaceFinish(text, race) {
  const finish = Number(race.finishPosition);
  if (!Number.isFinite(finish) || !textIncludesTrack(text, race.track)) return null;

  const ordinalWord = ORDINAL_BY_NUMBER[finish];
  const finishTokens = [
    `P${finish}`,
    getOrdinalSuffix(finish),
    ordinalWord,
    `${finish}(?:st|nd|rd|th)`,
  ]
    .filter(Boolean)
    .join('|');

  const finishRegex = new RegExp(
    `\\b(?:finished|finish|a|his|her|their|with\\s+a)?\\s*(?:${finishTokens})\\b`,
    'i'
  );
  const barePositionRegex = new RegExp(`\\b(?:${finishTokens})\\b`, 'i');

  if (finishRegex.test(text) || barePositionRegex.test(text)) {
    return {
      type: 'verified-race-finish',
      label: `P${finish} at ${race.track} (Race ${race.pointsRaceNumber})`,
      raceNumber: race.pointsRaceNumber,
      track: race.track,
      finishPosition: finish,
    };
  }

  if (finish <= 3 && /\b(podium|top\s*-?\s*three|top\s*-?\s*3)\b/i.test(text)) {
    return {
      type: 'verified-race-finish',
      label: `Podium at ${race.track} (Race ${race.pointsRaceNumber}, verified P${finish})`,
      raceNumber: race.pointsRaceNumber,
      track: race.track,
      finishPosition: finish,
    };
  }

  if (finish <= 5 && /\btop\s*-?\s*(five|5)\b/i.test(text)) {
    return {
      type: 'verified-race-finish',
      label: `Top 5 at ${race.track} (Race ${race.pointsRaceNumber}, verified P${finish})`,
      raceNumber: race.pointsRaceNumber,
      track: race.track,
      finishPosition: finish,
    };
  }

  if (finish <= 10 && /\btop\s*-?\s*(ten|10)\b/i.test(text)) {
    return {
      type: 'verified-race-finish',
      label: `Top 10 at ${race.track} (Race ${race.pointsRaceNumber}, verified P${finish})`,
      raceNumber: race.pointsRaceNumber,
      track: race.track,
      finishPosition: finish,
    };
  }

  return null;
}

function matchVerifiedRaceWin(text, race) {
  if (!textIncludesTrack(text, race.track)) return null;
  if (!/\b(win(?:ning)?|victory|won|checkered flag)\b/i.test(text)) return null;

  return {
    type: 'verified-race-win',
    label: `Win at ${race.track} (Race ${race.pointsRaceNumber})`,
    raceNumber: race.pointsRaceNumber,
    track: race.track,
  };
}

function matchVerifiedMovement(text, context) {
  const previousRank = Number(context.previousRank);
  const currentRank = Number(context.rank ?? context.entry?.rank);
  if (!Number.isFinite(previousRank) || !Number.isFinite(currentRank)) return null;

  const movement = previousRank - currentRank;
  if (movement === 0) {
    if (
      /\b(unchanged|same\s+spot|no\s+change|holds?\s+(?:the\s+)?(?:no\.?\s*)?#?\d+|stays?\s+(?:at|in)\s+(?:the\s+)?(?:no\.?\s*)?#?\d+)\b/i.test(
        text
      )
    ) {
      return {
        type: 'movement',
        label: `Unchanged from previous power rank ${previousRank}`,
        previousRank,
        currentRank,
        movement: 0,
      };
    }
    return null;
  }

  const spots = Math.abs(movement);
  const directionPattern =
    movement > 0
      ? /\b(up|climbed|jumped|rose|moved\s+up|gained)\b/i
      : /\b(down|dropped|fell|slid|lost|moved\s+down)\b/i;

  if (
    directionPattern.test(text) &&
    (new RegExp(`\\b${spots}\\s+(spots?|positions?)\\b`, 'i').test(text) ||
      new RegExp(
        `\\bfrom\\s+#?${previousRank}\\s+to\\s+#?${currentRank}\\b`,
        'i'
      ).test(text))
  ) {
    return {
      type: 'movement',
      label:
        movement > 0
          ? `Up ${spots} from previous power rank ${previousRank}`
          : `Down ${spots} from previous power rank ${previousRank}`,
      previousRank,
      currentRank,
      movement,
    };
  }

  return null;
}

function matchPowerRankPosition(text, rank) {
  const currentRank = Number(rank ?? null);
  if (!Number.isFinite(currentRank)) return null;

  const patterns = [
    new RegExp(`\\b(?:rank|ranked|spot|position)\\s*#?${currentRank}\\b`, 'i'),
    new RegExp(`\\b(?:no\\.?\\s*)?${getOrdinalSuffix(currentRank)}\\s+spot\\b`, 'i'),
    new RegExp(`\\b#${currentRank}\\s+this\\s+week\\b`, 'i'),
  ];

  if (patterns.some((pattern) => pattern.test(text))) {
    return {
      type: 'power-rank',
      label: `Power rank ${currentRank}`,
      rank: currentRank,
    };
  }

  return null;
}

function matchRecentRaceFinishReference(text, race) {
  const finish = Number(race.finish);
  if (!Number.isFinite(finish)) return false;

  if (textIncludesTrack(text, race.track)) {
    const finishFact = matchVerifiedRaceFinish(text, {
      pointsRaceNumber: race.raceNumber,
      track: race.track,
      finishPosition: finish,
    });
    if (finishFact) return true;
  }

  const finishTokens = [
    `P${finish}`,
    getOrdinalSuffix(finish),
    ORDINAL_BY_NUMBER[finish],
    `${finish}(?:st|nd|rd|th)`,
  ]
    .filter(Boolean)
    .join('|');

  if (
    new RegExp(`\\b(?:${finishTokens})\\b`, 'i').test(text) &&
    /\b(last|recent|latest|past|three|3)\b/i.test(text)
  ) {
    return true;
  }

  if (new RegExp(`\\brace\\s*${race.raceNumber}\\b`, 'i').test(text)) {
    return new RegExp(`\\b(?:${finishTokens})\\b`, 'i').test(text);
  }

  return false;
}

function matchLast3AverageFinishReference(text, averageFinish, grounding = null) {
  const avg = Number(averageFinish);
  if (!Number.isFinite(avg)) return false;

  const starts =
    grounding?.last3RaceStarts ?? grounding?.recentRaceFinishes?.length ?? null;
  const window = grounding?.last3RaceWindowSize ?? 3;
  const partialWindow =
    Number.isFinite(starts) && starts > 0 && Number.isFinite(window) && starts < window;

  if (partialWindow) {
    return matchCorrectPartialLast3AverageWording(text, grounding);
  }

  const escaped = String(avg).replace('.', '\\.');
  const patterns = [
    new RegExp(`\\baverage finish of ${escaped}\\b`, 'i'),
    new RegExp(`\\b${escaped}\\s+average\\b`, 'i'),
    new RegExp(`\\bavg(?:erage)?\\.?\\s*(?:finish\\s*)?(?:of\\s*)?${escaped}\\b`, 'i'),
    /\baverage finish of [\d.]+\s+across the last three races\b/i,
    /\b[\d.]+\s+across the last three races\b/i,
  ];

  if (!patterns.some((pattern) => pattern.test(text))) return false;

  if (/\baverage finish of ([\d.]+)\s+across the last three races\b/i.test(text)) {
    const cited = Number(text.match(/\baverage finish of ([\d.]+)\s+across the last three races\b/i)?.[1]);
    return Number.isFinite(cited) && Math.abs(cited - avg) <= 0.15;
  }

  if (/\b[\d.]+\s+across the last three races\b/i.test(text)) {
    const cited = Number(text.match(/\b([\d.]+)\s+across the last three races\b/i)?.[1]);
    return Number.isFinite(cited) && Math.abs(cited - avg) <= 0.15;
  }

  return (
    new RegExp(`\\baverage finish of ${escaped}\\b`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\s+average\\b`, 'i').test(text) ||
    new RegExp(`\\bavg(?:erage)?\\.?\\s*(?:finish\\s*)?(?:of\\s*)?${escaped}\\b`, 'i').test(text)
  );
}

function matchCorrectPartialLast3AverageWording(text, grounding) {
  const avg = Number(grounding?.last3RaceAverageFinish);
  const starts = grounding?.last3RaceStarts ?? 0;
  const window = grounding?.last3RaceWindowSize ?? 3;
  if (!Number.isFinite(avg) || starts <= 0 || starts >= window) return false;

  const escaped = String(avg).replace('.', '\\.');
  const startPattern = starts === 1 ? '1\\s+start' : `${starts}\\s+starts?`;
  const windowPattern = window === 3 ? '3\\s+races|three\\s+races' : `${window}\\s+races`;

  const patterns = [
    new RegExp(
      `\\baverage finish of ${escaped}\\s+across ${startPattern}\\s+in the last (?:${windowPattern})\\b`,
      'i'
    ),
    new RegExp(`\\b${escaped}\\s+across ${startPattern}\\s+in the last (?:${windowPattern})\\b`, 'i'),
    new RegExp(
      `\\baverage finish of ${escaped}\\b[\\s\\S]{0,80}\\b${startPattern}\\s+in the last (?:${windowPattern})\\b`,
      'i'
    ),
  ];

  return patterns.some((pattern) => pattern.test(text));
}

function writeupReferencesLast3Average(text, averageFinish) {
  const avg = Number(averageFinish);
  if (!Number.isFinite(avg)) return false;
  const escaped = String(avg).replace('.', '\\.');
  return (
    new RegExp(`\\baverage finish of ${escaped}\\b`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\s+average\\b`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\s+across\\b`, 'i').test(text) ||
    new RegExp(`\\b${escaped}\\s+over\\b`, 'i').test(text)
  );
}

export function formatLast3AverageFinishGuidance(grounding) {
  if (grounding?.last3RaceAverageFinish == null) return null;

  const starts = grounding.last3RaceStarts ?? grounding.recentRaceFinishes?.length ?? 0;
  const window = grounding.last3RaceWindowSize ?? 3;
  const avg = grounding.last3RaceAverageFinish;
  const missed = grounding.missedRecentRaceNames || [];

  if (starts > 0 && starts < window) {
    const missedNote = missed.length ? ` Missed: ${missed.join(', ')}.` : '';
    return `Use wording like "average finish of ${avg} across ${starts} start${starts === 1 ? '' : 's'} in the last ${window} races" — not "over the last three races".${missedNote}`;
  }

  return `Average finish of ${avg} across ${window} verified starts in the last ${window} races.`;
}

export function validateLast3AverageFinishWording(writeup, context = {}) {
  const grounding = context.driverGrounding || context.factualGrounding || null;
  if (grounding?.last3RaceAverageFinish == null) {
    return { error: null, errorType: null };
  }

  const text = String(writeup || '');
  const starts = grounding.last3RaceStarts ?? grounding.recentRaceFinishes?.length ?? 0;
  const window = grounding.last3RaceWindowSize ?? 3;
  const avg = grounding.last3RaceAverageFinish;

  if (starts >= window || !writeupReferencesLast3Average(text, avg)) {
    return { error: null, errorType: null };
  }

  if (matchCorrectPartialLast3AverageWording(text, grounding)) {
    return { error: null, errorType: null };
  }

  const misleadingPatterns = [
    /\baverage finish of [\d.]+\s+over the last three races\b/i,
    /\baverage finish of [\d.]+\s+over the last 3 races\b/i,
    /\baverage finish of [\d.]+\s+across the last three races\b/i,
    /\baverage finish of [\d.]+\s+across the last 3 races\b/i,
    /\b[\d.]+\s+over the last three races\b/i,
    /\b[\d.]+\s+over the last 3 races\b/i,
    /\b[\d.]+\s+across the last three races\b/i,
    /\b[\d.]+\s+across the last 3 races\b/i,
  ];

  if (misleadingPatterns.some((pattern) => pattern.test(text))) {
    return {
      error: `Writeup implies a full last-${window} average, but this driver has only ${starts} verified start${starts === 1 ? '' : 's'} in that window. Use "average finish of ${avg} across ${starts} starts in the last ${window} races".`,
      errorType: 'misleading-last3-average-wording',
    };
  }

  if (/\b(?:over|across)\s+the last three races\b/i.test(text)) {
    return {
      error: `Writeup references the last three races without noting only ${starts} verified start${starts === 1 ? '' : 's'}. Use "average finish of ${avg} across ${starts} starts in the last ${window} races".`,
      errorType: 'misleading-last3-average-wording',
    };
  }

  return { error: null, errorType: null };
}

function extractMissedTrackClaim(rawClaim) {
  let claim = String(rawClaim || '').trim();
  const stopMatch = claim.match(
    /\s+(?:produced|still|keeps|an average|the driver|this week|enough to|has|have|was|were|is|are)\b/i
  );
  if (stopMatch?.index > 0) {
    claim = claim.slice(0, stopMatch.index).trim();
  }
  return claim.replace(/[,.]$/, '').trim();
}

function trackMentionSupported(claimText, missedTrackNames = []) {
  const claim = normalizeText(extractMissedTrackClaim(claimText));
  if (!claim) return false;

  return missedTrackNames.some((trackName) => {
    const track = normalizeText(trackName);
    if (!track) return false;
    if (claim.includes(track) || track.includes(claim)) return true;

    const claimTokens = claim.split(' ').filter((token) => token.length > 2);
    const trackTokens = track.split(' ').filter((token) => token.length > 2);
    if (claimTokens.some((token) => trackTokens.includes(token))) return true;

    return trackTokens.length > 0 && trackTokens.every((token) => claim.includes(token));
  });
}

export function validateMissedRaceMentions(writeup, context = {}) {
  const grounding = context.driverGrounding || context.factualGrounding || null;
  const missed = grounding?.missedRecentRaceNames || [];
  const text = String(writeup || '');

  for (const match of text.matchAll(
    /\b(?:despite|after|even with|with)?\s*(?:missing|missed|skipping|skipped|sat out|did not race|dnp(?:'d)?(?: at)?)\s+([^.!?]+)/gi
  )) {
    const claim = extractMissedTrackClaim(match[1]);
    if (!claim) continue;
    if (!trackMentionSupported(claim, missed)) {
      if (
        missed.length === 0 ||
        !/\b(speedway|motor|raceway|mile|oval|superspeedway|international|bristol|rockingham|charlotte|iowa|daytona|atlanta|darlington|dover|kentucky|michigan|phoenix|talladega|indianapolis)\b/i.test(
          claim
        )
      ) {
        continue;
      }
      return {
        error: `Unsupported missed-race mention "${claim}". Verified missed races in the last-${grounding?.last3RaceWindowSize ?? 3} window: ${missed.length ? missed.join(', ') : 'none'}.`,
        errorType: 'unsupported-missed-race-mention',
      };
    }
  }

  return { error: null, errorType: null };
}

function matchExtremeLast3FinishReference(text, finish, kind) {
  const value = Number(finish);
  if (!Number.isFinite(value)) return false;

  const finishTokens = [`P${value}`, getOrdinalSuffix(value), ORDINAL_BY_NUMBER[value]]
    .filter(Boolean)
    .join('|');
  const scopePattern =
    kind === 'best'
      ? /\b(best|strongest|top|lowest)\b/i
      : /\b(worst|weakest|highest|rough|toughest)\b/i;

  return (
    scopePattern.test(text) &&
    new RegExp(`\\b(?:${finishTokens})\\b`, 'i').test(text) &&
    /\b(last|recent|three|3)\b/i.test(text)
  );
}

export function analyzeRecentFormReferences(writeup, context = {}) {
  const text = String(writeup || '');
  const grounding = context.driverGrounding || context.factualGrounding || null;
  const recentRaceFinishes = grounding?.recentRaceFinishes || [];

  let recentFinishReferenced = false;
  let averageFinishReferenced = false;
  let recentFormReferenced = false;

  for (const race of recentRaceFinishes) {
    if (matchRecentRaceFinishReference(text, race)) {
      recentFinishReferenced = true;
      recentFormReferenced = true;
    }
  }

  if (matchLast3AverageFinishReference(text, grounding?.last3RaceAverageFinish, grounding)) {
    averageFinishReferenced = true;
    recentFormReferenced = true;
  }

  if (matchExtremeLast3FinishReference(text, grounding?.bestFinishLast3, 'best')) {
    recentFormReferenced = true;
  }

  if (matchExtremeLast3FinishReference(text, grounding?.worstFinishLast3, 'worst')) {
    recentFormReferenced = true;
  }

  const winsInLast3 = recentRaceFinishes.filter((race) => Number(race.finish) === 1).length;
  const podiumsInLast3 = recentRaceFinishes.filter((race) => Number(race.finish) <= 3).length;

  if (winsInLast3 >= 2 && /\bback-to-back wins?\b/i.test(text)) {
    recentFormReferenced = true;
  }

  if (podiumsInLast3 >= 2 && /\bback-to-back (?:podium|top\s*-?\s*three|top\s*-?\s*3)\b/i.test(text)) {
    recentFormReferenced = true;
  }

  if (
    recentFinishReferenced &&
    /\b(three-race|3-race)\s+stretch\b|\blast three races\b|\bpast three races\b/i.test(text)
  ) {
    recentFormReferenced = true;
  }

  return {
    recentFinishReferenced,
    averageFinishReferenced,
    recentFormReferenced,
  };
}

export function validateWriteupRecentFormPreference(writeup, context = {}) {
  const rank = Number(context.rank ?? context.entry?.rank);
  const grounding = context.driverGrounding || context.factualGrounding || null;
  const refs = analyzeRecentFormReferences(writeup, context);

  if (!Number.isFinite(rank) || rank < 1 || rank > 5) {
    return { error: null, errorType: null, ...refs };
  }

  if (!(grounding?.recentRaceFinishes?.length > 0)) {
    return { error: null, errorType: null, ...refs };
  }

  if (!refs.recentFinishReferenced && !refs.averageFinishReferenced) {
    return {
      error: `Rank ${rank} writeup should cite at least one recent-race finish or last-3 average finish when recentRaceFinishes are available.`,
      errorType: 'missing-recent-finish-evidence',
      ...refs,
    };
  }

  return { error: null, errorType: null, ...refs };
}

export function getVerifiedFactsLimits(rank) {
  if (rank === 'HM') return { min: 1, max: 2 };
  const numericRank = Number(rank);
  if (numericRank >= 1 && numericRank <= 3) return { min: 2, max: 3 };
  if (numericRank >= 4 && numericRank <= 7) return { min: 1, max: 3 };
  if (numericRank >= 8 && numericRank <= 10) return { min: 1, max: 2 };
  return { min: 1, max: 3 };
}

export function analyzeVerifiedFactsUsed(writeup, context = {}) {
  const text = String(writeup || '');
  const grounding = context.driverGrounding || context.factualGrounding || null;
  const stats = grounding?.allowedSeasonStats || null;
  const used = [];
  const seen = new Set();

  const pushFact = (fact) => {
    const key = `${fact.type}:${fact.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    used.push(fact);
  };

  if (stats) {
    if (matchPointsPosition(text, stats.pointsPosition)) {
      pushFact({
        type: 'points-position',
        label: `P${stats.pointsPosition} in points`,
        value: stats.pointsPosition,
      });
    }
    if (matchPointsTotal(text, stats.pointsTotal)) {
      pushFact({
        type: 'points-total',
        label: `${stats.pointsTotal} points`,
        value: stats.pointsTotal,
      });
    }
    if (matchSeasonCount(text, stats.winsTotal, 'wins')) {
      pushFact({
        type: 'wins-total',
        label: `${stats.winsTotal} season wins`,
        value: stats.winsTotal,
      });
    }
    if (matchSeasonCount(text, stats.top5Total, 'top5')) {
      pushFact({
        type: 'top5-total',
        label: `${stats.top5Total} top 5s`,
        value: stats.top5Total,
      });
    }
    if (matchSeasonCount(text, stats.top10Total, 'top10')) {
      pushFact({
        type: 'top10-total',
        label: `${stats.top10Total} top 10s`,
        value: stats.top10Total,
      });
    }
  }

  for (const race of grounding?.verifiedRaceFinishes || []) {
    const finishFact = matchVerifiedRaceFinish(text, race);
    if (finishFact) pushFact(finishFact);
  }

  for (const race of grounding?.verifiedRaceWins || []) {
    const winFact = matchVerifiedRaceWin(text, race);
    if (winFact) pushFact(winFact);
  }

  const movementFact = matchVerifiedMovement(text, context);
  if (movementFact) pushFact(movementFact);

  const powerRankFact = matchPowerRankPosition(text, context.rank ?? context.entry?.rank);
  if (powerRankFact) pushFact(powerRankFact);

  for (const race of grounding?.recentRaceFinishes || []) {
    if (matchRecentRaceFinishReference(text, race)) {
      pushFact({
        type: 'recent-race-finish',
        label: `Race ${race.raceNumber} P${race.finish}`,
        raceNumber: race.raceNumber,
        finish: race.finish,
      });
    }
  }

  if (matchLast3AverageFinishReference(text, grounding?.last3RaceAverageFinish, grounding)) {
    pushFact({
      type: 'last3-average-finish',
      label:
        grounding.last3RaceStarts != null &&
        grounding.last3RaceWindowSize != null &&
        grounding.last3RaceStarts < grounding.last3RaceWindowSize
          ? `Last 3 average finish ${grounding.last3RaceAverageFinish} (${grounding.last3RaceStarts}/${grounding.last3RaceWindowSize} starts)`
          : `Last 3 average finish ${grounding.last3RaceAverageFinish}`,
      value: grounding.last3RaceAverageFinish,
    });
  }

  const rankingSupportTypes = new Set([
    'points-position',
    'movement',
    'verified-race-finish',
    'verified-race-win',
    'recent-race-finish',
    'last3-average-finish',
    'power-rank',
    'top5-total',
    'top10-total',
    'wins-total',
  ]);

  const hasRankingSupport = used.some((fact) => rankingSupportTypes.has(fact.type));
  const hasJustificationLanguage =
    /\b(justify|justifies|justifying|earned|deserves|keeps|holds|supports|warrant|warrants|reason|ranked|ranking|moved|climbed|dropped|fell|because|after|through|with|despite|enough to|solidifies|cements|stays|remains at|inside the top|outside the top|this week)\b/i.test(
      text
    );

  const genericPhraseHits = GENERIC_EVIDENCE_PHRASES.filter((phrase) =>
    text.toLowerCase().includes(phrase)
  );

  const distinctiveFactCount = used.filter((fact) =>
    [
      'verified-race-finish',
      'verified-race-win',
      'recent-race-finish',
      'last3-average-finish',
      'movement',
      'points-position',
    ].includes(fact.type)
  ).length;

  const recentFormRefs = analyzeRecentFormReferences(writeup, context);

  return {
    verifiedFactsUsed: used,
    verifiedFactsUsedCount: used.length,
    hasRankingSupport,
    hasJustificationLanguage,
    genericPhraseHits,
    distinctiveFactCount,
    ...recentFormRefs,
  };
}

export function validateWriteupVerifiedEvidence(writeup, context = {}) {
  const rank = context.rank ?? context.entry?.rank ?? null;
  const limits = getVerifiedFactsLimits(rank);
  const analysis = analyzeVerifiedFactsUsed(writeup, context);
  const count = analysis.verifiedFactsUsedCount;

  if (count === 0) {
    return {
      error: 'Writeup uses no verified facts from factualGrounding.',
      errorType: 'insufficient-verified-facts',
      ...analysis,
    };
  }

  if (count > 3) {
    return {
      error: `Writeup cites too many verified facts (${count}; maximum 3).`,
      errorType: 'too-many-verified-facts',
      ...analysis,
    };
  }

  if (count < limits.min) {
    return {
      error: `Writeup needs ${limits.min}-${limits.max} verified facts for rank ${rank} (found ${count}).`,
      errorType: 'insufficient-verified-facts',
      ...analysis,
    };
  }

  if (count > limits.max) {
    return {
      error: `Writeup cites too many verified facts for rank ${rank} (${count}; maximum ${limits.max}).`,
      errorType: 'too-many-verified-facts',
      ...analysis,
    };
  }

  if (!analysis.hasRankingSupport || !analysis.hasJustificationLanguage) {
    return {
      error:
        'Writeup lists verified facts but does not use them to explain why this driver is ranked here this week.',
      errorType: 'weak-ranking-explanation',
      ...analysis,
    };
  }

  if (
    analysis.genericPhraseHits.length > 0 &&
    analysis.distinctiveFactCount === 0 &&
    count <= 1
  ) {
    return {
      error: `Writeup relies on generic language (${analysis.genericPhraseHits[0]}) without enough verified evidence.`,
      errorType: 'generic-language',
      ...analysis,
    };
  }

  if (analysis.distinctiveFactCount === 0 && count <= 1 && analysis.genericPhraseHits.length === 0) {
    const lower = normalizeText(writeup);
    if (
      /\b(competitive|improving|potential|promising|contender|consistent|dangerous|threat|talented|momentum|speed|confidence)\b/.test(
        lower
      )
    ) {
      return {
        error: 'Writeup is too generic and could apply to multiple drivers.',
        errorType: 'too-generic',
        ...analysis,
      };
    }
  }

  const recentFormValidation = validateWriteupRecentFormPreference(writeup, context);
  if (recentFormValidation.error) {
    return {
      error: recentFormValidation.error,
      errorType: recentFormValidation.errorType,
      ...analysis,
      recentFinishReferenced: recentFormValidation.recentFinishReferenced,
      averageFinishReferenced: recentFormValidation.averageFinishReferenced,
      recentFormReferenced: recentFormValidation.recentFormReferenced,
    };
  }

  const last3WordingValidation = validateLast3AverageFinishWording(writeup, context);
  if (last3WordingValidation.error) {
    return {
      error: last3WordingValidation.error,
      errorType: last3WordingValidation.errorType,
      ...analysis,
    };
  }

  const missedRaceValidation = validateMissedRaceMentions(writeup, context);
  if (missedRaceValidation.error) {
    return {
      error: missedRaceValidation.error,
      errorType: missedRaceValidation.errorType,
      ...analysis,
    };
  }

  return {
    error: null,
    errorType: null,
    ...analysis,
  };
}

export function formatVerifiedFactsForRepair(grounding, rank) {
  if (!grounding) return 'No verified facts available.';
  const limits = getVerifiedFactsLimits(rank);
  const lines = [
    `Use ${limits.min}-${limits.max} verified facts below to explain WHY this driver is ranked here this week.`,
    'Do not simply list statistics — connect facts to the ranking decision.',
  ];
  if (grounding.allowedSeasonStats) {
    const stats = grounding.allowedSeasonStats;
    lines.push(
      `Verified season stats: P${stats.pointsPosition}, ${stats.pointsTotal} points, ${stats.winsTotal} wins, ${stats.top5Total} top 5s, ${stats.top10Total} top 10s.`
    );
  }
  for (const race of grounding.verifiedRaceFinishes || []) {
    lines.push(
      `Verified Race ${race.pointsRaceNumber} (${race.track}): P${race.finishPosition}.`
    );
  }
  for (const race of grounding.verifiedRaceWins || []) {
    lines.push(`Verified win: Race ${race.pointsRaceNumber} (${race.track}).`);
  }
  if (grounding.recentRaceFinishes?.length) {
    lines.push(
      `Recent race finishes: ${grounding.recentRaceFinishes
        .map((race) => `Race ${race.raceNumber} P${race.finish}`)
        .join(', ')}.`
    );
  }
  if (grounding.last3RaceAverageFinish != null) {
    const guidance = formatLast3AverageFinishGuidance(grounding);
    lines.push(guidance || `Last 3 average finish: ${grounding.last3RaceAverageFinish}.`);
    if (grounding.last3RaceStarts != null && grounding.last3RaceWindowSize != null) {
      lines.push(
        `Last 3 window: ${grounding.last3RaceStarts} verified starts in ${grounding.last3RaceWindowSize} races${grounding.missedRecentRaceNames?.length ? `; missed ${grounding.missedRecentRaceNames.join(', ')}` : ''}.`
      );
    }
  }
  if (Number(rank) >= 1 && Number(rank) <= 5 && grounding.recentRaceFinishes?.length) {
    lines.push(
      'Prefer citing at least one recent-race finish or the last-3 average finish — not generic momentum language.'
    );
  }
  if (lines.length <= 2) {
    lines.push('No verified race finishes available — use season stats only and avoid exact race-result claims.');
  }
  return lines.join('\n');
}
