import { fetchHtml } from './_lib.js';

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

  const totals = participated.reduce(
    (acc, season) => {
      acc.totalCareerStarts += season.starts;
      acc.careerWins += season.wins;
      acc.careerTop5s += season.top5s;
      acc.careerTop10s += season.top10s;
      return acc;
    },
    { totalCareerStarts: 0, careerWins: 0, careerTop5s: 0, careerTop10s: 0 }
  );

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
    reason: classificationReliable
      ? null
      : 'Season classification was not reliable enough for automated career-tenure claims.',
  };
}

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
}) {
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

  const careerHistory = {
    ...truckSeriesCareerHistory,
    truckSeriesCareerHistory,
    overallLeagueCareerHistory,
    currentSeasonOnly,
    forbiddenWithoutVerification: CAREER_TENURE_FORBIDDEN_WITHOUT_VERIFICATION,
    manualTenureNotes: manualTenure.claims,
    reason: truckSeriesCareerHistory.reason || seasonCatalog?.auditNotes || null,
  };

  return careerHistory;
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
