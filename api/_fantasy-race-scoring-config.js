export const FANTASY_RACE_SCORING_VERSION = 'fantasy-race-v1-default';

export const DEFAULT_FANTASY_RACE_SCORING_CONFIG = {
  version: FANTASY_RACE_SCORING_VERSION,
  label: 'NASCAR-style default (admin-configurable)',
  description:
    'Default finish and bonus scoring for BP Fantasy race weeks. Admins can override via site settings before finalizing.',
  finishPoints: {
    1: 40,
    2: 35,
    3: 34,
  },
  finishDecayAfterThird: 1,
  bonuses: {
    win: 5,
    top5: 3,
    top10: 1,
    positionGainedPer: 0.5,
    positionLostPer: 0,
  },
  penalties: {
    incidentPer: 0,
    enabled: false,
  },
  dnsPoints: 0,
  dnpPoints: 0,
  dnfUsesFinishPoints: true,
  tieRanking: 'competition',
};

export function resolveFantasyRaceScoringConfig(settings = {}) {
  const stored = settings.fantasyRaceScoringConfig || settings.fantasy_race_scoring_config || {};
  return {
    ...DEFAULT_FANTASY_RACE_SCORING_CONFIG,
    ...(typeof stored === 'object' && stored ? stored : {}),
    bonuses: {
      ...DEFAULT_FANTASY_RACE_SCORING_CONFIG.bonuses,
      ...(stored?.bonuses || {}),
    },
    penalties: {
      ...DEFAULT_FANTASY_RACE_SCORING_CONFIG.penalties,
      ...(stored?.penalties || {}),
    },
    finishPoints: {
      ...DEFAULT_FANTASY_RACE_SCORING_CONFIG.finishPoints,
      ...(stored?.finishPoints || {}),
    },
  };
}

export function finishPositionPoints(position, config = DEFAULT_FANTASY_RACE_SCORING_CONFIG) {
  const pos = Number(position);
  if (!Number.isFinite(pos) || pos < 1) return Number(config.dnsPoints ?? 0);

  if (config.finishPoints?.[pos] != null) {
    return Number(config.finishPoints[pos]);
  }
  if (pos === 1) return 40;
  if (pos === 2) return 35;
  if (pos >= 3) {
    const decay = Number(config.finishDecayAfterThird ?? 1);
    return Math.max(0, 34 - (pos - 3) * decay);
  }
  return 0;
}
