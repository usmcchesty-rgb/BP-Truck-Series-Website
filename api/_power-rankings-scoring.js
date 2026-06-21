import { DEFAULTS } from './_lib.js';
import {
  extractFinishRacesFromSchedules,
  extractOfficialRaceFinishes,
  normalizeDriverRaceResult,
  sampleResultFromBucket,
  summarizeLast3RaceWindow,
} from './_simracerhub-schedule-results.js';

const WEIGHTS = {
  recentForm: 0.4,
  seasonPerformance: 0.25,
  raceImpact: 0.15,
  championship: 0.1,
  momentum: 0.1,
};

export const SEASON_RAW_TARGET_MAX = 175;

const DNF_FINISH_THRESHOLD = 35;
const PLAYOFF_CUT_DEFAULT = DEFAULTS.playoffCut || 16;

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function invertFinishScore(finish, fieldSize = 30) {
  const f = Number(finish);
  if (!Number.isFinite(f) || f < 1) return 0;
  const size = Math.max(fieldSize, f, 20);
  return clamp(((size - f + 1) / size) * 100);
}

function isDnfFinish(finish) {
  const f = Number(finish);
  return Number.isFinite(f) && f >= DNF_FINISH_THRESHOLD;
}

function computeSeasonFinishesFromSchedules(driverId, schedules) {
  const finishes = [];
  for (const schedule of Object.values(schedules || {})) {
    const { driverResults } = extractOfficialRaceFinishes(schedule);
    const result = driverResults[String(driverId)];
    if (result?.finish) finishes.push(result.finish);
  }
  if (!finishes.length) {
    return { avgFinish: null, bestFinish: null, raceCount: 0 };
  }
  const total = finishes.reduce((sum, value) => sum + value, 0);
  return {
    avgFinish: Number((total / finishes.length).toFixed(1)),
    bestFinish: Math.min(...finishes),
    raceCount: finishes.length,
  };
}

function extractSegmentFinishesForDriver(schedule, driverId) {
  if (!schedule?.drivers) return [];

  const segmentBuckets = [];
  for (const [, bucket] of Object.entries(schedule.drivers)) {
    const sample = sampleResultFromBucket(bucket);
    if (!sample) continue;
    if (String(sample.session || '').toUpperCase() !== 'SEGMENT') continue;
    segmentBuckets.push({
      sessionNum: Number(sample.session_num ?? 0),
      bucket,
    });
  }

  segmentBuckets.sort((a, b) => a.sessionNum - b.sessionNum);

  return segmentBuckets
    .map((entry, index) => {
      const normalized = normalizeDriverRaceResult(entry.bucket[String(driverId)]);
      if (!normalized?.finish) return null;
      return { stage: index + 1, finish: normalized.finish };
    })
    .filter(Boolean);
}

function findScheduleEntryByScheduleId(schedules, scheduleId) {
  if (!scheduleId) return null;
  for (const schedule of Object.values(schedules || {})) {
    if (String(schedule.schedule_id) === String(scheduleId)) return schedule;
  }
  return null;
}

function buildRecentFormComponent(grounding, alignedRaces, driverId) {
  const recentFinishes = (grounding?.recentRaceFinishes || [])
    .map((race) => Number(race.finish))
    .filter((finish) => Number.isFinite(finish) && finish >= 1);

  const last3Summary = summarizeLast3RaceWindow(
    grounding?.recentRaceFinishes || [],
    alignedRaces,
    driverId
  );

  let score = 0;
  const details = {
    last3Finishes: recentFinishes,
    last3RaceAverageFinish: last3Summary.last3RaceAverageFinish,
    last3RaceStarts: last3Summary.last3RaceStarts,
    last3RaceDnpCount: last3Summary.last3RaceDnpCount,
    recentWins: 0,
    recentTop5s: 0,
    recentTop10s: 0,
    dnpPenalty: 0,
    dnfPenalty: 0,
  };

  if (last3Summary.last3RaceAverageFinish != null) {
    score += invertFinishScore(last3Summary.last3RaceAverageFinish) * 0.45;
  } else if (recentFinishes.length) {
    const avg =
      recentFinishes.reduce((sum, finish) => sum + finish, 0) / recentFinishes.length;
    score += invertFinishScore(avg) * 0.45;
  }

  for (const finish of recentFinishes) {
    if (finish === 1) {
      details.recentWins += 1;
      score += 18;
    } else if (finish <= 5) {
      details.recentTop5s += 1;
      score += 8;
    } else if (finish <= 10) {
      details.recentTop10s += 1;
      score += 4;
    }
    if (isDnfFinish(finish)) {
      details.dnfPenalty += 12;
      score -= 12;
    }
  }

  if (last3Summary.last3RaceDnpCount > 0) {
    details.dnpPenalty = last3Summary.last3RaceDnpCount * 15;
    score -= details.dnpPenalty;
  }

  if (grounding?.bestFinishLast3 === 1 && details.recentWins >= 1) {
    score += 6;
  }

  return { score: clamp(score), details };
}

function buildSeasonComponent(standingsRow, schedules, driverId) {
  const explained = explainSeasonPerformanceScore(standingsRow, schedules, driverId);
  return {
    score: explained.seasonNormalizedScore,
    details: explained.details,
    diagnostics: {
      seasonRawTotal: explained.seasonRawTotal,
      seasonRawTargetMax: explained.seasonRawTargetMax,
      seasonNormalizedScore: explained.seasonNormalizedScore,
      seasonWasCapped: explained.seasonWasCapped,
      oldClampScoreForComparison: explained.oldClampScoreForComparison,
      components: explained.components,
    },
  };
}

export function explainSeasonPerformanceScore(standingsRow, schedules, driverId) {
  const position = Number(standingsRow?.position);
  const wins = Number(standingsRow?.wins) || 0;
  const top5 = Number(standingsRow?.top5) || 0;
  const top10 = Number(standingsRow?.top10) || 0;
  const races = Number(standingsRow?.races) || 0;

  const seasonFinishes = computeSeasonFinishesFromSchedules(driverId, schedules);
  const details = {
    pointsPosition: Number.isFinite(position) ? position : null,
    wins,
    top5,
    top10,
    races,
    avgFinish: seasonFinishes.avgFinish,
    bestFinish: seasonFinishes.bestFinish,
  };

  const positionPoints = Number.isFinite(position) && position >= 1
    ? clamp((21 - Math.min(position, 20)) * 4.5)
    : 0;
  const winPoints = Math.min(wins, 5) * 6;
  const top5Points = Math.min(top5, 12) * 2.2;
  const top10Points = Math.min(top10, 20) * 0.9;
  const avgFinishPoints =
    seasonFinishes.avgFinish != null
      ? invertFinishScore(seasonFinishes.avgFinish) * 0.22
      : 0;
  const bestFinishPoints =
    seasonFinishes.bestFinish != null
      ? invertFinishScore(seasonFinishes.bestFinish) * 0.12
      : 0;

  const components = {
    positionPoints,
    winPoints,
    top5Points,
    top10Points,
    avgFinishPoints: Number(avgFinishPoints.toFixed(4)),
    bestFinishPoints: Number(bestFinishPoints.toFixed(4)),
  };

  const rawTotal = Number(
    (
      positionPoints +
      winPoints +
      top5Points +
      top10Points +
      avgFinishPoints +
      bestFinishPoints
    ).toFixed(4)
  );

  const oldClampScoreForComparison = clamp(rawTotal);
  const seasonNormalizedScore = clamp((rawTotal / SEASON_RAW_TARGET_MAX) * 100);
  const seasonWasCapped = rawTotal / SEASON_RAW_TARGET_MAX > 1;

  return {
    seasonRawTotal: rawTotal,
    rawTotal,
    seasonRawTargetMax: SEASON_RAW_TARGET_MAX,
    seasonNormalizedScore: Number(seasonNormalizedScore.toFixed(2)),
    seasonWasCapped,
    oldClampScoreForComparison,
    cappedScore: Number(seasonNormalizedScore.toFixed(2)),
    wasCapped: seasonWasCapped,
    components,
    details,
  };
}

function buildRaceImpactComponent(latestRace, schedules, driverId) {
  const details = {
    latestRaceNumber: latestRace?.pointsRaceNumber ?? null,
    track: latestRace?.track ?? null,
    finish: null,
    startingPos: null,
    positionsGained: null,
    lapsLed: null,
    stageFinishes: [],
    missedLatestRace: false,
    dnf: false,
  };

  if (!latestRace) {
    return { score: 40, details };
  }

  const scheduleEntry = findScheduleEntryByScheduleId(
    schedules,
    latestRace.schedulesApiScheduleId
  );
  const driverResults = scheduleEntry
    ? extractOfficialRaceFinishes(scheduleEntry).driverResults
    : {};
  const raceResult =
    driverResults[String(driverId)] ||
    (latestRace.finishes?.[String(driverId)]
      ? { finish: latestRace.finishes[String(driverId)] }
      : null);

  const finish = Number(raceResult?.finish ?? latestRace.finishes?.[String(driverId)]);
  if (!Number.isFinite(finish) || finish < 1) {
    details.missedLatestRace = true;
    return { score: 5, details };
  }

  details.finish = finish;
  details.dnf = isDnfFinish(finish);
  details.startingPos = raceResult?.startingPos ?? null;
  details.lapsLed = raceResult?.lapsLed ?? null;

  if (details.startingPos != null) {
    details.positionsGained = details.startingPos - finish;
  }

  if (scheduleEntry) {
    details.stageFinishes = extractSegmentFinishesForDriver(scheduleEntry, driverId);
  }

  let score = invertFinishScore(finish) * 0.55;

  if (details.positionsGained != null && details.positionsGained > 0) {
    score += Math.min(details.positionsGained, 15) * 1.8;
  } else if (details.positionsGained != null && details.positionsGained < -5) {
    score -= Math.min(Math.abs(details.positionsGained), 12) * 1.2;
  }

  if (details.lapsLed != null && details.lapsLed > 0) {
    score += Math.min(details.lapsLed, 40) * 0.35;
  }

  for (const stage of details.stageFinishes) {
    if (stage.finish <= 5) score += 4;
    if (stage.finish <= 3) score += 3;
    if (stage.finish === 1) score += 5;
  }

  if (details.dnf) score -= 25;

  return { score: clamp(score), details };
}

function buildChampionshipComponent(standingsRow, playoffCut = PLAYOFF_CUT_DEFAULT) {
  const position = Number(standingsRow?.position);
  const details = {
    pointsPosition: Number.isFinite(position) ? position : null,
    playoffCut,
    playoffRelevant: false,
    cutlineBonus: 0,
  };

  if (!Number.isFinite(position) || position < 1) {
    return { score: 0, details };
  }

  let score = clamp((21 - Math.min(position, 20)) * 4.8);

  if (position <= playoffCut) {
    details.playoffRelevant = true;
    details.cutlineBonus = 6;
    score += 6;
  } else if (position <= playoffCut + 3) {
    details.playoffRelevant = true;
    details.cutlineBonus = 3;
    score += 3;
  }

  return { score: clamp(score), details };
}

function buildMomentumComponent(previousRank) {
  const rank = Number(previousRank);
  const details = {
    previousRank: Number.isFinite(rank) && rank >= 1 ? rank : null,
    retentionBonus: 0,
  };

  if (!Number.isFinite(rank) || rank < 1) {
    return { score: 0, details };
  }

  if (rank === 1) details.retentionBonus = 22;
  else if (rank <= 3) details.retentionBonus = 18;
  else if (rank <= 5) details.retentionBonus = 12;
  else if (rank <= 10) details.retentionBonus = 7;

  return { score: clamp(details.retentionBonus * 4.5), details };
}

function buildDropEvaluation(previousRank, raceImpact, recentForm) {
  const latestFinish = raceImpact.details.finish;
  const missedLatest = raceImpact.details.missedLatestRace === true;
  const dnf = raceImpact.details.dnf === true;
  const last3Avg = recentForm.details.last3RaceAverageFinish;
  const reasons = [];

  if (missedLatest) reasons.push('missed latest race');
  if (dnf) reasons.push('DNF in latest race');
  if (Number.isFinite(latestFinish) && latestFinish > 20) {
    reasons.push(`finished P${latestFinish} (outside top 20)`);
  }
  if (last3Avg != null && last3Avg >= 18) {
    reasons.push(`last-3 average finish ${last3Avg} is weak`);
  }
  if (recentForm.details.dnpPenalty >= 15) {
    reasons.push('missed race(s) in last-3 window');
  }

  const rank = Number(previousRank);
  if (!Number.isFinite(rank) || rank < 1) {
    return { canDrop: true, reasons: ['not in previous Top 10'], tier: null };
  }

  if (rank <= 3) {
    const canDrop = reasons.length > 0;
    return {
      canDrop,
      reasons: canDrop ? reasons : [],
      tier: 'top3',
      protected: !canDrop,
    };
  }

  if (rank <= 5) {
    const strongNegative =
      missedLatest ||
      dnf ||
      (Number.isFinite(latestFinish) && latestFinish > 15) ||
      (last3Avg != null && last3Avg >= 15) ||
      recentForm.details.dnfPenalty > 0;
    return {
      canDrop: strongNegative,
      reasons: strongNegative ? reasons : [],
      tier: 'top5',
      protected: !strongNegative,
    };
  }

  if (rank <= 10) {
    return { canDrop: true, reasons: [], tier: 'top10', protected: false };
  }

  return { canDrop: true, reasons: [], tier: null, protected: false };
}

export function scorePowerRankingCandidate({
  driverId,
  standingsRow,
  grounding,
  alignedRaces,
  schedules,
  previousRank,
}) {
  const latestRace = alignedRaces?.[alignedRaces.length - 1] || null;

  const recentForm = buildRecentFormComponent(grounding, alignedRaces, driverId);
  const season = buildSeasonComponent(standingsRow, schedules, driverId);
  const raceImpact = buildRaceImpactComponent(latestRace, schedules, driverId);
  const championship = buildChampionshipComponent(standingsRow);
  const momentum = buildMomentumComponent(previousRank);

  const scoreBreakdown = {
    recentForm: Number(recentForm.score.toFixed(2)),
    seasonPerformance: Number(season.score.toFixed(2)),
    raceImpact: Number(raceImpact.score.toFixed(2)),
    championship: Number(championship.score.toFixed(2)),
    momentum: Number(momentum.score.toFixed(2)),
  };

  const powerScore = Number(
    (
      scoreBreakdown.recentForm * WEIGHTS.recentForm +
      scoreBreakdown.seasonPerformance * WEIGHTS.seasonPerformance +
      scoreBreakdown.raceImpact * WEIGHTS.raceImpact +
      scoreBreakdown.championship * WEIGHTS.championship +
      scoreBreakdown.momentum * WEIGHTS.momentum
    ).toFixed(2)
  );

  const dropEval = buildDropEvaluation(previousRank, raceImpact, recentForm);

  return {
    driverId: String(driverId),
    driverName: standingsRow?.driverName || grounding?.driverName || '',
    carNumber: standingsRow?.carNumber || '',
    powerScore,
    scoreBreakdown,
    previousRank: Number.isFinite(Number(previousRank)) ? Number(previousRank) : null,
    retentionBonus: momentum.details.retentionBonus,
    dropProtectionApplied: false,
    dropProtectionTier: dropEval.tier,
    canDropOut: dropEval.canDrop,
    dropReasons: dropEval.reasons,
    protectedFromDropout: dropEval.protected === true,
    componentDetails: {
      recentForm: recentForm.details,
      season: {
        ...season.details,
        ...season.diagnostics,
      },
      raceImpact: raceImpact.details,
      championship: championship.details,
      momentum: momentum.details,
    },
  };
}

function applyDropProtection(sortedCandidates, previousRankByDriver) {
  const selected = sortedCandidates.slice(0, 10).map((row) => ({ ...row }));
  let selectedIds = new Set(selected.map((row) => row.driverId));

  const protectedDrivers = sortedCandidates.filter((row) => {
    const prev = previousRankByDriver[row.driverId];
    if (!Number.isFinite(prev) || prev < 1 || prev > 10) return false;
    return row.protectedFromDropout && !selectedIds.has(row.driverId);
  });

  const droppedFromPreviousTop10 = [];

  for (const protectedRow of protectedDrivers) {
    if (selectedIds.has(protectedRow.driverId)) continue;

    const replaceableIndex = [...selected]
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          !row.protectedFromDropout &&
          !(Number(previousRankByDriver[row.driverId]) <= 10)
      )
      .sort((a, b) => a.row.powerScore - b.row.powerScore)[0]?.index;

    if (replaceableIndex == null) continue;

    const replaced = selected[replaceableIndex];
    selected[replaceableIndex] = {
      ...protectedRow,
      dropProtectionApplied: true,
      dropReasons: [],
    };
    selectedIds = new Set(selected.map((row) => row.driverId));

    droppedFromPreviousTop10.push({
      driverId: replaced.driverId,
      driverName: replaced.driverName,
      previousRank: previousRankByDriver[replaced.driverId] ?? null,
      powerScore: replaced.powerScore,
      replacedByProtection: true,
      replacedFor: protectedRow.driverId,
    });
  }

  for (const [driverId, prevRank] of Object.entries(previousRankByDriver)) {
    if (!Number.isFinite(prevRank) || prevRank < 1 || prevRank > 10) continue;
    if (selectedIds.has(String(driverId))) continue;
    const row = sortedCandidates.find((candidate) => candidate.driverId === String(driverId));
    if (
      droppedFromPreviousTop10.some(
        (entry) => entry.driverId === String(driverId) || entry.replacedFor === String(driverId)
      )
    ) {
      continue;
    }
    droppedFromPreviousTop10.push({
      driverId: String(driverId),
      driverName: row?.driverName || driverId,
      previousRank: prevRank,
      powerScore: row?.powerScore ?? null,
      canDropOut: row?.canDropOut ?? true,
      dropReasons: row?.dropReasons || [],
      protectedFromDropout: row?.protectedFromDropout === true,
    });
  }

  selected.sort((a, b) => b.powerScore - a.powerScore);

  return {
    top10: selected.map((row, index) => ({
      ...row,
      rank: index + 1,
    })),
    droppedFromPreviousTop10,
  };
}

function selectHonorableMentions(scoredCandidates, top10Ids, recentFormAnalysis, limit = 3) {
  const hotIds = new Set(
    [
      ...(recentFormAnalysis?.backToBackWinners || []),
      ...(recentFormAnalysis?.backToBackPodiumDrivers || []),
      ...(recentFormAnalysis?.last2RaceWinners || []),
      ...(recentFormAnalysis?.multipleTop5Last3Drivers || []),
    ]
      .map((driver) => String(driver?.driverId || ''))
      .filter(Boolean)
  );

  const remaining = scoredCandidates.filter((row) => !top10Ids.has(row.driverId));
  const hot = remaining.filter((row) => hotIds.has(row.driverId));
  const pool = hot.length ? hot : remaining;
  return pool.slice(0, limit);
}

export function buildPowerRankingSelection({
  standings,
  factualGrounding,
  alignedRaces,
  schedules,
  previousRankByDriver = {},
  recentFormAnalysis,
}) {
  const candidates = standings
    .filter((row) => Number(row.position) >= 1)
    .map((row) => {
      const driverId = String(row.driverId);
      const grounding = factualGrounding?.drivers?.[driverId];
      return scorePowerRankingCandidate({
        driverId,
        standingsRow: row,
        grounding,
        alignedRaces,
        schedules,
        previousRank: previousRankByDriver[driverId],
      });
    })
    .sort((a, b) => b.powerScore - a.powerScore);

  const { top10, droppedFromPreviousTop10 } = applyDropProtection(
    candidates,
    previousRankByDriver
  );

  const top10Ids = new Set(top10.map((row) => row.driverId));
  const honorableMentionCandidates = selectHonorableMentions(
    candidates,
    top10Ids,
    recentFormAnalysis
  );

  return {
    selectionMode: 'calculated-power-score',
    weights: { ...WEIGHTS },
    candidates,
    top10,
    honorableMentionCandidates,
    droppedFromPreviousTop10,
  };
}

export { WEIGHTS as POWER_SCORE_WEIGHTS };

export {
  buildRecentFormComponent,
  buildRaceImpactComponent,
  buildMomentumComponent,
  clamp as clampScore,
  invertFinishScore,
  isDnfFinish,
};
