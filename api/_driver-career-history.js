import { fetchHtml } from './_lib.js';
import { resolveSeasonScheduleProgress } from './_schedule-points-races.js';

export const CAREER_TENURE_FORBIDDEN_WITHOUT_VERIFICATION = [
  'new to the league',
  'rookie',
  'first season',
  'newcomer',
  'veteran',
  'longtime driver',
  'returning driver',
];

export const LEAGUE_SERIES_CATEGORIES = {
  BP_TRUCK: 'bp-truck-series',
  BP_KN: 'bp-kn-series',
  WINTER: 'winter-series',
  OTHER: 'other',
};

const ROOKIE_TENURE_PATTERN =
  /\b(new to the league|league debut|debut season|first season|first year with|first year in|inaugural season|newcomer|rookie)\b/gi;

const VETERAN_TENURE_PATTERN =
  /\b(veteran|longtime driver|long-time driver|long time driver|seasoned veteran|multi-year driver|multi year driver)\b/gi;

const RETURNING_TENURE_PATTERN = /\b(returning driver|returning to the series|back in the truck series)\b/gi;

const CAREER_TENURE_VALIDATION_RULES = [
  {
    type: 'unsupported-career-tenure',
    pattern: ROOKIE_TENURE_PATTERN,
    scope: 'rookie',
    message:
      'Career tenure claim (rookie/newcomer/first season) requires verified truckSeriesCareerHistory or manual notes.',
  },
  {
    type: 'unsupported-career-tenure',
    pattern: VETERAN_TENURE_PATTERN,
    scope: 'veteran',
    message:
      'Career tenure claim (veteran/longtime driver) requires verified truckSeriesCareerHistory or manual notes.',
  },
  {
    type: 'unsupported-career-tenure',
    pattern: RETURNING_TENURE_PATTERN,
    scope: 'returning',
    message:
      'Career tenure claim (returning driver) requires verified truckSeriesCareerHistory or manual notes.',
  },
];

const DEFAULT_LEAGUE_ID = '1783';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9\s&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function claimSupportedInNotes(claimText, manualRaceNotes, transcriptSummary) {
  const claim = normalizeText(claimText);
  if (!claim) return false;
  const sources = [manualRaceNotes, transcriptSummary].filter(Boolean).map(normalizeText);
  return sources.some(
    (source) =>
      source.includes(claim) ||
      claim.split(' ').filter((word) => word.length > 3 && source.includes(word)).length >= 2
  );
}

function textMatchesPattern(text, pattern) {
  const flags = pattern.flags.replace('g', '');
  return new RegExp(pattern.source, flags).test(String(text || ''));
}

function parseTenureClaimsFromNotes(manualRaceNotes = '', transcriptSummary = '') {
  const source = `${manualRaceNotes}\n${transcriptSummary}`;
  const claims = [];

  if (textMatchesPattern(source, ROOKIE_TENURE_PATTERN)) claims.push('rookie-or-first-season');
  if (textMatchesPattern(source, VETERAN_TENURE_PATTERN)) claims.push('veteran-or-longtime');
  if (textMatchesPattern(source, RETURNING_TENURE_PATTERN)) claims.push('returning-driver');

  return {
    verified: claims.length > 0,
    tenureClaimsAllowed: claims.length > 0,
    claims,
  };
}

function parseLeagueSeriesFromPage(html) {
  const series = [];
  for (const match of String(html || '').matchAll(/series\.push\(\{([^}]+)\}\)/g)) {
    const block = match[1];
    const seriesId = block.match(/sid:(\d+)/)?.[1];
    const seriesName = decodeHtml(block.match(/sname:"([^"]+)"/)?.[1] || '');
    const active = block.match(/act:(true|false)/)?.[1] === 'true';
    if (seriesId && seriesName) {
      series.push({ seriesId: String(seriesId), seriesName, active });
    }
  }
  return series;
}

function parsePublicSeasonsFromSeriesPage(html) {
  const seasons = [];
  const blockMatch = String(html || '').match(/seasons=\[(.*?)\];/s);
  if (!blockMatch) return seasons;

  for (const match of blockMatch[1].matchAll(/id:(\d+),sname:"([^"]+)"/g)) {
    seasons.push({
      seasonId: String(match[1]),
      seasonName: decodeHtml(match[2]),
    });
  }

  return seasons;
}

function extractSeasonNumber(text) {
  const match = String(text || '').match(/season\s*#?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function classifyLeagueSeasonEntry({ seriesName = '', seasonName = '' }) {
  const series = normalizeText(seriesName);
  const season = normalizeText(seasonName);
  const combined = `${series} ${season}`.trim();

  if (!combined) {
    return {
      category: LEAGUE_SERIES_CATEGORIES.OTHER,
      bpSeasonNumber: null,
      confidence: 'low',
      excludeFromCareer: true,
      reason: 'Missing series/season name.',
    };
  }

  if (/^test$/.test(season) || /\btest season\b/.test(combined)) {
    return {
      category: LEAGUE_SERIES_CATEGORIES.OTHER,
      bpSeasonNumber: null,
      confidence: 'high',
      excludeFromCareer: true,
      reason: 'Test season excluded from career history.',
    };
  }

  if (/winter/.test(combined)) {
    return {
      category: LEAGUE_SERIES_CATEGORIES.WINTER,
      bpSeasonNumber: extractSeasonNumber(combined),
      confidence: 'high',
      excludeFromCareer: false,
      reason: 'Winter Series season.',
    };
  }

  if (/ethanstrong|special event/.test(combined)) {
    return {
      category: LEAGUE_SERIES_CATEGORIES.OTHER,
      bpSeasonNumber: null,
      confidence: 'high',
      excludeFromCareer: true,
      reason: 'Special event excluded from career history.',
    };
  }

  const blazingMatch = combined.match(/blazing pedals season\s*#?\s*(\d+)/);
  if (blazingMatch) {
    const bpSeasonNumber = Number(blazingMatch[1]);
    return {
      category: LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
      bpSeasonNumber,
      confidence: bpSeasonNumber >= 6 ? 'high' : 'medium',
      excludeFromCareer: false,
      reason: 'Explicit Blazing Pedals truck season.',
    };
  }

  if (/^season\s*(\d+)$/.test(season) && /season\s*(10|11)/.test(season)) {
    const bpSeasonNumber = Number(season.match(/(\d+)/)?.[1]);
    return {
      category: LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
      bpSeasonNumber,
      confidence: 'high',
      excludeFromCareer: false,
      reason: 'Named truck season on dedicated series page.',
    };
  }

  if (/xfinity season\s*(\d+)/.test(combined)) {
    const bpSeasonNumber = Number(combined.match(/xfinity season\s*(\d+)/)?.[1]);
    if (bpSeasonNumber >= 6 && bpSeasonNumber <= 8) {
      return {
        category: LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
        bpSeasonNumber,
        confidence: 'high',
        excludeFromCareer: false,
        reason: 'Mapped BP truck season from Xfinity-era naming.',
      };
    }
  }

  if (/arca season\s*(\d+)/.test(combined)) {
    const bpSeasonNumber = Number(combined.match(/arca season\s*(\d+)/)?.[1]);
    if (bpSeasonNumber === 7) {
      return {
        category: LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
        bpSeasonNumber,
        confidence: 'high',
        excludeFromCareer: false,
        reason: 'Mapped BP truck season from ARCA-era naming.',
      };
    }
  }

  if (/truck series season\s*(\d+)/.test(combined)) {
    const bpSeasonNumber = Number(combined.match(/truck series season\s*(\d+)/)?.[1]);
    if (bpSeasonNumber >= 1 && bpSeasonNumber <= 5) {
      return {
        category: LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
        bpSeasonNumber,
        confidence: 'high',
        excludeFromCareer: false,
        reason: 'Early BP truck season from Truck Series bucket.',
      };
    }
  }

  if (/friday truck series/.test(combined)) {
    return {
      category: LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
      bpSeasonNumber: 1,
      confidence: 'medium',
      excludeFromCareer: false,
      reason: 'Early BP truck season mapped from Friday Truck Series.',
    };
  }

  if (/k\s*&\s*n/.test(combined)) {
    const bpSeasonNumber = extractSeasonNumber(combined);
    return {
      category: LEAGUE_SERIES_CATEGORIES.BP_KN,
      bpSeasonNumber,
      confidence: bpSeasonNumber ? 'high' : 'medium',
      excludeFromCareer: false,
      reason: 'BP K&N series season.',
    };
  }

  if (/^season\s*1$/.test(season) && series === 'k&n') {
    return {
      category: LEAGUE_SERIES_CATEGORIES.BP_KN,
      bpSeasonNumber: 1,
      confidence: 'high',
      excludeFromCareer: false,
      reason: 'BP K&N season 1.',
    };
  }

  return {
    category: LEAGUE_SERIES_CATEGORIES.OTHER,
    bpSeasonNumber: extractSeasonNumber(combined),
    confidence: 'low',
    excludeFromCareer: false,
    reason: 'Could not reliably classify this league season.',
  };
}

async function fetchSeasonStandingsSnapshot(seasonId) {
  const response = await fetch(
    `https://www.simracerhub.com/scoring/get_standings.php?season_id=${seasonId}`,
    { headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' } }
  );

  if (!response.ok) {
    throw new Error(`Standings fetch failed for season ${seasonId} (${response.status})`);
  }

  const data = await response.json();
  const rows = Object.values(data.rps || {}).map((row) => ({
    driverId: String(row.drid),
    starts: Number(row.counted || row.starts || 0),
    wins: Number(row.wins || 0),
    top5s: Number(row.t5 || 0),
    top10s: Number(row.t10 || 0),
    position: Number(row.pos2 || 0) || null,
    points: Number(row.tpts || 0),
  }));

  return {
    seasonId: String(seasonId),
    seasonName: data.lss?.season_name || null,
    rows,
    byDriverId: Object.fromEntries(rows.map((row) => [row.driverId, row])),
  };
}

function sortSeasonEntries(entries = []) {
  return [...entries].sort((a, b) => {
    const aNum = Number.isFinite(a.bpSeasonNumber) ? a.bpSeasonNumber : Number.MAX_SAFE_INTEGER;
    const bNum = Number.isFinite(b.bpSeasonNumber) ? b.bpSeasonNumber : Number.MAX_SAFE_INTEGER;
    if (aNum !== bNum) return aNum - bNum;
    return Number(a.seasonId) - Number(b.seasonId);
  });
}

function pickFirstSeasonEntry(entries = []) {
  const sorted = sortSeasonEntries(entries);
  return sorted[0] || null;
}

function evaluateClassificationReliability(seasons = []) {
  const issues = [];
  const considered = seasons.filter((season) => !season.excludeFromCareer);

  for (const season of considered) {
    if (season.confidence === 'low') {
      issues.push(`Low-confidence classification for season ${season.seasonId} (${season.seasonName}).`);
    }
  }

  const truckSeasonNumbers = considered
    .filter((season) => season.category === LEAGUE_SERIES_CATEGORIES.BP_TRUCK)
    .map((season) => season.bpSeasonNumber)
    .filter((value) => Number.isFinite(value));

  const truckDuplicates = truckSeasonNumbers.filter(
    (value, index) => truckSeasonNumbers.indexOf(value) !== index
  );
  if (truckDuplicates.length) {
    issues.push(`Duplicate BP truck season numbers detected: ${[...new Set(truckDuplicates)].join(', ')}.`);
  }

  const expectedTruckSeasons = [6, 7, 8, 9, 10, 11];
  for (const expected of expectedTruckSeasons) {
    if (!truckSeasonNumbers.includes(expected)) {
      issues.push(`Missing mapped BP truck season ${expected} in public league catalog.`);
    }
  }

  return {
    classificationReliable: issues.length === 0,
    classificationIssues: issues,
  };
}

function formatSeasonLabel(season) {
  if (Number.isFinite(season.bpSeasonNumber)) {
    return `Season ${season.bpSeasonNumber}`;
  }
  return season.seasonName || `Season ${season.seasonId}`;
}

function resolveCurrentBpSeasonNumber(seasonCatalog = null) {
  const currentSeasonId = seasonCatalog?.currentSeasonId;
  if (currentSeasonId && seasonCatalog?.seasons) {
    const season = seasonCatalog.seasons.find(
      (entry) => String(entry.seasonId) === String(currentSeasonId)
    );
    if (Number.isFinite(season?.bpSeasonNumber)) return season.bpSeasonNumber;
  }
  const match = String(seasonCatalog?.currentSeasonName || '').match(/season\s*#?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function resolveSeasonStateForEntry(season, { currentSeasonId, currentSeasonComplete, currentBpNumber }) {
  if (currentSeasonId && String(season.seasonId) === String(currentSeasonId)) {
    return currentSeasonComplete ? 'completed' : 'current';
  }
  if (
    Number.isFinite(season.bpSeasonNumber) &&
    Number.isFinite(currentBpNumber) &&
    season.bpSeasonNumber > currentBpNumber
  ) {
    return 'future';
  }
  return 'completed';
}

function pickBestChampionshipPosition(appearances = []) {
  return appearances.reduce(
    (best, season) => (!best || season.position < best.position ? season : best),
    null
  );
}

export function buildChampionshipSeasonWordingGuide({
  currentSeasonInProgress,
  currentSeasonComplete,
  currentSeasonStanding,
  bestCompletedSeason,
  bestOverallSeason,
  remainingPointsRaces,
  currentSeasonPointsPosition,
  priorChampionships,
}) {
  const currentPos =
    currentSeasonStanding?.position ??
    (Number.isFinite(currentSeasonPointsPosition) ? currentSeasonPointsPosition : null);
  const bestCompletedPos = bestCompletedSeason?.position ?? null;
  const isLeader = currentPos === 1;
  const beatsCompletedBest =
    currentSeasonInProgress &&
    (bestCompletedPos == null || (Number.isFinite(currentPos) && currentPos < bestCompletedPos));
  const tiesCompletedBest =
    currentSeasonInProgress &&
    bestCompletedPos != null &&
    Number.isFinite(currentPos) &&
    currentPos === bestCompletedPos;
  const canStillBeatCompletedBest =
    currentSeasonInProgress &&
    bestCompletedPos != null &&
    Number.isFinite(currentPos) &&
    currentPos > bestCompletedPos;

  const suggestedPhrasing = [];
  if (currentSeasonInProgress) {
    if (isLeader && (beatsCompletedBest || tiesCompletedBest || priorChampionships > 0)) {
      suggestedPhrasing.push(
        "He's having the best championship campaign of his career and currently leads the standings."
      );
    } else if (beatsCompletedBest) {
      suggestedPhrasing.push(
        "He's currently enjoying the best season of his career.",
        'This is shaping up to be the strongest season of his Blazing Pedals career.',
        "He's currently running a career-best season."
      );
      if (Number.isFinite(remainingPointsRaces) && remainingPointsRaces > 0 && remainingPointsRaces <= 4) {
        suggestedPhrasing.push(
          'With only a handful of races remaining, he is on track to achieve his highest championship finish.'
        );
      } else {
        suggestedPhrasing.push(
          'He is on pace for the best championship finish of his career.',
          'The current campaign represents the strongest championship run of his career to date.'
        );
      }
    } else if (tiesCompletedBest) {
      suggestedPhrasing.push("He's matching the best championship run of his career.");
    } else if (canStillBeatCompletedBest) {
      suggestedPhrasing.push(
        'He is on pace for the best championship finish of his career.',
        'The current campaign could still become his strongest championship run to date.'
      );
    }
  }

  return {
    currentSeasonInProgress,
    currentSeasonComplete: currentSeasonComplete === true,
    forbidCompletedSeasonWordingForCurrentSeason: currentSeasonInProgress,
    currentSeasonStandingPosition: currentPos,
    bestCompletedSeasonFinish: bestCompletedPos,
    bestCompletedSeasonName: bestCompletedSeason?.label ?? null,
    bestOverallSeasonFinish: bestOverallSeason?.position ?? null,
    bestOverallSeasonName: bestOverallSeason?.label ?? null,
    bestOverallIsCurrentSeasonInProgress:
      currentSeasonInProgress && bestOverallSeason?.seasonState === 'current',
    currentSeasonIsCareerBestPositionSoFar: beatsCompletedBest,
    currentSeasonTiesCareerBest: tiesCompletedBest,
    canStillBeatCompletedBest,
    isChampionshipLeader: isLeader,
    defendingPriorChampionship: priorChampionships > 0 && currentSeasonInProgress,
    remainingPointsRaces: Number.isFinite(remainingPointsRaces) ? remainingPointsRaces : null,
    suggestedPhrasing,
    rules: currentSeasonInProgress
      ? [
          'Never describe the current in-progress season as a completed season.',
          'Do not use past-tense championship finish wording (finished, placed, came in, ended the season) for the current season.',
          'If the current season is his best position so far, use present-tense career-best campaign wording — not "His best season finish came in Season N" for the current season.',
          bestCompletedSeason
            ? `For completed seasons only, historical best remains ${bestCompletedSeason.label} at P${bestCompletedSeason.position}.`
            : 'No completed championship seasons yet — describe the current campaign in present tense only.',
        ]
      : [
          'The current season is complete — past-tense championship finish wording is allowed for this season.',
        ],
  };
}

export function buildLeagueCareerSummary(
  driverId,
  seasonCatalog = null,
  progressionContext = null
) {
  const standingsBySeason = seasonCatalog?.standingsBySeason || {};
  const leagueSeasons = (seasonCatalog?.seasons || []).filter((season) => !season.excludeFromCareer);
  const classificationReliable = seasonCatalog?.classificationReliable === true;
  const currentSeasonId = seasonCatalog?.currentSeasonId
    ? String(seasonCatalog.currentSeasonId)
    : null;
  const currentBpNumber = resolveCurrentBpSeasonNumber(seasonCatalog);
  const scheduleProgress = resolveSeasonScheduleProgress(
    progressionContext?.scheduleRaces || [],
    { settings: progressionContext?.settings || null }
  );
  const currentSeasonComplete = scheduleProgress.currentSeasonComplete;
  const appearances = [];

  for (const season of sortSeasonEntries(leagueSeasons)) {
    const row = standingsBySeason[season.seasonId]?.byDriverId?.[String(driverId)];
    if (!row || row.starts <= 0) continue;
    if (!Number.isFinite(row.position) || row.position < 1) continue;

    const seasonState = resolveSeasonStateForEntry(season, {
      currentSeasonId,
      currentSeasonComplete,
      currentBpNumber,
    });

    appearances.push({
      seasonId: season.seasonId,
      seasonName: season.seasonName,
      bpSeasonNumber: season.bpSeasonNumber,
      seriesName: season.seriesName,
      category: season.category,
      position: row.position,
      points: row.points,
      starts: row.starts,
      label: formatSeasonLabel(season),
      seasonState,
    });
  }

  if (!appearances.length) {
    return {
      careerSummaryVerified: false,
      seasonsAppeared: 0,
      seasonsStarted: [],
      championships: null,
      championshipSeasons: [],
      runnerUpSeasons: [],
      top3SeasonFinishes: [],
      bestSeasonFinish: null,
      bestSeasonName: null,
      reason: 'No championship standings positions found for this driver.',
    };
  }

  const completedAppearances = appearances.filter((season) => season.seasonState === 'completed');
  const currentSeasonStanding =
    appearances.find((season) => season.seasonState === 'current') || null;

  const championshipSeasons = completedAppearances.filter((season) => season.position === 1);
  const runnerUpSeasons = completedAppearances.filter((season) => season.position === 2);
  const top3SeasonFinishes = completedAppearances.filter(
    (season) => season.position >= 1 && season.position <= 3
  );
  const bestCompletedSeason = pickBestChampionshipPosition(completedAppearances);
  const bestOverallSeason = pickBestChampionshipPosition(
    appearances.filter((season) => season.seasonState !== 'future')
  );
  const currentSeasonInProgress = Boolean(currentSeasonStanding);

  const seasonWording = buildChampionshipSeasonWordingGuide({
    currentSeasonInProgress,
    currentSeasonComplete,
    currentSeasonStanding,
    bestCompletedSeason,
    bestOverallSeason,
    remainingPointsRaces: scheduleProgress.remainingPointsRaces,
    currentSeasonPointsPosition: progressionContext?.currentSeasonPointsPosition,
    priorChampionships: championshipSeasons.length,
  });

  return {
    careerSummaryVerified: classificationReliable,
    seasonsAppeared: appearances.length,
    seasonsStarted: appearances.map(
      (season) => season.bpSeasonNumber ?? season.seasonName ?? season.seasonId
    ),
    championships: championshipSeasons.length,
    championshipSeasons: championshipSeasons.map((season) => ({
      seasonId: season.seasonId,
      seasonName: season.seasonName,
      bpSeasonNumber: season.bpSeasonNumber,
      label: season.label,
      position: season.position,
      points: season.points,
      seasonState: season.seasonState,
    })),
    runnerUpSeasons: runnerUpSeasons.map((season) => ({
      seasonId: season.seasonId,
      seasonName: season.seasonName,
      bpSeasonNumber: season.bpSeasonNumber,
      label: season.label,
      position: season.position,
      points: season.points,
      seasonState: season.seasonState,
    })),
    top3SeasonFinishes: top3SeasonFinishes.map((season) => ({
      seasonId: season.seasonId,
      seasonName: season.seasonName,
      bpSeasonNumber: season.bpSeasonNumber,
      label: season.label,
      position: season.position,
      points: season.points,
      seasonState: season.seasonState,
    })),
    bestSeasonFinish: bestOverallSeason?.position ?? null,
    bestSeasonName: bestOverallSeason?.label ?? null,
    bestSeasonId: bestOverallSeason?.seasonId ?? null,
    bestSeasonIsInProgressCurrent: seasonWording.bestOverallIsCurrentSeasonInProgress,
    bestCompletedSeasonFinish: bestCompletedSeason?.position ?? null,
    bestCompletedSeasonName: bestCompletedSeason?.label ?? null,
    bestCompletedSeasonId: bestCompletedSeason?.seasonId ?? null,
    currentSeasonStanding: currentSeasonStanding
      ? {
          seasonId: currentSeasonStanding.seasonId,
          label: currentSeasonStanding.label,
          bpSeasonNumber: currentSeasonStanding.bpSeasonNumber,
          position: currentSeasonStanding.position,
          seasonState: 'current',
        }
      : null,
    currentSeasonBpNumber: currentBpNumber,
    currentSeasonComplete,
    seasonScheduleProgress: scheduleProgress,
    seasonWording,
    participatedSeasons: appearances,
  };
}

function buildScopeCareerHistory({
  driverId,
  scopeSeasons = [],
  standingsBySeason = {},
  currentSeasonId = null,
  scope = 'league',
  classificationReliable = false,
}) {
  const participated = [];

  for (const season of scopeSeasons) {
    const row = standingsBySeason[season.seasonId]?.byDriverId?.[String(driverId)];
    if (!row || row.starts <= 0) continue;

    participated.push({
      seasonId: season.seasonId,
      seasonName: season.seasonName,
      seriesId: season.seriesId,
      seriesName: season.seriesName,
      category: season.category,
      bpSeasonNumber: season.bpSeasonNumber,
      starts: row.starts,
      wins: row.wins,
      top5s: row.top5s,
      top10s: row.top10s,
    });
  }

  participated.sort((a, b) => {
    const aNum = Number.isFinite(a.bpSeasonNumber) ? a.bpSeasonNumber : Number.MAX_SAFE_INTEGER;
    const bNum = Number.isFinite(b.bpSeasonNumber) ? b.bpSeasonNumber : Number.MAX_SAFE_INTEGER;
    if (aNum !== bNum) return aNum - bNum;
    return Number(a.seasonId) - Number(b.seasonId);
  });

  // Season standings sums are not equivalent to SimRacerHub career stats — totals require driver_stats.php.
  const totals = {
    totalCareerStarts: null,
    careerWins: null,
    careerTop5s: null,
    careerTop10s: null,
  };

  const firstParticipation = participated[0] || null;
  const currentParticipation =
    participated.find((season) => String(season.seasonId) === String(currentSeasonId)) || null;
  const bpSeasonNumbers = participated
    .map((season) => season.bpSeasonNumber)
    .filter((value) => Number.isFinite(value));

  let hasSeasonGap = false;
  for (let index = 1; index < bpSeasonNumbers.length; index += 1) {
    if (bpSeasonNumbers[index] - bpSeasonNumbers[index - 1] > 1) {
      hasSeasonGap = true;
      break;
    }
  }

  const isFirstSeasonInScope =
    Boolean(currentParticipation) &&
    participated.length === 1 &&
    String(participated[0].seasonId) === String(currentSeasonId);

  const isVeteranInScope = participated.length >= 2 && !isFirstSeasonInScope;
  const isReturningInScope =
    Boolean(currentParticipation) && hasSeasonGap && participated.length >= 2;

  return {
    scope,
    verified: participated.length > 0,
    dataAvailable: participated.length > 0,
    classificationReliable,
    tenureClaimsAllowed: classificationReliable,
    firstSeason: firstParticipation?.bpSeasonNumber ?? firstParticipation?.seasonName ?? null,
    firstSeasonId: firstParticipation?.seasonId ?? null,
    firstSeasonName: firstParticipation?.seasonName ?? null,
    currentSeasonId: currentSeasonId ? String(currentSeasonId) : null,
    seasonsStarted: participated.map(
      (season) => season.bpSeasonNumber ?? season.seasonName ?? season.seasonId
    ),
    ...totals,
    priorSeasonResults: participated.filter(
      (season) => String(season.seasonId) !== String(currentSeasonId)
    ),
    participatedSeasons: participated,
    isFirstSeasonInScope,
    isTruckSeriesVeteran: scope === 'bp-truck-series' ? isVeteranInScope : undefined,
    isFirstTruckSeason: scope === 'bp-truck-series' ? isFirstSeasonInScope : undefined,
    isVeteranInScope,
    isReturningInScope,
    careerStatsVerified: false,
    careerStatsSource: null,
    verifiedCareerStats: null,
    reason: classificationReliable
      ? 'Career totals require SimRacerHub driver_stats.php — season standings sums are not published.'
      : 'Season classification was not reliable enough for automated career-tenure claims.',
  };
}

export function isSrhDisconnectedStatus(status) {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/\\\//g, '/')
    .includes('disconnect');
}

function parseDriverStatsRaceParticipantBody(match) {
  const body = match[3];
  const get = (key) => body.match(new RegExp(`"${key}":"([^"]*)"`))?.[1];
  const finish = Number(get('finish_pos'));
  const status = get('status') || '';
  const hasValidFinish = Number.isFinite(finish) && finish >= 1;

  if (!hasValidFinish && !isSrhDisconnectedStatus(status)) return null;

  return {
    raceParticipantId: match[2],
    raceId: get('race_id') || null,
    finish: hasValidFinish ? finish : null,
    status,
    isDisconnected: isSrhDisconnectedStatus(status),
    incidents: Number(get('incidents') || 0),
    lapsLed: Number(get('laps_led') || 0),
    qualifyPos: get('qualify_pos') || '',
    seasonId: String(get('season_id') || ''),
    seriesId: String(get('series_id') || ''),
    leagueId: String(get('league_id') || ''),
    provisional: get('provisional') || 'N',
  };
}

export function parseDriverStatsRaceEntries(html) {
  const m = String(html || '').match(/React\.createElement\(DriverStats,(\{[\s\S]*?\})\)\)/);
  if (!m) return [];

  const entries = [];
  for (const match of m[1].matchAll(/"(\d+)":\{"race_participant_id":"(\d+)"([\s\S]*?)\}(?=,"|\})/g)) {
    const row = parseDriverStatsRaceParticipantBody(match);
    if (row) entries.push(row);
  }

  return entries;
}

function extractJsObjectAfterMarker(html, marker) {
  const start = String(html || '').indexOf(marker);
  if (start < 0) return null;
  const braceStart = html.indexOf('{', start + marker.length);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(braceStart, i + 1);
    }
  }

  return null;
}

export function parseDriverStatsTrackConfigs(html) {
  const configsJson = extractJsObjectAfterMarker(html, 'configs:');
  if (!configsJson) return {};

  try {
    return JSON.parse(configsJson);
  } catch {
    return {};
  }
}

export function parseDriverCareerRaceEntries(html, leagueId = DEFAULT_LEAGUE_ID) {
  const configs = parseDriverStatsTrackConfigs(html);
  const league = String(leagueId);
  const entries = [];

  for (const match of String(html || '').matchAll(
    /"(\d+)":\{"race_participant_id":"(\d+)"([\s\S]*?)\}(?=,"|\})/g
  )) {
    const row = parseDriverStatsRaceParticipantBody(match);
    if (!row) continue;
    if (String(row.leagueId || '') !== league) continue;

    const trackConfigId = match[3].match(/"track_config_id":"([^"]*)"/)?.[1];
    const cfg = configs[trackConfigId] || {};

    entries.push({
      ...row,
      scheduleId: match[3].match(/"schedule_id":"([^"]*)"/)?.[1] || null,
      trackConfigId: trackConfigId || null,
      trackName: cfg.track_name || null,
      trackConfigName: cfg.track_config_name || null,
      trackConfigShort: cfg.track_config_short || null,
      simracerTypeName: cfg.type_name || null,
    });
  }

  return entries;
}

export async function fetchDriverCareerRaceEntries(driverId, leagueId = DEFAULT_LEAGUE_ID) {
  const league = String(leagueId);
  const sourceUrl = `https://www.simracerhub.com/scoring/driver_stats.php?driver_id=${driverId}&league_id=${league}`;
  const html = await fetchHtml(sourceUrl);

  return {
    driverId: String(driverId),
    leagueId: league,
    sourceUrl,
    dataSource: 'career history',
    entries: parseDriverCareerRaceEntries(html, league),
  };
}

export async function fetchDriverCareerRaceEntriesByDriver(
  driverIds = [],
  leagueId = DEFAULT_LEAGUE_ID,
  { concurrency = 6 } = {}
) {
  const ids = [...new Set(driverIds.map((id) => String(id)).filter(Boolean))];
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;

  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), ids.length);

  async function worker() {
    while (cursor < ids.length) {
      const driverId = ids[cursor];
      cursor += 1;
      try {
        const result = await fetchDriverCareerRaceEntries(driverId, leagueId);
        map.set(driverId, result.entries);
      } catch {
        map.set(driverId, []);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return map;
}

function buildParticipatedSeasonsFromRaceEntries(entries = [], seasonCatalog = null) {
  const seasonLookup = Object.fromEntries(
    (seasonCatalog?.seasons || []).map((season) => [String(season.seasonId), season])
  );
  const bySeason = {};

  for (const entry of entries) {
    if (!bySeason[entry.seasonId]) {
      const meta = seasonLookup[entry.seasonId] || {};
      bySeason[entry.seasonId] = {
        seasonId: entry.seasonId,
        seasonName: meta.seasonName || null,
        seriesId: meta.seriesId || entry.seriesId,
        seriesName: meta.seriesName || null,
        category: meta.category || LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
        bpSeasonNumber: meta.bpSeasonNumber ?? null,
        starts: 0,
        wins: 0,
        top5s: 0,
        top10s: 0,
      };
    }
    const season = bySeason[entry.seasonId];
    season.starts += 1;
    if (entry.isDisconnected) return;
    if (entry.finish === 1) season.wins += 1;
    if (entry.finish >= 1 && entry.finish <= 5) season.top5s += 1;
    if (entry.finish >= 1 && entry.finish <= 10) season.top10s += 1;
  }

  return Object.values(bySeason).sort((a, b) => {
    const aNum = Number.isFinite(a.bpSeasonNumber) ? a.bpSeasonNumber : Number.MAX_SAFE_INTEGER;
    const bNum = Number.isFinite(b.bpSeasonNumber) ? b.bpSeasonNumber : Number.MAX_SAFE_INTEGER;
    if (aNum !== bNum) return aNum - bNum;
    return Number(a.seasonId) - Number(b.seasonId);
  });
}

export function aggregateLeagueCareerStatsFromRaceEntries(entries = [], meta = {}) {
  const starts = entries.length;
  if (!starts) {
    return {
      verified: false,
      careerStarts: null,
      careerWins: null,
      careerTop5s: null,
      careerTop10s: null,
      careerAverageFinish: null,
      careerPoles: null,
      careerLapsLed: null,
      careerIncidents: null,
      careerDisconnects: null,
      careerDisconnectRate: null,
      careerIncidentsPerStart: null,
      raceEntriesUsed: 0,
      reason: 'No race results found in SimRacerHub driver stats.',
    };
  }

  const completedEntries = entries.filter((entry) => !entry.isDisconnected);
  const disconnects = entries.filter((entry) => entry.isDisconnected).length;
  const wins = completedEntries.filter((entry) => entry.finish === 1).length;
  const top5s = completedEntries.filter((entry) => entry.finish >= 1 && entry.finish <= 5).length;
  const top10s = completedEntries.filter((entry) => entry.finish >= 1 && entry.finish <= 10).length;
  const poles = completedEntries.filter((entry) => Number(entry.qualifyPos) === 1).length;
  const lapsLed = completedEntries.reduce((sum, entry) => sum + entry.lapsLed, 0);
  const incidents = entries.reduce((sum, entry) => sum + entry.incidents, 0);
  const careerAverageFinish =
    completedEntries.length > 0
      ? Number(
          (
            completedEntries.reduce((sum, entry) => sum + entry.finish, 0) / completedEntries.length
          ).toFixed(1)
        )
      : null;

  return {
    verified: true,
    careerStarts: starts,
    careerWins: wins,
    careerTop5s: top5s,
    careerTop10s: top10s,
    careerAverageFinish,
    careerPoles: poles,
    careerLapsLed: lapsLed,
    careerIncidents: incidents,
    careerDisconnects: disconnects,
    careerDisconnectRate: Number((disconnects / starts).toFixed(3)),
    careerIncidentsPerStart: Number((incidents / starts).toFixed(3)),
    raceEntriesUsed: starts,
  };
}

export async function fetchSimRacerHubLeagueCareerStats(driverId, seasonCatalog = null) {
  const leagueId = String(seasonCatalog?.leagueId || DEFAULT_LEAGUE_ID);
  const sourceUrl = `https://www.simracerhub.com/scoring/driver_stats.php?driver_id=${driverId}&league_id=${leagueId}`;

  try {
    const html = await fetchHtml(sourceUrl);
    const entries = parseDriverStatsRaceEntries(html).filter(
      (entry) => entry.leagueId === leagueId
    );

    const parsedCareerStats = aggregateLeagueCareerStatsFromRaceEntries(entries, {
      driverId,
      leagueId,
    });

    const leagueCareerStats = {
      scope: 'league',
      careerStatsScope: 'league',
      careerStatsVerified: parsedCareerStats.verified === true,
      careerStatsSource: 'simracerhub-driver_stats.php',
      careerStatsSourceUrl: sourceUrl,
      careerStatsDriverId: String(driverId),
      leagueId,
      parsedCareerStats,
      participatedSeasons: parsedCareerStats.verified
        ? buildParticipatedSeasonsFromRaceEntries(entries, seasonCatalog)
        : [],
      ...parsedCareerStats,
    };

    return leagueCareerStats;
  } catch (error) {
    return {
      scope: 'league',
      careerStatsScope: 'league',
      verified: false,
      careerStatsVerified: false,
      careerStatsSource: 'simracerhub-driver_stats.php',
      careerStatsSourceUrl: sourceUrl,
      careerStatsDriverId: String(driverId),
      parsedCareerStats: null,
      reason: error?.message || 'Failed to load SimRacerHub driver stats.',
    };
  }
}

export const fetchSimRacerHubDriverCareerStats = fetchSimRacerHubLeagueCareerStats;

export const aggregateVerifiedCareerStatsFromRaceEntries = aggregateLeagueCareerStatsFromRaceEntries;

export async function discoverSimRacerHubSeasonCatalog(settings, standingsLss = null) {
  const currentSeasonId = String(standingsLss?.season_id || settings?.seasonId || '27987');
  const currentSeasonName = standingsLss?.season_name || settings?.seasonName || null;
  const leagueId = String(standingsLss?.league_id || settings?.leagueId || DEFAULT_LEAGUE_ID);
  const currentSeriesId = standingsLss?.series_id ? String(standingsLss.series_id) : null;

  const seriesEntries = [];
  const seasonEntries = [];
  const standingsBySeason = {};
  let leaguePageError = null;

  try {
    const leagueHtml = await fetchHtml(
      `https://www.simracerhub.com/league_series.php?league_id=${leagueId}`
    );
    const parsedSeries = parseLeagueSeriesFromPage(leagueHtml);

    for (const series of parsedSeries) {
      seriesEntries.push(series);
      let seasons = [];
      try {
        const seriesHtml = await fetchHtml(
          `https://www.simracerhub.com/scoring/series_seasons.php?series_id=${series.seriesId}`
        );
        seasons = parsePublicSeasonsFromSeriesPage(seriesHtml);
      } catch {
        seasons = [];
      }

      for (const season of seasons) {
        const classification = classifyLeagueSeasonEntry({
          seriesName: series.seriesName,
          seasonName: season.seasonName,
        });

        seasonEntries.push({
          leagueId,
          seriesId: series.seriesId,
          seriesName: series.seriesName,
          seasonId: season.seasonId,
          seasonName: season.seasonName,
          ...classification,
        });
      }
    }
  } catch (error) {
    leaguePageError = error?.message || 'Failed to load league series page.';
  }

  const activeSeasonEntries = seasonEntries.filter((season) => !season.excludeFromCareer);
  const reliability = evaluateClassificationReliability(seasonEntries);

  for (const season of activeSeasonEntries) {
    try {
      standingsBySeason[season.seasonId] = await fetchSeasonStandingsSnapshot(season.seasonId);
      if (!season.seasonName && standingsBySeason[season.seasonId]?.seasonName) {
        season.seasonName = standingsBySeason[season.seasonId].seasonName;
      }
    } catch (error) {
      reliability.classificationReliable = false;
      reliability.classificationIssues.push(
        `Could not load standings for season ${season.seasonId}: ${error.message}`
      );
    }
  }

  const bpSeasonEntries = activeSeasonEntries.filter((season) =>
    [
      LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
      LEAGUE_SERIES_CATEGORIES.BP_KN,
      LEAGUE_SERIES_CATEGORIES.WINTER,
    ].includes(season.category)
  );

  const truckSeasonEntries = activeSeasonEntries.filter(
    (season) => season.category === LEAGUE_SERIES_CATEGORIES.BP_TRUCK
  );

  const firstTruckSeason = pickFirstSeasonEntry(truckSeasonEntries);
  const firstBpSeasonOverall = pickFirstSeasonEntry(bpSeasonEntries);

  return {
    dataSource: 'simracerhub-league-series-page',
    leagueId,
    currentSeasonId,
    currentSeasonName,
    currentSeriesId,
    seriesScanned: seriesEntries.length,
    seasonsScanned: seasonEntries.length,
    classificationReliable: reliability.classificationReliable,
    classificationIssues: reliability.classificationIssues,
    leaguePageError,
    series: seriesEntries,
    seasons: seasonEntries,
    standingsBySeason,
    diagnostics: {
      seasonsScanned: seasonEntries.length,
      seriesScanned: seriesEntries.length,
      firstTruckSeason: firstTruckSeason
        ? {
            seasonId: firstTruckSeason.seasonId,
            seasonName: firstTruckSeason.seasonName,
            seriesId: firstTruckSeason.seriesId,
            seriesName: firstTruckSeason.seriesName,
            bpSeasonNumber: firstTruckSeason.bpSeasonNumber,
            category: firstTruckSeason.category,
          }
        : null,
      firstBpSeasonOverall: firstBpSeasonOverall
        ? {
            seasonId: firstBpSeasonOverall.seasonId,
            seasonName: firstBpSeasonOverall.seasonName,
            seriesId: firstBpSeasonOverall.seriesId,
            seriesName: firstBpSeasonOverall.seriesName,
            bpSeasonNumber: firstBpSeasonOverall.bpSeasonNumber,
            category: firstBpSeasonOverall.category,
          }
        : null,
      classificationReliable: reliability.classificationReliable,
      classificationIssues: reliability.classificationIssues,
    },
    driverIdStableAcrossSeasons:
      'SimRacerHub driver IDs (drid) remain stable within the scoring platform and can be matched across seasons when season snapshots are available.',
    auditNotes: reliability.classificationReliable
      ? 'Public league history catalog loaded and classified for BP career history.'
      : reliability.classificationIssues.join(' ') ||
        leaguePageError ||
        'Career tenure claims are suppressed because season classification was not reliable.',
  };
}

export function buildDriverCareerHistory({
  driverId = null,
  standingsRow = null,
  seasonCatalog = null,
  manualRaceNotes = '',
  transcriptSummary = '',
  verifiedCareerStats = null,
  leagueCareerStats = null,
  progressionContext = null,
}) {
  const resolvedLeagueCareerStats = leagueCareerStats || verifiedCareerStats;
  const manualTenure = parseTenureClaimsFromNotes(manualRaceNotes, transcriptSummary);
  const classificationReliable = seasonCatalog?.classificationReliable === true;
  const currentSeasonId = seasonCatalog?.currentSeasonId || null;
  const standingsBySeason = seasonCatalog?.standingsBySeason || {};
  const seasons = seasonCatalog?.seasons || [];

  const activeSeasons = seasons.filter((season) => !season.excludeFromCareer);
  const truckSeasons = activeSeasons.filter(
    (season) => season.category === LEAGUE_SERIES_CATEGORIES.BP_TRUCK
  );
  const overallSeasons = activeSeasons.filter((season) =>
    [
      LEAGUE_SERIES_CATEGORIES.BP_TRUCK,
      LEAGUE_SERIES_CATEGORIES.BP_KN,
      LEAGUE_SERIES_CATEGORIES.WINTER,
    ].includes(season.category)
  );

  const truckSeriesCareerHistory = buildScopeCareerHistory({
    driverId,
    scopeSeasons: truckSeasons,
    standingsBySeason,
    currentSeasonId,
    scope: 'bp-truck-series',
    classificationReliable,
  });

  const overallLeagueCareerHistory = buildScopeCareerHistory({
    driverId,
    scopeSeasons: overallSeasons,
    standingsBySeason,
    currentSeasonId,
    scope: 'bp-league-overall',
    classificationReliable,
  });

  if (manualTenure.tenureClaimsAllowed) {
    truckSeriesCareerHistory.tenureClaimsAllowed = true;
    overallLeagueCareerHistory.tenureClaimsAllowed = true;
    truckSeriesCareerHistory.manualTenureNotes = manualTenure.claims;
    overallLeagueCareerHistory.manualTenureNotes = manualTenure.claims;
  }

  const currentSeasonOnly = standingsRow
    ? {
        seasonId: currentSeasonId,
        seasonName: seasonCatalog?.currentSeasonName || null,
        starts: Number(standingsRow.races ?? standingsRow.starts ?? 0),
        wins: Number(standingsRow.wins ?? 0),
        top5s: Number(standingsRow.top5 ?? 0),
        top10s: Number(standingsRow.top10 ?? 0),
        source: 'standings API (current season snapshot)',
      }
    : null;

  const leagueCareerSummary = buildLeagueCareerSummary(driverId, seasonCatalog, {
    scheduleRaces: progressionContext?.scheduleRaces || [],
    settings: progressionContext?.settings || null,
    currentSeasonPointsPosition: Number.isFinite(Number(standingsRow?.position))
      ? Number(standingsRow.position)
      : null,
  });

  const careerHistory = {
    ...truckSeriesCareerHistory,
    truckSeriesCareerHistory,
    overallLeagueCareerHistory,
    leagueCareerStats: resolvedLeagueCareerStats?.careerStatsVerified
      ? resolvedLeagueCareerStats
      : null,
    leagueCareerSummary,
    currentSeasonOnly,
    forbiddenWithoutVerification: CAREER_TENURE_FORBIDDEN_WITHOUT_VERIFICATION,
    manualTenureNotes: manualTenure.claims,
    reason:
      truckSeriesCareerHistory.reason ||
      seasonCatalog?.auditNotes ||
      (resolvedLeagueCareerStats?.careerStatsVerified
        ? null
        : 'League career stat totals require SimRacerHub driver_stats.php.'),
  };

  return careerHistory;
}

export function buildCareerStatsDiagnostics(
  leagueCareerStats,
  spotlightDriverId,
  leagueCareerSummary = null,
  seasonCatalog = null
) {
  return {
    careerStatsScope: leagueCareerStats?.careerStatsScope || 'league',
    careerStatsSource: leagueCareerStats?.careerStatsSource || null,
    careerStatsSourceUrl: leagueCareerStats?.careerStatsSourceUrl || null,
    careerStatsDriverId: spotlightDriverId ? String(spotlightDriverId) : null,
    careerStatsVerified: leagueCareerStats?.careerStatsVerified === true,
    leagueCareerStatsUsed: leagueCareerStats?.careerStatsVerified === true,
    parsedCareerStats: leagueCareerStats?.parsedCareerStats || null,
    careerStatsUsed: leagueCareerStats?.careerStatsVerified
      ? {
          careerStarts: leagueCareerStats.careerStarts,
          careerWins: leagueCareerStats.careerWins,
          careerTop5s: leagueCareerStats.careerTop5s,
          careerTop10s: leagueCareerStats.careerTop10s,
          careerAverageFinish: leagueCareerStats.careerAverageFinish,
          careerPoles: leagueCareerStats.careerPoles,
          careerLapsLed: leagueCareerStats.careerLapsLed,
          careerIncidents: leagueCareerStats.careerIncidents,
        }
      : null,
    seasonsScanned: seasonCatalog?.seasonsScanned ?? seasonCatalog?.seasons?.length ?? null,
    careerSummaryVerified: leagueCareerSummary?.careerSummaryVerified === true,
    bestSeasonFinish: leagueCareerSummary?.bestSeasonFinish ?? null,
    bestSeasonName: leagueCareerSummary?.bestSeasonName ?? null,
    championships: leagueCareerSummary?.championships ?? null,
    championshipSeasons: leagueCareerSummary?.championshipSeasons ?? [],
    runnerUpSeasons: leagueCareerSummary?.runnerUpSeasons ?? [],
    top3SeasonFinishes: leagueCareerSummary?.top3SeasonFinishes ?? [],
    seasonsAppeared: leagueCareerSummary?.seasonsAppeared ?? null,
    unsupportedCareerSummaryClaims: [],
    rejectedUnsupportedClaims: [],
  };
}

export async function enrichSpotlightDriverCareerStats(generationContext, spotlightDriverId) {
  if (!spotlightDriverId || !generationContext?.factualGrounding?.drivers) {
    return generationContext;
  }

  const driverKey = String(spotlightDriverId);
  const catalog = generationContext.factualGrounding.careerHistoryAudit;
  const leagueCareerStats = await fetchSimRacerHubLeagueCareerStats(driverKey, catalog);
  const existing = generationContext.factualGrounding.drivers[driverKey];
  const standingsRow = generationContext.standings?.find(
    (row) => String(row.driverId) === driverKey
  );
  const leagueCareerSummary = buildLeagueCareerSummary(driverKey, catalog, {
    scheduleRaces: generationContext.scheduleRaces || [],
    settings: generationContext.settings || null,
    currentSeasonPointsPosition: Number.isFinite(Number(standingsRow?.position))
      ? Number(standingsRow.position)
      : null,
  });
  const careerStatsDiagnostics = buildCareerStatsDiagnostics(
    leagueCareerStats,
    spotlightDriverId,
    leagueCareerSummary,
    catalog
  );

  if (!existing) {
    return {
      ...generationContext,
      leagueCareerStats,
      leagueCareerSummary,
      careerStatsDiagnostics,
    };
  }

  const careerHistory = buildDriverCareerHistory({
    driverId: driverKey,
    standingsRow,
    seasonCatalog: catalog,
    manualRaceNotes: generationContext.manualRaceNotes || '',
    transcriptSummary: generationContext.contextMeta?.broadcastContext?.summary || '',
    leagueCareerStats,
    progressionContext: {
      scheduleRaces: generationContext.scheduleRaces || [],
      settings: generationContext.settings || null,
    },
  });

  generationContext.factualGrounding.drivers[driverKey] = {
    ...existing,
    careerHistory,
    truckSeriesCareerHistory: careerHistory.truckSeriesCareerHistory,
    overallLeagueCareerHistory: careerHistory.overallLeagueCareerHistory,
    leagueCareerStats: careerHistory.leagueCareerStats,
    leagueCareerSummary: careerHistory.leagueCareerSummary,
  };

  return {
    ...generationContext,
    leagueCareerStats,
    leagueCareerSummary,
    careerStatsDiagnostics,
  };
}

function parseNumericClaim(value) {
  const parsed = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

const WORD_NUMBER_MAP = {
  one: 1,
  a: 1,
  single: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseWordOrNumericClaim(value) {
  const numeric = parseNumericClaim(value);
  if (Number.isFinite(numeric)) return numeric;
  const word = String(value || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return WORD_NUMBER_MAP[word] ?? null;
}

const CAREER_SCOPE_WINDOW_PATTERN =
  /\bcareer\b|\bleague\s+career\b|\bblazing pedals\b(?:\s+career)?|\bacross (?:his|her|their)\b|\bover (?:his|her|their)\b|\ball[- ]time\b|\bthroughout (?:his|her|their)\b/i;

const SEASON_SCOPE_WINDOW_PATTERN =
  /\bthis season\b|\bcurrent season\b|\bseason\s*#?\s*\d+\b|\b20\d{2}\s+season\b|\bin the standings\b|\bchampionship standings\b|\bpoints standings\b/i;

export const MIXED_SCOPE_ERROR_TYPES = new Set([
  'unsupported-mixed-scope-season-career',
  'career-stat-labeled-as-season',
  'season-stat-labeled-as-career',
  'unsupported-mixed-scope',
]);

export const HISTORICAL_SEASON_ERROR_TYPES = new Set([
  'historical-season-points-mismatch',
  'unsupported-best-points-claim',
  'cross-season-points-comparison',
]);

export const SPOTLIGHT_SCOPE_ERROR_TYPES = new Set([
  ...MIXED_SCOPE_ERROR_TYPES,
  ...HISTORICAL_SEASON_ERROR_TYPES,
]);

function lookupParticipatedSeason(summary, seasonNum) {
  const participated = summary?.participatedSeasons || [];
  return (
    participated.find((season) => season.bpSeasonNumber === seasonNum) ||
    participated.find((season) =>
      new RegExp(`season\\s*#?\\s*${seasonNum}\\b`, 'i').test(season.label || season.seasonName || '')
    ) ||
    null
  );
}

const MIXED_SCOPE_WORD_NUM = 'one|two|three|four|five|six|seven|eight|nine|ten|\\d[\\d,]*';

function pushMixedScopeError(unsupported, seen, entry) {
  const key = `${entry.type}|${entry.field || ''}|${entry.claim}`;
  if (seen.has(key)) return;
  seen.add(key);
  unsupported.push(entry);
}

function getCareerSeasonValues(leagueCareerStats, seasonStats, careerField, seasonField) {
  const careerValue = Number(leagueCareerStats?.[careerField]);
  const seasonValue = Number(seasonStats?.[seasonField]);
  return {
    careerValue: Number.isFinite(careerValue) ? careerValue : null,
    seasonValue: Number.isFinite(seasonValue) ? seasonValue : null,
  };
}

function scopesDiffer(careerValue, seasonValue) {
  return careerValue != null && seasonValue != null && careerValue !== seasonValue;
}

export function buildSpotlightVerifiedStatsRepairBlock(context = {}) {
  const driverKey = context.spotlightDriverId ? String(context.spotlightDriverId) : null;
  const league =
    context.leagueCareerStats ||
    context.factualGrounding?.drivers?.[driverKey]?.leagueCareerStats ||
    null;
  const season =
    context.allowedSeasonStats ||
    context.factualGrounding?.drivers?.[driverKey]?.allowedSeasonStats ||
    null;
  const summary =
    context.leagueCareerSummary ||
    context.factualGrounding?.drivers?.[driverKey]?.leagueCareerSummary ||
    null;
  const currentSeasonBpNumber = context.currentSeasonBpNumber ?? null;

  if (!league?.careerStatsVerified || !season) {
    return '';
  }

  const lines = [
    `Verified currentSeasonStats (label: this season / current season${currentSeasonBpNumber ? ` / Season ${currentSeasonBpNumber}` : ''}):`,
    `- wins: ${season.winsTotal}`,
    `- top5: ${season.top5Total}`,
    `- top10: ${season.top10Total}`,
    `- points: ${season.pointsTotal}`,
    `- position: P${season.pointsPosition}`,
    '',
    'Verified leagueCareerStats (label: career / league career / Blazing Pedals career):',
    `- starts: ${league.careerStarts}`,
    `- wins: ${league.careerWins}`,
    `- top5: ${league.careerTop5s}`,
    `- top10: ${league.careerTop10s}`,
    `- avgFinish: ${league.careerAverageFinish}`,
    `- poles: ${league.careerPoles}`,
    `- lapsLed: ${league.careerLapsLed}`,
  ];

  if (summary?.careerSummaryVerified) {
    lines.push(
      '',
      'Verified leagueCareerSummary (historical seasons — use finishing POSITION and season name; do NOT use current-season points for past seasons):',
      `- bestSeasonFinish: P${summary.bestSeasonFinish}`,
      `- bestSeasonName: ${summary.bestSeasonName}`,
      `- championships: ${summary.championships}`,
      `- seasonsAppeared: ${summary.seasonsAppeared}`,
      `- seasonsStarted: ${(summary.seasonsStarted || []).join(', ')}`
    );

    if (summary.championshipSeasons?.length) {
      lines.push(
        `- championshipSeasons: ${summary.championshipSeasons.map((s) => `${s.label} P${s.position}`).join(', ')}`
      );
    }
    if (summary.runnerUpSeasons?.length) {
      lines.push(
        `- runnerUpSeasons: ${summary.runnerUpSeasons
          .map((s) => `${s.label} P${s.position} (${s.points} pts that season)`)
          .join(', ')}`
      );
    }
    if (summary.top3SeasonFinishes?.length) {
      lines.push(
        `- top3SeasonFinishes: ${summary.top3SeasonFinishes
          .map((s) => `${s.label} P${s.position}`)
          .join(', ')}`
      );
    }

    if (summary.bestCompletedSeasonFinish != null) {
      lines.push(
        `- bestCompletedSeasonFinish: P${summary.bestCompletedSeasonFinish} (${summary.bestCompletedSeasonName})`
      );
    }
    if (summary.currentSeasonStanding) {
      lines.push(
        `- currentSeasonStanding (in progress): ${summary.currentSeasonStanding.label} P${summary.currentSeasonStanding.position}`
      );
    }
    if (summary.seasonWording) {
      lines.push(
        '',
        'Season wording (mandatory for championship history):',
        `- currentSeasonInProgress: ${summary.seasonWording.currentSeasonInProgress}`,
        `- bestOverallIsCurrentSeasonInProgress: ${summary.seasonWording.bestOverallIsCurrentSeasonInProgress}`,
        `- currentSeasonIsCareerBestPositionSoFar: ${summary.seasonWording.currentSeasonIsCareerBestPositionSoFar}`,
        ...(summary.seasonWording.rules || []).map((rule) => `- ${rule}`),
        ...(summary.seasonWording.suggestedPhrasing?.length
          ? [
              '- suggestedPhrasing examples:',
              ...summary.seasonWording.suggestedPhrasing.map((phrase) => `  • ${phrase}`),
            ]
          : [])
      );
    }

    lines.push(
      '',
      `CRITICAL: Current-season points (${season.pointsTotal}) apply ONLY to the current season${currentSeasonBpNumber ? ` (Season ${currentSeasonBpNumber})` : ''}. Never attach them to Season 8 or other historical seasons.`,
      summary.seasonWording?.forbidCompletedSeasonWordingForCurrentSeason
        ? `CRITICAL: Season ${currentSeasonBpNumber ?? 'current'} is IN PROGRESS — never say his best season finish "came in" or he "finished/placed" in the current season. Use present-tense campaign wording from seasonWording.`
        : ''
    );
  }

  return lines.join('\n');
}

const WORD_CAREER_WIN_PATTERNS = [
  { pattern: /\b(one|a single|single)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 1 },
  { pattern: /\b(one|a)\s+career\s+win\b/gi, value: 1 },
  { pattern: /\b(two)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 2 },
  { pattern: /\b(three)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 3 },
  { pattern: /\b(four)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 4 },
  { pattern: /\b(five)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 5 },
  { pattern: /\b(six)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 6 },
  { pattern: /\b(seven)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 7 },
  { pattern: /\b(eight)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 8 },
  { pattern: /\b(nine)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 9 },
  { pattern: /\b(ten)\s+(?:career\s+|league\s+)?wins?\b/gi, value: 10 },
  { pattern: /\bfirst\s+(?:career\s+|league\s+|blazing pedals\s+)?win\b/gi, value: 1 },
];

const DRIVER_SPOTLIGHT_STYLE_PATTERNS = [
  {
    type: 'unsupported-driver-style',
    pattern: /\bcalm under pressure\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\btactical acumen\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\btactical\b/gi,
    message: 'Personality/style claim (tactical) requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bstrategic driver\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bknows track dynamics\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\btrack dynamics\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bresilient\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bdetermined\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bdedication and skill\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bveteran savvy\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\blikely contributed\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bracecraft\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bmental toughness\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
  {
    type: 'unsupported-driver-style',
    pattern: /\bstrategic (?:mind|prowess|savvy|approach|thinker)\b/gi,
    message: 'Personality/style claim requires manual notes or transcript.',
  },
];

const CAREER_STAT_CLAIM_RULES = [
  {
    field: 'careerStarts',
    patterns: [
      /\b(\d[\d,]*)\s+career\s+starts?\b/gi,
      /\b(\d[\d,]*)\s+starts?\s+(?:in|across)\s+(?:his|her|their)\s+(?:truck\s+series\s+)?career\b/gi,
      /\b(?:over|across)\s+(?:his|her|their)\s+career[^.!?]{0,40}\b(\d[\d,]*)\s+starts?\b/gi,
    ],
  },
  {
    field: 'careerWins',
    patterns: [
      /\b(\d[\d,]*)\s+career\s+wins?\b/gi,
      /\b(\d[\d,]*)\s+wins?\s+(?:in|across)\s+(?:his|her|their)\s+(?:truck\s+series\s+|league\s+|blazing pedals\s+)?career\b/gi,
      /\b(?:over|across)\s+(?:his|her|their)\s+(?:league\s+)?career[^.!?]{0,50}\b(\d[\d,]*)\s+wins?\b/gi,
    ],
  },
  {
    field: 'careerTop5s',
    patterns: [
      /\b(\d[\d,]*)\s+(?:career\s+)?top[\s-]?(?:five|5s?)\b/gi,
      /\b(\d[\d,]*)\s+top[\s-]?five\b/gi,
    ],
  },
  {
    field: 'careerTop10s',
    patterns: [
      /\b(\d[\d,]*)\s+(?:career\s+)?top[\s-]?(?:ten|10s?)\b/gi,
      /\b(\d[\d,]*)\s+top[\s-]?ten\b/gi,
    ],
  },
  {
    field: 'careerAverageFinish',
    patterns: [/\b(?:career\s+)?average finish(?:ing)?\s+of\s+(\d+(?:\.\d+)?)\b/gi],
  },
  {
    field: 'careerPoles',
    patterns: [/\b(\d[\d,]*)\s+(?:career\s+)?poles?\b/gi],
  },
  {
    field: 'careerLapsLed',
    patterns: [/\b(\d[\d,]*)\s+(?:career\s+)?laps?\s+led\b/gi],
  },
  {
    field: 'careerIncidents',
    patterns: [/\b(\d[\d,]*)\s+(?:career\s+)?incidents?\b/gi],
  },
];

export function validateDriverSpotlightStyleClaims(text, context = {}) {
  const unsupported = [];
  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';

  for (const rule of DRIVER_SPOTLIGHT_STYLE_PATTERNS) {
    for (const match of String(text || '').matchAll(rule.pattern)) {
      if (claimSupportedInNotes(match[0], manualRaceNotes, transcriptSummary)) continue;
      unsupported.push({
        type: rule.type,
        message: rule.message,
        claim: match[0].trim(),
      });
    }
  }

  return unsupported;
}

export function validateDriverSpotlightCareerStats(text, context = {}) {
  const unsupported = [];
  const leagueCareerStats =
    context.leagueCareerStats ||
    context.verifiedCareerStats ||
    context.truckSeriesCareerHistory?.leagueCareerStats ||
    null;
  const verified = leagueCareerStats?.careerStatsVerified
    ? leagueCareerStats.parsedCareerStats || leagueCareerStats
    : null;
  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';
  const seasonStats = context.allowedSeasonStats || null;

  for (const rule of CAREER_STAT_CLAIM_RULES) {
    for (const pattern of rule.patterns) {
      for (const match of String(text || '').matchAll(pattern)) {
        const claim = match[0];
        if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;

        const claimed = parseNumericClaim(match[1]);
        if (!Number.isFinite(claimed)) continue;

        const verifiedValue = leagueCareerStats?.[rule.field] ?? verified?.[rule.field];
        if (!leagueCareerStats?.careerStatsVerified || verifiedValue == null) {
          unsupported.push({
            type: 'unsupported-career-stat',
            message: `Career stat claim (${rule.field}) is unavailable — omit career totals.`,
            claim: claim.trim(),
            field: rule.field,
          });
          continue;
        }

        if (claimed !== verifiedValue) {
          unsupported.push({
            type: 'unsupported-career-stat',
            message: `Claimed ${rule.field} ${claimed}, but verified SimRacerHub value is ${verifiedValue}.`,
            claim: claim.trim(),
            field: rule.field,
            verifiedValue,
          });
        }
      }
    }
  }

  for (const match of String(text || '').matchAll(/\b(\d[\d,]*)\s+starts?\b/gi)) {
    const claim = match[0];
    const idx = match.index ?? 0;
    const window = String(text || '').slice(Math.max(0, idx - 70), idx + claim.length + 70);
    if (!/\bcareer\b|\bacross (?:his|her|their)\b|\bover (?:his|her|their)\b|\ball[- ]time\b/i.test(window)) {
      continue;
    }
    if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
    if (/\bthis season\b|\bin the standings\b/i.test(window)) continue;

    const claimed = parseNumericClaim(match[1]);
    if (!Number.isFinite(claimed)) continue;
    if (leagueCareerStats?.careerStatsVerified && claimed === leagueCareerStats.careerStarts) continue;

    if (!leagueCareerStats?.careerStatsVerified) {
      unsupported.push({
        type: 'unsupported-career-stat',
        message: 'Career starts require verified SimRacerHub driver stats or manual notes.',
        claim: claim.trim(),
        field: 'careerStarts',
      });
    } else {
      unsupported.push({
        type: 'unsupported-career-stat',
        message: `Claimed ${claimed} career starts, but verified value is ${leagueCareerStats.careerStarts}.`,
        claim: claim.trim(),
        field: 'careerStarts',
        verifiedValue: leagueCareerStats.careerStarts,
      });
    }
  }

  for (const match of String(text || '').matchAll(/\b(\d[\d,]*)\s+wins?\b/gi)) {
    const claim = match[0];
    if (/\b(at|in|from)\b/i.test(claim)) continue;
    const idx = match.index ?? 0;
    const window = String(text || '').slice(Math.max(0, idx - 70), idx + claim.length + 70);
    if (!CAREER_SCOPE_WINDOW_PATTERN.test(window)) continue;
    if (SEASON_SCOPE_WINDOW_PATTERN.test(window)) continue;
    if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;

    const claimed = parseNumericClaim(match[1]);
    if (!Number.isFinite(claimed)) continue;
    if (leagueCareerStats?.careerStatsVerified && claimed === leagueCareerStats.careerWins) continue;
    if (seasonStats && claimed === Number(seasonStats.winsTotal) && SEASON_SCOPE_WINDOW_PATTERN.test(window)) {
      continue;
    }

    if (!leagueCareerStats?.careerStatsVerified) {
      unsupported.push({
        type: 'unsupported-career-stat',
        message: 'Career wins require verified SimRacerHub driver stats or manual notes.',
        claim: claim.trim(),
        field: 'careerWins',
      });
    } else {
      unsupported.push({
        type: 'unsupported-career-stat',
        message: `Claimed ${claimed} career wins, but verified value is ${leagueCareerStats.careerWins}.`,
        claim: claim.trim(),
        field: 'careerWins',
        verifiedValue: leagueCareerStats.careerWins,
      });
    }
  }

  for (const rule of WORD_CAREER_WIN_PATTERNS) {
    for (const match of String(text || '').matchAll(rule.pattern)) {
      const claim = match[0];
      if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
      const claimed = rule.value;
      if (!leagueCareerStats?.careerStatsVerified) {
        unsupported.push({
          type: 'unsupported-career-stat',
          message: 'Career win claim requires verified leagueCareerStats.',
          claim: claim.trim(),
          field: 'careerWins',
        });
        continue;
      }
      if (claimed !== leagueCareerStats.careerWins) {
        unsupported.push({
          type: 'unsupported-career-stat',
          message: `Claimed ${claimed} career win(s) ("${claim.trim()}"), but verified value is ${leagueCareerStats.careerWins}.`,
          claim: claim.trim(),
          field: 'careerWins',
          verifiedValue: leagueCareerStats.careerWins,
        });
      }
    }
  }

  for (const match of String(text || '').matchAll(/\btruck series career\b/gi)) {
    if (claimSupportedInNotes(match[0], manualRaceNotes, transcriptSummary)) continue;
    unsupported.push({
      type: 'unsupported-career-scope',
      message:
        'Use Blazing Pedals career or league career language — truck-only career totals are not verified.',
      claim: match[0].trim(),
    });
  }

  return unsupported;
}

export function validateDriverSpotlightMixedScopeStats(text, context = {}) {
  const unsupported = [];
  const seen = new Set();
  const leagueCareerStats = context.leagueCareerStats || null;
  const seasonStats = context.allowedSeasonStats || null;
  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';

  if (!leagueCareerStats?.careerStatsVerified || !seasonStats) {
    return unsupported;
  }

  const statChecks = [
    {
      field: 'careerWins',
      seasonField: 'winsTotal',
      label: 'wins',
      claimPatterns: [
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+wins?\\b`, 'gi'),
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+victories?\\b`, 'gi'),
      ],
      seasonMislabelPatterns: [
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+wins?\\s+this\\s+season\\b`, 'gi'),
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+victories?\\s+this\\s+season\\b`, 'gi'),
        new RegExp(
          `\\b(${MIXED_SCOPE_WORD_NUM})\\s+wins?\\s+(?:in|during)\\s+(?:the\\s+)?current\\s+season\\b`,
          'gi'
        ),
        new RegExp(`\\bwith\\s+(${MIXED_SCOPE_WORD_NUM})\\s+wins?\\s+already\\b`, 'gi'),
        new RegExp(
          `\\b(${MIXED_SCOPE_WORD_NUM})\\s+wins?\\s+under\\s+(?:his|her|their)\\s+belt\\b`,
          'gi'
        ),
      ],
    },
    {
      field: 'careerTop5s',
      seasonField: 'top5Total',
      label: 'top-five finishes',
      claimPatterns: [
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?(?:five|5s?)\\b`, 'gi'),
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?five\\s+finishes?\\b`, 'gi'),
      ],
      seasonMislabelPatterns: [
        new RegExp(
          `\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?(?:five|5s?)[^.!?]{0,30}this\\s+season\\b`,
          'gi'
        ),
        new RegExp(
          `\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?five\\s+finishes?[^.!?]{0,30}this\\s+season\\b`,
          'gi'
        ),
      ],
    },
    {
      field: 'careerTop10s',
      seasonField: 'top10Total',
      label: 'top-ten finishes',
      claimPatterns: [
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?(?:ten|10s?)\\b`, 'gi'),
        new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?ten\\s+finishes?\\b`, 'gi'),
      ],
      seasonMislabelPatterns: [
        new RegExp(
          `\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?(?:ten|10s?)[^.!?]{0,30}this\\s+season\\b`,
          'gi'
        ),
        new RegExp(
          `\\b(${MIXED_SCOPE_WORD_NUM})\\s+top[\\s-]?ten\\s+finishes?[^.!?]{0,30}this\\s+season\\b`,
          'gi'
        ),
      ],
    },
  ];

  for (const check of statChecks) {
    const { careerValue, seasonValue } = getCareerSeasonValues(
      leagueCareerStats,
      seasonStats,
      check.field,
      check.seasonField
    );
    if (!scopesDiffer(careerValue, seasonValue)) continue;

    for (const pattern of check.seasonMislabelPatterns) {
      for (const match of String(text || '').matchAll(pattern)) {
        const claim = match[0];
        if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
        const claimed = parseWordOrNumericClaim(match[1]);
        if (!Number.isFinite(claimed)) continue;

        if (claimed === careerValue && claimed !== seasonValue) {
          pushMixedScopeError(unsupported, seen, {
            type: 'career-stat-labeled-as-season',
            message: `${claimed} ${check.label} is a league career total (${careerValue}), not a current-season total (${seasonValue}). Do not label it as "this season".`,
            claim: claim.trim(),
            field: check.field,
            verifiedCareerValue: careerValue,
            verifiedSeasonValue: seasonValue,
          });
        } else if (claimed !== seasonValue && claimed !== careerValue) {
          pushMixedScopeError(unsupported, seen, {
            type: 'unsupported-mixed-scope-season-career',
            message: `${check.label} claim "${claim.trim()}" does not match verified season (${seasonValue}) or career (${careerValue}) totals.`,
            claim: claim.trim(),
            field: check.field,
          });
        }
      }
    }

    for (const pattern of check.claimPatterns) {
      for (const match of String(text || '').matchAll(pattern)) {
        const claim = match[0];
        if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
        const idx = match.index ?? 0;
        const window = String(text || '').slice(Math.max(0, idx - 100), idx + claim.length + 100);
        const claimed = parseWordOrNumericClaim(match[1]);
        if (!Number.isFinite(claimed)) continue;

        const hasCareerLabel = CAREER_SCOPE_WINDOW_PATTERN.test(window);
        const hasSeasonLabel = SEASON_SCOPE_WINDOW_PATTERN.test(window);
        const matchesCareer = claimed === careerValue;
        const matchesSeason = claimed === seasonValue;

        if (matchesCareer && !matchesSeason && hasSeasonLabel && !hasCareerLabel) {
          pushMixedScopeError(unsupported, seen, {
            type: 'career-stat-labeled-as-season',
            message: `${claimed} ${check.label} matches league career (${careerValue}) but is labeled as current season.`,
            claim: claim.trim(),
            field: check.field,
            verifiedCareerValue: careerValue,
            verifiedSeasonValue: seasonValue,
          });
          continue;
        }

        if (matchesSeason && !matchesCareer && hasCareerLabel && !hasSeasonLabel) {
          pushMixedScopeError(unsupported, seen, {
            type: 'season-stat-labeled-as-career',
            message: `${claimed} ${check.label} matches current season (${seasonValue}) but is labeled as career.`,
            claim: claim.trim(),
            field: check.field,
            verifiedCareerValue: careerValue,
            verifiedSeasonValue: seasonValue,
          });
          continue;
        }

        if (matchesCareer && !matchesSeason && !hasCareerLabel && !hasSeasonLabel) {
          pushMixedScopeError(unsupported, seen, {
            type: 'unsupported-mixed-scope-season-career',
            message: `${claimed} ${check.label} matches league career (${careerValue}) — label as career/league/Blazing Pedals career, not an unlabeled total.`,
            claim: claim.trim(),
            field: check.field,
            verifiedCareerValue: careerValue,
            verifiedSeasonValue: seasonValue,
          });
          continue;
        }

        if (matchesSeason && !matchesCareer && !hasSeasonLabel && !hasCareerLabel) {
          pushMixedScopeError(unsupported, seen, {
            type: 'unsupported-mixed-scope-season-career',
            message: `${claimed} ${check.label} matches current season (${seasonValue}) — label as this season/current season.`,
            claim: claim.trim(),
            field: check.field,
            verifiedCareerValue: careerValue,
            verifiedSeasonValue: seasonValue,
          });
        }
      }
    }
  }

  for (const sentence of String(text || '').split(/[.!?]+/)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    const winClaims = [
      ...trimmed.matchAll(new RegExp(`\\b(${MIXED_SCOPE_WORD_NUM})\\s+wins?\\b`, 'gi')),
    ]
      .map((entry) => parseWordOrNumericClaim(entry[1]))
      .filter((value) => Number.isFinite(value));
    const uniqueWins = [...new Set(winClaims)];
    const { careerValue: careerWins, seasonValue: seasonWins } = getCareerSeasonValues(
      leagueCareerStats,
      seasonStats,
      'careerWins',
      'winsTotal'
    );
    if (
      scopesDiffer(careerWins, seasonWins) &&
      uniqueWins.length > 1 &&
      !/\bcareer\b[\s\S]{0,80}\bseason\b|\bseason\b[\s\S]{0,80}\bcareer\b/i.test(trimmed)
    ) {
      pushMixedScopeError(unsupported, seen, {
        type: 'unsupported-mixed-scope-season-career',
        message:
          'Multiple different win totals in one sentence require clear career vs current-season labels.',
        claim: trimmed,
        field: 'careerWins',
      });
    }
  }

  return unsupported;
}

const FORBIDDEN_BEST_POINTS_PATTERNS = [
  /\bcareer[- ]best points\b/gi,
  /\bhighest[- ]points season\b/gi,
  /\bbest points total\b/gi,
  /\bbest[- ]scoring season\b/gi,
  /\bmost points (?:in|across) (?:his|her|their) (?:career|league)\b/gi,
  /\bcareer[- ]high points\b/gi,
  /\bpoints[- ]wise best season\b/gi,
  /\bbest season.{0,40}points total\b/gi,
];

export function validateDriverSpotlightHistoricalSeasonStats(text, context = {}) {
  const unsupported = [];
  const seen = new Set();
  const summary =
    context.leagueCareerSummary ||
    context.careerHistory?.leagueCareerSummary ||
    null;
  const seasonStats = context.allowedSeasonStats || null;
  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';
  const currentSeasonBpNumber = Number(context.currentSeasonBpNumber);
  const currentSeasonPoints = Number(seasonStats?.pointsTotal);

  if (!summary?.careerSummaryVerified || !seasonStats) {
    return unsupported;
  }

  for (const pattern of FORBIDDEN_BEST_POINTS_PATTERNS) {
    for (const match of String(text || '').matchAll(pattern)) {
      if (claimSupportedInNotes(match[0], manualRaceNotes, transcriptSummary)) continue;
      pushMixedScopeError(unsupported, seen, {
        type: 'unsupported-best-points-claim',
        message:
          'Do not describe historical seasons using points totals — use finishing position and season name instead.',
        claim: match[0].trim(),
        field: 'historicalSeasonPoints',
      });
    }
  }

  const validateHistoricalSeasonPoints = (seasonNum, claimedPoints, claim) => {
    if (!Number.isFinite(seasonNum) || !Number.isFinite(claimedPoints)) return;
    if (Number.isFinite(currentSeasonBpNumber) && seasonNum === currentSeasonBpNumber) {
      if (claimedPoints === currentSeasonPoints) return;
      pushMixedScopeError(unsupported, seen, {
        type: 'historical-season-points-mismatch',
        message: `Claimed ${claimedPoints} points for current Season ${seasonNum}, but verified current-season total is ${currentSeasonPoints}.`,
        claim: claim.trim(),
        field: 'seasonPoints',
        seasonNumber: seasonNum,
      });
      return;
    }

    const season = lookupParticipatedSeason(summary, seasonNum);
    if (!season) return;

    const verifiedPoints = Number(season.points);
    if (claimedPoints === verifiedPoints) return;

    if (claimedPoints === currentSeasonPoints) {
      pushMixedScopeError(unsupported, seen, {
        type: 'historical-season-points-mismatch',
        message: `Season ${seasonNum} is cited with ${claimedPoints} points, but that is the current-season total — Season ${seasonNum} verified total is ${verifiedPoints}. Use position (P${season.position}) instead.`,
        claim: claim.trim(),
        field: 'historicalSeasonPoints',
        seasonNumber: seasonNum,
        verifiedSeasonPoints: verifiedPoints,
        verifiedCurrentSeasonPoints: currentSeasonPoints,
      });
      return;
    }

    pushMixedScopeError(unsupported, seen, {
      type: 'historical-season-points-mismatch',
      message: `Claimed ${claimedPoints} points for Season ${seasonNum}, but verified total for that season is ${verifiedPoints}.`,
      claim: claim.trim(),
      field: 'historicalSeasonPoints',
      seasonNumber: seasonNum,
      verifiedSeasonPoints: verifiedPoints,
    });
  };

  for (const match of String(text || '').matchAll(
    /\bseason\s*#?\s*(\d+)\s+runner[- ]up\s+with\s+(\d[\d,]*)\s+points?\b/gi
  )) {
    if (claimSupportedInNotes(match[0], manualRaceNotes, transcriptSummary)) continue;
    validateHistoricalSeasonPoints(
      Number(match[1]),
      parseNumericClaim(match[2]),
      match[0]
    );
  }

  for (const match of String(text || '').matchAll(
    /\bseason\s*#?\s*(\d+)\b[^.!?]{0,140}\b(\d[\d,]*)\s+points?\b/gi
  )) {
    if (claimSupportedInNotes(match[0], manualRaceNotes, transcriptSummary)) continue;
    validateHistoricalSeasonPoints(
      Number(match[1]),
      parseNumericClaim(match[2]),
      match[0]
    );
  }

  for (const match of String(text || '').matchAll(
    /\b(\d[\d,]*)\s+points?\b[^.!?]{0,140}\bseason\s*#?\s*(\d+)\b/gi
  )) {
    if (claimSupportedInNotes(match[0], manualRaceNotes, transcriptSummary)) continue;
    validateHistoricalSeasonPoints(
      Number(match[2]),
      parseNumericClaim(match[1]),
      match[0]
    );
  }

  for (const match of String(text || '').matchAll(
    /\bseason\s*#?\s*(\d+)\b[^.!?]{0,100}\bseason\s*#?\s*(\d+)\b/gi
  )) {
    const window = match[0];
    if (!/\bpoints?\b/i.test(window)) continue;
    if (claimSupportedInNotes(window, manualRaceNotes, transcriptSummary)) continue;
    if (Number(match[1]) === Number(match[2])) continue;
    pushMixedScopeError(unsupported, seen, {
      type: 'cross-season-points-comparison',
      message:
        'Cross-season point comparisons are invalid — cite championship finishing positions per season instead.',
      claim: window.trim(),
      field: 'historicalSeasonPoints',
    });
  }

  return unsupported;
}

function seasonNumberFromClaim(text) {
  const match = String(text || '').match(/\bseason\s*#?\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function seasonSummaryIncludes(summary, predicate) {
  if (!summary?.careerSummaryVerified) return false;
  const lists = [
    summary.championshipSeasons,
    summary.runnerUpSeasons,
    summary.top3SeasonFinishes,
    summary.participatedSeasons,
  ];
  return lists.some((list) => Array.isArray(list) && list.some(predicate));
}

export function validateInProgressSeasonCompletedWording(text, context = {}) {
  const unsupported = [];
  const summary =
    context.leagueCareerSummary ||
    context.careerHistory?.leagueCareerSummary ||
    null;
  const wording = summary?.seasonWording;
  if (!wording?.forbidCompletedSeasonWordingForCurrentSeason) {
    return unsupported;
  }

  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';
  const currentBp =
    summary.currentSeasonBpNumber ??
    (Number.isFinite(context.currentSeasonBpNumber) ? context.currentSeasonBpNumber : null);
  const currentLabel = summary.currentSeasonStanding?.label || null;
  const pastTenseFinish =
    /\b(?:finished|placed|ended the season|where he (?:finished|placed)|finished overall|placed overall)\b/i;

  const pushError = (claim, message) => {
    unsupported.push({
      type: 'inprogress-season-completed-wording',
      message,
      claim: String(claim || '').trim(),
      field: 'seasonWording',
    });
  };

  for (const match of String(text || '').matchAll(
    /\b(?:best|career-best|career best|highest championship).{0,100}\bcame in\b/gi
  )) {
    const window = String(text || '').slice(match.index, (match.index ?? 0) + 140);
    if (claimSupportedInNotes(window, manualRaceNotes, transcriptSummary)) continue;
    const seasonNum = seasonNumberFromClaim(window);
    const referencesCurrent =
      (Number.isFinite(currentBp) && seasonNum === currentBp) ||
      (currentLabel && window.toLowerCase().includes(currentLabel.toLowerCase())) ||
      wording.bestOverallIsCurrentSeasonInProgress;
    if (referencesCurrent) {
      pushError(
        window,
        'Do not describe the in-progress current season as a completed best season. Use present-tense career-campaign wording from seasonWording.suggestedPhrasing.'
      );
    }
  }

  for (const match of String(text || '').matchAll(/\bseason\s*#?\s*(\d+)\b/gi)) {
    const seasonNum = Number(match[1]);
    if (!Number.isFinite(currentBp) || seasonNum !== currentBp) continue;
    const window = String(text || '').slice(
      Math.max(0, (match.index ?? 0) - 100),
      (match.index ?? 0) + 100
    );
    if (claimSupportedInNotes(window, manualRaceNotes, transcriptSummary)) continue;
    if (pastTenseFinish.test(window)) {
      pushError(
        window,
        `Season ${seasonNum} is in progress — do not use past-tense championship finish wording (finished, placed, ended the season).`
      );
    }
    if (/\bbest season finish came\b/i.test(window)) {
      pushError(
        window,
        `Season ${seasonNum} is in progress — do not claim a completed "best season finish" for the current season.`
      );
    }
  }

  if (
    wording.bestOverallIsCurrentSeasonInProgress &&
    /\bbest season finish came\b/i.test(String(text || ''))
  ) {
    const claim = String(text || '').match(/\bbest season finish came[\s\S]{0,120}/i)?.[0];
    if (claim && !claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) {
      pushError(
        claim,
        'When the current in-progress season is his best position so far, use present-tense campaign wording — not "best season finish came in".'
      );
    }
  }

  return unsupported;
}

export function validateDriverSpotlightCareerSummary(text, context = {}) {
  const unsupported = [];
  const summary =
    context.leagueCareerSummary ||
    context.careerHistory?.leagueCareerSummary ||
    context.truckSeriesCareerHistory?.leagueCareerSummary ||
    null;
  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';

  for (const match of String(text || '').matchAll(/\b(\d+)[-\s]time\s+champion\b/gi)) {
    const claim = match[0];
    if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
    const claimed = Number(match[1]);
    if (!summary?.careerSummaryVerified || summary.championships == null) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'Championship count requires verified leagueCareerSummary.',
        claim: claim.trim(),
        field: 'championships',
      });
      continue;
    }
    if (claimed !== summary.championships) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: `Claimed ${claimed} championships, but verified count is ${summary.championships}.`,
        claim: claim.trim(),
        field: 'championships',
        verifiedValue: summary.championships,
      });
    }
  }

  for (const match of String(text || '').matchAll(
    /\b(?:won|winning|claimed|captured)\s+(?:the\s+)?championship\b|\bchampionship\s+winner\b|\bchampion\s+in\s+season\b/gi
  )) {
    const claim = match[0];
    if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
    const seasonNum = seasonNumberFromClaim(
      String(text || '').slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + claim.length + 40)
    );
    if (!summary?.careerSummaryVerified) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'Championship claim requires verified leagueCareerSummary.',
        claim: claim.trim(),
        field: 'championships',
      });
      continue;
    }
    if ((summary.championships || 0) < 1) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'No verified championships in leagueCareerSummary.',
        claim: claim.trim(),
        field: 'championships',
      });
      continue;
    }
    if (
      seasonNum != null &&
      !seasonSummaryIncludes(summary, (season) => season.bpSeasonNumber === seasonNum && season.position === 1)
    ) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: `Season ${seasonNum} championship is not verified in leagueCareerSummary.`,
        claim: claim.trim(),
        field: 'championshipSeasons',
      });
    }
  }

  for (const match of String(text || '').matchAll(
    /\brunner[- ]up\b|\bfinished\s+(?:second|2nd)\b|\bsecond[- ]place\s+finish\b/gi
  )) {
    const claim = match[0];
    if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
    const window = String(text || '').slice(
      Math.max(0, (match.index ?? 0) - 50),
      (match.index ?? 0) + claim.length + 50
    );
    if (!/\bseason\b|\bchampionship\b|\bstandings\b|\bpoints\b/i.test(window)) continue;
    if (!summary?.careerSummaryVerified) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'Runner-up claim requires verified leagueCareerSummary.',
        claim: claim.trim(),
        field: 'runnerUpSeasons',
      });
      continue;
    }
    if (!summary.runnerUpSeasons?.length) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'No verified runner-up seasons in leagueCareerSummary.',
        claim: claim.trim(),
        field: 'runnerUpSeasons',
      });
    }
  }

  for (const match of String(text || '').matchAll(
    /\bbest\s+(?:championship\s+)?finish(?:ing)?\s+(?:of\s+)?P?(\d+)(?:st|nd|rd|th)?\b/gi
  )) {
    const claim = match[0];
    if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
    const claimed = Number(match[1]);
    if (!summary?.careerSummaryVerified || summary.bestSeasonFinish == null) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'Best season finish requires verified leagueCareerSummary.',
        claim: claim.trim(),
        field: 'bestSeasonFinish',
      });
      continue;
    }
    if (claimed !== summary.bestSeasonFinish) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: `Claimed best finish P${claimed}, but verified value is P${summary.bestSeasonFinish}.`,
        claim: claim.trim(),
        field: 'bestSeasonFinish',
        verifiedValue: summary.bestSeasonFinish,
      });
    }
  }

  for (const match of String(text || '').matchAll(
    /\btop[- ]three\b.*\b(?:championship|standings|finish)\b|\b(?:finished|finish(?:ed|ing)?)\s+(?:third|3rd)\b/gi
  )) {
    const claim = match[0];
    if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) continue;
    if (!/\bseason\b|\bchampionship\b|\bstandings\b/i.test(claim)) continue;
    if (!summary?.careerSummaryVerified) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'Top-three championship claim requires verified leagueCareerSummary.',
        claim: claim.trim(),
        field: 'top3SeasonFinishes',
      });
      continue;
    }
    if (!summary.top3SeasonFinishes?.length) {
      unsupported.push({
        type: 'unsupported-career-summary',
        message: 'No verified top-three championship finishes in leagueCareerSummary.',
        claim: claim.trim(),
        field: 'top3SeasonFinishes',
      });
    }
  }

  return unsupported;
}

function claimAllowedByCareerHistory(scope, claim, careerHistory, manualRaceNotes, transcriptSummary) {
  if (claimSupportedInNotes(claim, manualRaceNotes, transcriptSummary)) return true;
  if (!careerHistory?.tenureClaimsAllowed) return false;

  if (scope === 'rookie') {
    return careerHistory.isFirstTruckSeason === true || careerHistory.isFirstSeasonInScope === true;
  }
  if (scope === 'veteran') {
    return careerHistory.isTruckSeriesVeteran === true || careerHistory.isVeteranInScope === true;
  }
  if (scope === 'returning') {
    return careerHistory.isReturningInScope === true;
  }

  return false;
}

export function validateCareerTenureClaims(text, context = {}) {
  const unsupported = [];
  const careerHistory =
    context.truckSeriesCareerHistory ||
    context.careerHistory?.truckSeriesCareerHistory ||
    context.careerHistory ||
    null;
  const manualRaceNotes = context.manualRaceNotes || '';
  const transcriptSummary = context.transcriptSummary || '';

  for (const rule of CAREER_TENURE_VALIDATION_RULES) {
    for (const match of String(text || '').matchAll(rule.pattern)) {
      const claim = match[0];
      if (
        claimAllowedByCareerHistory(
          rule.scope,
          claim,
          careerHistory,
          manualRaceNotes,
          transcriptSummary
        )
      ) {
        continue;
      }

      unsupported.push({
        type: rule.type,
        message: rule.message,
        claim: claim.trim(),
      });
    }
  }

  return unsupported;
}

export const DRIVER_SPOTLIGHT_FIELD_VALIDATORS = [
  validateCareerTenureClaims,
  validateDriverSpotlightCareerStats,
  validateInProgressSeasonCompletedWording,
  validateDriverSpotlightCareerSummary,
  validateDriverSpotlightMixedScopeStats,
  validateDriverSpotlightHistoricalSeasonStats,
  validateDriverSpotlightStyleClaims,
];

export function validateDriverSpotlightField(text, context = {}) {
  const seen = new Set();
  const errors = [];
  for (const validator of DRIVER_SPOTLIGHT_FIELD_VALIDATORS) {
    for (const err of validator(text, context)) {
      const key = `${err.type}|${err.field || ''}|${err.claim || err.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(err);
    }
  }
  return errors;
}
