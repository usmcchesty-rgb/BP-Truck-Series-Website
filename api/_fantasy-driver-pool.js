import { fetchHtml, getDriverProfiles, getSettings, slugify, supabase } from './_lib.js';
import { parseScheduleRacesFromHtml } from './_caution-stats.js';
import {
  buildRaceNumberDebug,
  enrichScheduleRaces,
  getRecentPointsRaceResults,
} from './_schedule-points-races.js';
import { findEffectiveNextPointsRace } from './_race-date-status.js';
import { buildFactualGroundingContext } from './_power-rankings-factual-grounding.js';
import { getAlignedRaceFinishes } from './_power-rankings-results-audit.js';
import {
  buildDriverLookup,
  fetchStandingsRows,
} from './power-rankings-generate.js';
import {
  alignAllCompletedPointsRaces,
  buildDriverCareerRaceResultsByDriver,
  buildDriverRaceResultsByDriver,
  resolveTrackType,
} from './_fantasy-track-history.js';
import { buildFantasyDriverSalaries } from './_fantasy-salary-scoring.js';
import {
  buildDriverActivityMap,
  deriveDriverActivityStatus as deriveLast5WindowActivity,
} from './_driver-activity.js';
import { countConsecutiveDnps } from './_fantasy-salary-guardrails.js';
import { getLockDisplayState } from './_fantasy-lock-time.js';
import { countLineupsForSlate } from './_fantasy-lineups.js';
import {
  buildIncomingDriverSlug,
  normalizeDriverWriteName,
} from './_drivers-write-identity.js';

export const SLATE_MAX_STANDINGS_POSITION = 30;
export const SLATE_LEGACY_STANDINGS_POOL_CAP = 30;

export const FANTASY_DRIVER_POOL_EXCLUSIONS = {
  INACTIVE_PROFILE: 'inactive_profile',
  ZERO_STARTS: 'zero_official_starts',
  STANDINGS_POSITION: 'standings_position_outside_pool',
  UNRESOLVED_IDENTITY: 'unresolved_identity',
  EXPLICIT_ADMIN: 'explicit_admin_exclusion',
  NOT_IN_STANDINGS: 'not_in_current_standings',
  SALARY_GENERATION_FAILED: 'salary_generation_failed',
  INACTIVE_ATTENDANCE: 'inactive_after_5_consecutive_missed_races',
  INACTIVE_RECENT_WINDOW: 'inactive_no_recent_starts',
  SLATE_LOCKED: 'slate_locked',
};

function normalizeSlateDriverRow(row) {
  return {
    driverId: String(row.driver_id),
    driverName: row.driver_name || '',
    carNumber: row.car_number || '',
    computedTier: row.computed_tier || '',
    fantasyTierScore: Number(row.fantasy_tier_score),
    scoreBreakdown: row.score_breakdown || {},
    generatedSalary: Number(row.generated_salary),
    salaryOverride: row.salary_override != null ? Number(row.salary_override) : null,
    finalSalary: Number(row.final_salary),
    trackHistorySummary: row.track_history_summary || {},
    trackAdjustment: row.track_adjustment || {},
    salaryReasons: row.salary_reasons || [],
    priorSalary: row.prior_salary != null ? Number(row.prior_salary) : null,
  };
}

function parseSlateMeta(row) {
  const meta = row?.meta;
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta) || {};
    } catch {
      return {};
    }
  }
  return meta;
}

function slugifyName(value) {
  return slugify(String(value || ''));
}

export function resolveProfileForStandingsRow(standingsRow = {}, profiles = []) {
  const srhDriverId = String(standingsRow.driverId || '').trim();
  const rowName = normalizeDriverWriteName(standingsRow.driverName);
  const rowSlug = slugifyName(standingsRow.driverName);

  const byDriverId = profiles.find((profile) => String(profile.driver_id) === srhDriverId);
  if (byDriverId) {
    return {
      profile: byDriverId,
      matchMethod: 'driver_id',
      identitySplit: false,
      profileDriverId: String(byDriverId.driver_id),
    };
  }

  if (rowSlug) {
    const bySlug = profiles.find((profile) => {
      const profileSlug = slugifyName(
        profile.slug || profile.display_name || profile.iracing_name || profile.driver_id
      );
      return profileSlug && profileSlug === rowSlug;
    });
    if (bySlug) {
      return {
        profile: bySlug,
        matchMethod: 'slug',
        identitySplit: String(bySlug.driver_id) !== srhDriverId,
        profileDriverId: String(bySlug.driver_id),
      };
    }
  }

  const customerMatches = profiles.filter((profile) => {
    const customerId = String(profile.iracing_customer_id || '').trim();
    return customerId && customerId === srhDriverId;
  });
  if (customerMatches.length === 1) {
    const profile = customerMatches[0];
    return {
      profile,
      matchMethod: 'iracing_customer_id',
      identitySplit: String(profile.driver_id) !== srhDriverId,
      profileDriverId: String(profile.driver_id),
    };
  }

  if (rowName) {
    const nameMatches = profiles.filter((profile) => {
      const names = [profile.iracing_name, profile.display_name, profile.driver_name]
        .map(normalizeDriverWriteName)
        .filter(Boolean);
      return names.includes(rowName);
    });
    if (nameMatches.length === 1) {
      const profile = nameMatches[0];
      return {
        profile,
        matchMethod: 'normalized_name',
        identitySplit: String(profile.driver_id) !== srhDriverId,
        profileDriverId: String(profile.driver_id),
      };
    }
    if (nameMatches.length > 1) {
      return {
        profile: null,
        matchMethod: 'normalized_name_conflict',
        identitySplit: true,
        profileDriverId: null,
        conflicts: nameMatches.map((profile) => String(profile.driver_id)),
      };
    }
  }

  return {
    profile: null,
    matchMethod: null,
    identitySplit: false,
    profileDriverId: null,
  };
}

export function enrichStandingsRowWithProfile(standingsRow = {}, profileResolution = {}) {
  const profile = profileResolution.profile || null;
  return {
    ...standingsRow,
    driverId: String(standingsRow.driverId),
    driverName: profile?.display_name || profile?.iracing_name || standingsRow.driverName || '',
    carNumber: profile?.car_number || standingsRow.carNumber || '',
    profileDriverId: profileResolution.profileDriverId || null,
    iracingCustomerId: profile?.iracing_customer_id || null,
    profileActive: profile ? profile.active !== false : null,
    identityMatchMethod: profileResolution.matchMethod || null,
    identitySplit: Boolean(profileResolution.identitySplit),
    profileResolved: Boolean(profile),
  };
}

export function filterEligibleStandingsRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const seasonStarts = Number(row.races ?? row.seasonStarts ?? 0) || 0;
    const position = Number(row.position ?? row.standingsPosition ?? 0) || 0;
    return seasonStarts > 0 && position >= 1;
  });
}

export function resolveFantasyDriverActivity(driver = {}, context = {}) {
  const driverId = String(driver.driverId || driver.driver_id || '').trim();
  const profileActive =
    driver.profileActive == null ? driver.active !== false : driver.profileActive !== false;
  const alignedRaces = context.alignedRaces || context.allAligned || [];
  const consecutiveMissedRaces = countConsecutiveDnps(alignedRaces, driverId);

  const last5FromMap = context.activityMap?.getForDriverId?.(driverId);
  const last5Activity =
    last5FromMap ||
    deriveLast5WindowActivity({
      last5Starts: driver.last5Starts,
      last5WindowSize: driver.last5WindowSize,
      lastStartRaceNumber: driver.lastStartRaceNumber,
    });

  const attendanceInactiveByStreak = consecutiveMissedRaces >= 5;
  const attendanceInactiveByWindow = last5Activity.status === 'Inactive';
  const attendanceActive = !attendanceInactiveByStreak && !attendanceInactiveByWindow;

  let reason = null;
  if (!profileActive) {
    reason = FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_PROFILE;
  } else if (attendanceInactiveByStreak) {
    reason = FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_ATTENDANCE;
  } else if (attendanceInactiveByWindow) {
    reason = FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_RECENT_WINDOW;
  }

  return {
    active: profileActive && attendanceActive,
    reason,
    consecutiveMissedRaces,
    profileActive,
    attendanceActive,
    last5Starts: Number(last5Activity.last5Starts ?? driver.last5Starts ?? 0) || 0,
    last5WindowSize: Number(last5Activity.last5WindowSize ?? driver.last5WindowSize ?? 0) || 0,
    lastStartRaceNumber: last5Activity.lastStartRaceNumber ?? driver.lastStartRaceNumber ?? null,
  };
}

export function resolveFantasyDriverEligibility(driver = {}, context = {}) {
  const explicitExclusions =
    context.explicitExclusions instanceof Set
      ? context.explicitExclusions
      : new Set(context.explicitExclusions || []);
  const driverId = String(driver.driverId || driver.driver_id || '').trim();
  const seasonStarts = Number(driver.races ?? driver.seasonStarts ?? 0) || 0;
  const position = Number(driver.position ?? driver.standingsPosition ?? 0) || 0;
  const inStandings = Boolean(context.inStandings ?? driver.inStandings ?? seasonStarts > 0);
  const profileResolved = driver.profileResolved !== false;
  const activity = driver.activity || context.activity || resolveFantasyDriverActivity(driver, context);
  const active = activity.active;

  if (explicitExclusions.has(driverId)) {
    return {
      eligible: false,
      reason: FANTASY_DRIVER_POOL_EXCLUSIONS.EXPLICIT_ADMIN,
      active,
      seasonStarts,
      inStandings,
      profileResolved,
      explicitExclusion: true,
      source: 'resolveFantasyDriverEligibility',
    };
  }

  if (!inStandings) {
    return {
      eligible: false,
      reason: FANTASY_DRIVER_POOL_EXCLUSIONS.NOT_IN_STANDINGS,
      active,
      seasonStarts,
      inStandings,
      profileResolved,
      explicitExclusion: false,
      source: 'resolveFantasyDriverEligibility',
    };
  }

  if (seasonStarts <= 0) {
    return {
      eligible: false,
      reason: FANTASY_DRIVER_POOL_EXCLUSIONS.ZERO_STARTS,
      active,
      seasonStarts,
      inStandings,
      profileResolved,
      explicitExclusion: false,
      source: 'resolveFantasyDriverEligibility',
    };
  }

  if (position < 1) {
    return {
      eligible: false,
      reason: FANTASY_DRIVER_POOL_EXCLUSIONS.NOT_IN_STANDINGS,
      active,
      seasonStarts,
      inStandings,
      profileResolved,
      explicitExclusion: false,
      source: 'resolveFantasyDriverEligibility',
    };
  }

  if (!active) {
    return {
      eligible: false,
      reason: activity.reason || FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_PROFILE,
      active,
      seasonStarts,
      inStandings,
      profileResolved,
      explicitExclusion: false,
      source: 'resolveFantasyDriverEligibility',
      consecutiveMissedRaces: activity.consecutiveMissedRaces,
    };
  }

  if (driver.identityMatchMethod === 'normalized_name_conflict') {
    return {
      eligible: false,
      reason: FANTASY_DRIVER_POOL_EXCLUSIONS.UNRESOLVED_IDENTITY,
      active,
      seasonStarts,
      inStandings,
      profileResolved: false,
      explicitExclusion: false,
      source: 'resolveFantasyDriverEligibility',
    };
  }

  return {
    eligible: true,
    reason: null,
    active,
    seasonStarts,
    inStandings,
    profileResolved,
    explicitExclusion: false,
    source: 'resolveFantasyDriverEligibility',
  };
}

export async function loadEligibleFantasyStandingsPool(options = {}) {
  const settings = options.settings || (await getSettings());
  const now = options.now || new Date();
  const scheduleHtml = options.scheduleHtml || (await fetchHtml(settings.scheduleUrl));
  const scheduleRaces =
    options.scheduleRaces || enrichScheduleRaces(parseScheduleRacesFromHtml(scheduleHtml));

  let targetRace = null;
  if (options.raceNumber != null) {
    targetRace = scheduleRaces.find(
      (race) =>
        !race.nonPoints && race.officialPointsRaceNumber === Number(options.raceNumber)
    );
  }
  if (!targetRace) {
    targetRace = findEffectiveNextPointsRace(scheduleRaces, { now, settings }).race;
  }
  if (!targetRace) {
    throw new Error('No upcoming points race found for fantasy driver pool audit.');
  }

  const raceNumber = targetRace.officialPointsRaceNumber;
  const raceDebug = buildRaceNumberDebug(scheduleRaces, raceNumber, { now, settings });
  const standingsResult = await fetchStandingsRows(settings, raceDebug.standingsScheduleId);
  const profiles = options.profiles || (await getDriverProfiles());
  const explicitExclusions = new Set(
    (options.explicitExclusions || []).map((value) => String(value))
  );

  const candidateRows = filterEligibleStandingsRows(standingsResult.rows).map((row) => {
    const profileResolution = resolveProfileForStandingsRow(row, profiles);
    return enrichStandingsRowWithProfile(row, profileResolution);
  });

  const driverLookup = buildDriverLookup(candidateRows, profiles);
  const allAligned = alignAllCompletedPointsRaces(
    scheduleRaces,
    standingsResult.schedules,
    driverLookup,
    { now, settings }
  );
  const activityMap = buildDriverActivityMap({
    scheduleRaces,
    srhSchedules: standingsResult.schedules,
    settings,
    now,
  });

  const enrichedRows = candidateRows.map((row) => {
    const activity = resolveFantasyDriverActivity(row, {
      alignedRaces: allAligned,
      activityMap,
    });
    const eligibility = resolveFantasyDriverEligibility(
      { ...row, activity },
      {
        inStandings: true,
        explicitExclusions,
        alignedRaces: allAligned,
        activityMap,
        activity,
      }
    );
    return {
      ...row,
      activity,
      eligibility,
      canonicalFantasyDriverId: String(row.driverId),
    };
  });

  const eligibleRows = enrichedRows.filter((row) => row.eligibility.eligible);
  const ineligibleRows = enrichedRows.filter((row) => !row.eligibility.eligible);

  return {
    settings,
    now,
    scheduleRaces,
    targetRace,
    raceNumber,
    raceDebug,
    standingsResult,
    profiles,
    enrichedRows,
    eligibleRows,
    ineligibleRows,
    allAligned,
    activityMap,
    rosterRefreshedAt: new Date().toISOString(),
  };
}

export function compareDraftToEligiblePool(draftDrivers = [], eligibleRows = []) {
  const draftById = new Map(
    (draftDrivers || []).map((driver) => [String(driver.driverId || driver.driver_id), driver])
  );
  const eligibleById = new Map(
    (eligibleRows || []).map((row) => [String(row.driverId || row.canonicalFantasyDriverId), row])
  );

  const missingEligible = [];
  for (const row of eligibleRows) {
    const id = String(row.driverId || row.canonicalFantasyDriverId);
    if (!draftById.has(id)) {
      missingEligible.push({
        driverId: id,
        driverName: row.driverName,
        seasonStarts: Number(row.races) || 0,
        active: row.activity?.active !== false,
        consecutiveMissedRaces: row.activity?.consecutiveMissedRaces ?? null,
        eligibilityReason: row.eligibility?.reason || null,
        identityMatchMethod: row.identityMatchMethod || null,
        profileDriverId: row.profileDriverId || null,
        identitySplit: Boolean(row.identitySplit),
        whyMissingFromDraft: 'eligible_but_not_in_current_draft',
      });
    }
  }

  const extraDraftDrivers = [];
  for (const driver of draftDrivers) {
    const id = String(driver.driverId || driver.driver_id);
    if (!eligibleById.has(id)) {
      extraDraftDrivers.push({
        driverId: id,
        driverName: driver.driverName || driver.driver_name || '',
        whyExtra: 'present_in_draft_but_not_currently_eligible',
      });
    }
  }

  return {
    missingEligible,
    extraDraftDrivers,
    addedDriverIds: missingEligible.map((row) => row.driverId),
    removedDriverIds: extraDraftDrivers.map((row) => row.driverId),
    driverPoolChanged: missingEligible.length > 0 || extraDraftDrivers.length > 0,
  };
}

async function buildSalaryContextForPool(poolContext, options = {}) {
  const { settings, scheduleRaces, raceNumber, raceDebug, standingsResult, eligibleRows, now } =
    poolContext;
  const standings = eligibleRows;
  const profiles = poolContext.profiles;
  const driverLookup = buildDriverLookup(standings, profiles);
  const alignedRaces = getAlignedRaceFinishes(
    scheduleRaces,
    raceNumber,
    standingsResult.schedules,
    driverLookup
  );
  const recentResults = getRecentPointsRaceResults(scheduleRaces, raceNumber, 3).map((race) => ({
    raceNumber: race.officialPointsRaceNumber,
    scheduleRow: race.scheduleRow,
    date: race.date,
    track: race.track,
    winner: race.winner,
  }));
  const factualGrounding = buildFactualGroundingContext({
    standings,
    scheduleRaces,
    raceNumber,
    schedules: standingsResult.schedules,
    driverLookup,
    recentResults,
    manualRaceNotes: '',
    transcriptSummary: '',
    seasonCatalog: null,
  });
  const allAligned = alignAllCompletedPointsRaces(
    scheduleRaces,
    standingsResult.schedules,
    driverLookup,
    { now, settings }
  );
  const driverIds = standings.map((row) => String(row.driverId));
  const driverRaceResultsByDriver = buildDriverRaceResultsByDriver(
    allAligned,
    standingsResult.schedules,
    driverIds
  );
  const leagueId = String(standingsResult.lss?.league_id || settings.leagueId || '1783');
  const driverCareerRaceRowsByDriver = await buildDriverCareerRaceResultsByDriver(
    driverIds,
    leagueId
  );

  const seasonId = String(settings.seasonId || '27987');
  const priorMaps = options.priorMaps || {
    priorSalariesByDriver: new Map(),
    priorTierScoresByDriver: new Map(),
    priorRaceNumber: null,
  };

  const targetRace =
    poolContext.targetRace ||
    scheduleRaces.find((race) => race.officialPointsRaceNumber === Number(raceNumber));
  const upcomingTrack = targetRace?.track || 'TBD';

  const drivers = buildFantasyDriverSalaries({
    standings,
    groundingByDriver: factualGrounding.drivers,
    alignedRaces,
    schedules: standingsResult.schedules,
    upcomingTrack,
    driverRaceResultsByDriver,
    driverCareerRaceRowsByDriver,
    priorSalariesByDriver: priorMaps.priorSalariesByDriver,
    priorTierScoresByDriver: priorMaps.priorTierScoresByDriver,
    slateRaceNumber: raceNumber,
    scheduleRaces,
    allAlignedRaces: allAligned,
    settings,
    now,
  });

  return {
    drivers,
    alignedRaces,
    upcomingTrack,
    standingsScheduleId: raceDebug.standingsScheduleId,
  };
}

export async function auditFantasyDriverPoolHealth(seasonId, options = {}) {
  const sb = supabase();
  let raceNumber = options.raceNumber != null ? Number(options.raceNumber) : null;
  if (raceNumber == null) {
    try {
      const { resolveFantasySlateProgression } = await import('./_fantasy-slate-progression.js');
      const progression = await resolveFantasySlateProgression(String(seasonId), {
        settings: options.settings,
      });
      raceNumber =
        progression.activeSlateRow?.race_number ??
        progression.nextRaceNumber ??
        null;
    } catch {
      raceNumber = null;
    }
  }

  const poolContext = await loadEligibleFantasyStandingsPool({
    ...options,
    raceNumber,
  });
  raceNumber = options.raceNumber ?? poolContext.raceNumber;

  let draftPayload = null;
  let publishedPayload = null;
  let resolvedPayload = null;
  if (sb) {
    resolvedPayload = await (async () => {
      const { loadFantasySlateForRace } = await import('./_fantasy-slate.js');
      return loadFantasySlateForRace(String(seasonId), raceNumber);
    })();

    const { data: slateRows } = await sb
      .from('fantasy_slates')
      .select('*')
      .eq('season_id', String(seasonId))
      .eq('race_number', Number(raceNumber))
      .order('generated_at', { ascending: false });

    const draftRow = (slateRows || []).find((row) => row.status === 'draft') || null;
    const publishedRow =
      (slateRows || []).find((row) => row.status === 'published') ||
      (resolvedPayload?.slate?.status === 'published' ? resolvedPayload.slate : null);

    if (draftRow?.id) {
      const { data: draftDrivers } = await sb
        .from('fantasy_slate_drivers')
        .select('*')
        .eq('slate_id', draftRow.id);
      draftPayload = {
        slate: draftRow,
        drivers: (draftDrivers || []).map(normalizeSlateDriverRow),
      };
    }
    if (publishedRow?.id) {
      if (resolvedPayload?.slate?.id === publishedRow.id) {
        publishedPayload = {
          slate: resolvedPayload.slate,
          drivers: resolvedPayload.drivers || [],
        };
      } else {
        const { data: publishedDrivers } = await sb
          .from('fantasy_slate_drivers')
          .select('*')
          .eq('slate_id', publishedRow.id);
        publishedPayload = {
          slate: publishedRow,
          drivers: (publishedDrivers || []).map(normalizeSlateDriverRow),
        };
      }
    }
  }

  const activePayload = publishedPayload || draftPayload || resolvedPayload;
  const slateDrivers = activePayload?.drivers || [];
  const comparison = compareDraftToEligiblePool(slateDrivers, poolContext.eligibleRows);
  const draftMeta = parseSlateMeta(draftPayload?.slate);
  const publishedMeta = parseSlateMeta(publishedPayload?.slate);
  const salaryDraftMeta = draftMeta.salaryDraft || publishedMeta.salaryDraft || {};

  const inactiveByAttendanceCount = poolContext.ineligibleRows.filter((row) =>
    [
      FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_ATTENDANCE,
      FANTASY_DRIVER_POOL_EXCLUSIONS.INACTIVE_RECENT_WINDOW,
    ].includes(row.eligibility?.reason)
  ).length;

  const driverReports = poolContext.enrichedRows.map((row) => ({
    driverId: String(row.driverId),
    srhDriverId: String(row.driverId),
    profileDriverId: row.profileDriverId || null,
    iracingCustomerId: row.iracingCustomerId || null,
    driverName: row.driverName,
    active: row.activity?.active !== false,
    consecutiveMissedRaces: row.activity?.consecutiveMissedRaces ?? null,
    seasonStarts: Number(row.races) || 0,
    standingsPosition: Number(row.position) || null,
    inStandings: true,
    profileResolved: row.profileResolved,
    identityMatchMethod: row.identityMatchMethod || null,
    identitySplit: Boolean(row.identitySplit),
    eligible: row.eligibility.eligible,
    eligibilityReason: row.eligibility.reason,
    inSlate: Boolean(
      slateDrivers.some((driver) => String(driver.driverId) === String(row.driverId))
    ),
    exclusionSource: row.eligibility.eligible ? null : row.eligibility.source,
  }));

  const slateDriverCount = slateDrivers.length;
  const eligibleDriverCount = poolContext.eligibleRows.length;
  const missingEligibleCount = comparison.missingEligible.length;

  const status =
    comparison.driverPoolChanged && activePayload?.slate?.status === 'published'
      ? 'published_stale'
      : comparison.driverPoolChanged
        ? salaryDraftMeta.manualEditsPresent
          ? 'needs_regeneration'
          : 'needs_refresh'
        : 'current';

  const lockState = activePayload?.slate?.lock_at
    ? getLockDisplayState(activePayload.slate.lock_at, new Date())
    : { isLocked: false };

  return {
    seasonId: String(seasonId),
    raceNumber,
    targetRace: {
      raceNumber: poolContext.raceNumber,
      track: poolContext.targetRace?.track || null,
      date: poolContext.targetRace?.date || null,
    },
    standingsScheduleId: poolContext.raceDebug.standingsScheduleId,
    rosterRefreshedAt: poolContext.rosterRefreshedAt,
    draftGeneratedAt: draftPayload?.slate?.generated_at || activePayload?.slate?.generated_at || null,
    publishedAt: publishedPayload?.slate?.published_at || null,
    diagnostics: {
      resolvedSlateId: activePayload?.slate?.id ?? null,
      resolvedSlateStatus: activePayload?.slate?.status ?? null,
      eligibleDriverCount,
      slateDriverCount,
      missingEligibleCount,
      inactiveByAttendanceCount,
      excludedCount: poolContext.ineligibleRows.length,
      isLocked: Boolean(lockState.isLocked),
    },
    counts: {
      eligibleRosterDrivers: eligibleDriverCount,
      driversInDraft: slateDriverCount,
      driversInPublishedSlate:
        activePayload?.slate?.status === 'published' ? slateDriverCount : publishedPayload?.drivers?.length || 0,
      missingEligibleDrivers: missingEligibleCount,
      ineligibleDrivers: poolContext.ineligibleRows.length,
      extraDraftDrivers: comparison.extraDraftDrivers.length,
      slateDriverCount,
    },
    driverPoolStatus: status,
    needsRegeneration: Boolean(
      comparison.driverPoolChanged &&
        (salaryDraftMeta.needsRegeneration || salaryDraftMeta.manualEditsPresent)
    ),
    driverPoolChanged: comparison.driverPoolChanged,
    manualEditsPresent: Boolean(salaryDraftMeta.manualEditsPresent),
    publishedSlateLocked: false,
    isPublishedSlate: activePayload?.slate?.status === 'published',
    isLocked: Boolean(lockState.isLocked),
    resolvedSlate: activePayload,
    comparison,
    drivers: driverReports,
    missingDrivers: comparison.missingEligible,
    recommendation:
      activePayload?.slate?.status === 'published' && comparison.missingEligible.length
        ? lockState.isLocked
          ? 'Published slate is locked. Use an admin lock override to add newly eligible drivers.'
          : 'Published slate is missing eligible drivers. Use Add Missing Eligible Drivers to update the player pool without changing existing salaries.'
        : comparison.missingEligible.length && salaryDraftMeta.manualEditsPresent
          ? 'Draft has manual salary edits. Compare the driver pool and regenerate or add missing drivers explicitly.'
          : comparison.missingEligible.length
            ? 'Slate driver pool is stale. Regenerate the slate or add missing eligible drivers.'
            : 'Driver pool is current.',
  };
}

export async function patchFantasyDriverPoolMeta(slateId, patch = {}) {
  const sb = supabase();
  if (!sb || !slateId) return null;

  const { data: row } = await sb
    .from('fantasy_slates')
    .select('meta')
    .eq('id', Number(slateId))
    .maybeSingle();
  const existingMeta = parseSlateMeta(row);
  const nextMeta = {
    ...existingMeta,
    driverPool: {
      ...(existingMeta.driverPool || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  };

  const salaryDraft = {
    ...(existingMeta.salaryDraft || {}),
  };
  if (patch.needsRegeneration != null) salaryDraft.needsRegeneration = patch.needsRegeneration;
  if (patch.driverPoolChanged != null) salaryDraft.driverPoolChanged = patch.driverPoolChanged;
  nextMeta.salaryDraft = salaryDraft;

  const { error } = await sb
    .from('fantasy_slates')
    .update({ meta: nextMeta, updated_at: new Date().toISOString() })
    .eq('id', Number(slateId));
  if (error) throw new Error(error.message || 'Failed to update fantasy driver pool metadata.');
  return nextMeta;
}

export async function addMissingEligibleDriversToSlate(seasonId, options = {}) {
  const sb = supabase();
  if (!sb) throw new Error('Supabase not configured.');

  const audit = await auditFantasyDriverPoolHealth(seasonId, options);
  const slatePayload = audit.resolvedSlate;
  const slateRow = slatePayload?.slate;

  if (!slateRow?.id) {
    throw new Error(`No fantasy slate found for race ${audit.raceNumber}.`);
  }

  if (audit.isLocked && !options.adminLockOverride) {
    const error = new Error(
      'This slate is locked. Adding drivers requires an explicit admin lock override.'
    );
    error.code = 'SLATE_LOCKED';
    error.status = 409;
    error.audit = audit;
    throw error;
  }

  const lineupCount = await countLineupsForSlate(slateRow.id);
  if (lineupCount > 0 && !options.confirmLineupsExist) {
    const error = new Error(
      'This published slate has submitted lineups. Adding drivers will not change existing lineups.'
    );
    error.code = 'LINEUPS_EXIST_CONFIRM_REQUIRED';
    error.status = 409;
    error.audit = audit;
    error.lineupCount = lineupCount;
    throw error;
  }

  if (!audit.comparison.missingEligible.length) {
    return {
      ok: true,
      addedCount: 0,
      added: 0,
      addedDrivers: [],
      existingCount: audit.counts.slateDriverCount,
      finalCount: audit.counts.slateDriverCount,
      slateId: slateRow.id,
      status: slateRow.status,
      audit,
      message: 'No missing eligible drivers to add.',
    };
  }

  const draftMeta = parseSlateMeta(slateRow);
  if (
    slateRow.status === 'draft' &&
    draftMeta.salaryDraft?.manualEditsPresent &&
    !options.confirmManualEditMerge
  ) {
    await patchFantasyDriverPoolMeta(slateRow.id, {
      needsRegeneration: true,
      driverPoolChanged: true,
      missingDriverIds: audit.comparison.addedDriverIds,
    });
    const error = new Error(
      'Draft has manual salary edits. Confirm merge or regenerate the full slate instead.'
    );
    error.code = 'MANUAL_EDITS_PROTECTED';
    error.audit = audit;
    throw error;
  }

  const existingDriverIds = new Set(
    (slatePayload.drivers || []).map((driver) => String(driver.driverId))
  );
  const poolContext = await loadEligibleFantasyStandingsPool({
    ...options,
    raceNumber: audit.raceNumber,
  });
  const salaryContext = await buildSalaryContextForPool(poolContext, options);
  const salaryById = new Map(
    salaryContext.drivers.map((driver) => [String(driver.driverId), driver])
  );

  const inserts = [];
  const addedDrivers = [];
  for (const missing of audit.comparison.missingEligible) {
    const id = String(missing.driverId);
    if (existingDriverIds.has(id)) continue;

    const computed = salaryById.get(id);
    if (!computed?.finalSalary && computed?.finalSalary !== 0) {
      throw new Error(
        `Salary generation failed for ${missing.driverName || missing.driverId}. Driver was not added.`
      );
    }
    inserts.push({
      slate_id: slateRow.id,
      driver_id: computed.driverId,
      driver_name: computed.driverName,
      car_number: computed.carNumber,
      computed_tier: computed.computedTier,
      fantasy_tier_score: computed.fantasyTierScore,
      score_breakdown: computed.scoreBreakdown,
      generated_salary: computed.generatedSalary,
      salary_override: computed.salaryOverride,
      final_salary: computed.finalSalary,
      track_history_summary: computed.trackHistorySummary,
      track_adjustment: computed.trackAdjustment,
      salary_reasons: computed.salaryReasons,
      prior_salary: computed.priorSalary,
    });
    addedDrivers.push({
      driverId: String(computed.driverId),
      driverName: computed.driverName,
      finalSalary: computed.finalSalary,
    });
  }

  if (!inserts.length) {
    return {
      ok: true,
      addedCount: 0,
      added: 0,
      addedDrivers: [],
      existingCount: audit.counts.slateDriverCount,
      finalCount: audit.counts.slateDriverCount,
      slateId: slateRow.id,
      status: slateRow.status,
      audit,
      message: 'No missing eligible drivers to add.',
    };
  }

  const { error: insertError } = await sb.from('fantasy_slate_drivers').insert(inserts);
  if (insertError) {
    throw new Error(insertError.message || 'Failed to add missing fantasy slate drivers.');
  }

  await patchFantasyDriverPoolMeta(slateRow.id, {
    driverPoolChanged: false,
    needsRegeneration: false,
    lastDriverPoolRefreshAt: new Date().toISOString(),
    lastAddedDriverIds: addedDrivers.map((driver) => driver.driverId),
    driverPoolStatus: 'current',
  });

  const refreshedAudit = await auditFantasyDriverPoolHealth(seasonId, {
    ...options,
    raceNumber: audit.raceNumber,
  });

  return {
    ok: true,
    addedCount: inserts.length,
    added: inserts.length,
    addedDrivers,
    existingCount: audit.counts.slateDriverCount,
    finalCount: audit.counts.slateDriverCount + inserts.length,
    slateId: slateRow.id,
    status: slateRow.status,
    audit: refreshedAudit,
  };
}

export async function regenerateFantasySlatePool(seasonId, options = {}) {
  const mode = options.mode === 'full_regenerate' ? 'full_regenerate' : 'add_missing_only';
  if (mode === 'add_missing_only') {
    return addMissingEligibleDriversToSlate(seasonId, options);
  }

  const audit = await auditFantasyDriverPoolHealth(seasonId, options);
  const slateRow = audit.resolvedSlate?.slate;
  if (!slateRow?.id) {
    throw new Error(`No fantasy slate found for race ${audit.raceNumber}.`);
  }

  if (audit.isLocked && !options.adminLockOverride) {
    const error = new Error(
      'This slate is locked. Full regeneration requires an explicit admin lock override.'
    );
    error.code = 'SLATE_LOCKED';
    error.status = 409;
    error.audit = audit;
    throw error;
  }

  const lineupCount = await countLineupsForSlate(slateRow.id);
  if (lineupCount > 0 && !options.confirmLineupsExist) {
    const error = new Error(
      'This slate has submitted lineups. Full regeneration will rebuild salaries but will not alter existing lineups.'
    );
    error.code = 'LINEUPS_EXIST_CONFIRM_REQUIRED';
    error.status = 409;
    error.audit = audit;
    error.lineupCount = lineupCount;
    throw error;
  }

  const { generateFantasyDraftSlate } = await import('./_fantasy-slate.js');
  const generated = await generateFantasyDraftSlate({
    raceNumber: audit.raceNumber,
    forceRegenerate: true,
    allowPublishedUpdate: slateRow.status === 'published',
  });

  const refreshedAudit = await auditFantasyDriverPoolHealth(seasonId, {
    ...options,
    raceNumber: audit.raceNumber,
  });

  return {
    ok: true,
    mode,
    slateId: generated.slate?.id ?? slateRow.id,
    status: generated.slate?.status ?? slateRow.status,
    driverCount: (generated.drivers || []).length,
    actionTaken: generated.actionTaken || 'updated_existing',
    audit: refreshedAudit,
    slate: generated.slate || null,
    drivers: generated.drivers || [],
  };
}

export async function addMissingEligibleDriversToDraft(seasonId, options = {}) {
  return addMissingEligibleDriversToSlate(seasonId, options);
}

export async function refreshFantasyDriverPoolMetadata(seasonId, options = {}) {
  const audit = await auditFantasyDriverPoolHealth(seasonId, options);
  const sb = supabase();
  if (!sb) return audit;

  const { data: draftRow } = await sb
    .from('fantasy_slates')
    .select('id, status')
    .eq('season_id', String(seasonId))
    .eq('race_number', Number(audit.raceNumber))
    .maybeSingle();

  if (draftRow?.id) {
    await patchFantasyDriverPoolMeta(draftRow.id, {
      driverPoolChanged: audit.driverPoolChanged,
      needsRegeneration:
        audit.driverPoolChanged &&
        (audit.manualEditsPresent || audit.needsRegeneration),
      driverPoolStatus: audit.driverPoolStatus,
      eligibleRosterDrivers: audit.counts.eligibleRosterDrivers,
      driversInDraft: audit.counts.driversInDraft,
      missingEligibleDrivers: audit.counts.missingEligibleDrivers,
      rosterRefreshedAt: audit.rosterRefreshedAt,
      missingDriverIds: audit.comparison.addedDriverIds,
    });
  }

  return audit;
}

export function draftDriverActivitySummary(slateDriver = {}) {
  const attendance = slateDriver.attendanceContext || slateDriver.scoreBreakdown?.attendanceContext || {};
  const reliability = slateDriver.scoreBreakdown?.reliability?.details || {};
  const activity = resolveFantasyDriverActivity(slateDriver, {
    last5Starts: reliability.last5Starts ?? attendance.validLast5Starts ?? attendance.last5Starts,
    last5WindowSize:
      reliability.last5WindowSize ?? attendance.validLast5WindowSize ?? attendance.last5WindowSize,
    lastStartRaceNumber:
      reliability.lastStartRaceNumber ?? attendance.lastStartRaceNumber ?? null,
  });
  return activity;
}

export { buildIncomingDriverSlug };
