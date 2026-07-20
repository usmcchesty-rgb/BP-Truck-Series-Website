(function (global) {
  function normalizeDriverStatsName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugifyDriverStatsName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function normalizeCustomerId(value) {
    return String(value ?? '').trim().replace(/\D/g, '');
  }

  function collectProfileNames(profile) {
    const names = new Set();
    for (const field of [profile?.iracing_name, profile?.display_name, profile?.driver_name]) {
      const normalized = normalizeDriverStatsName(field);
      if (normalized) names.add(normalized);
    }
    return [...names];
  }

  function standingsRowName(row) {
    return normalizeDriverStatsName(row?.driverName || row?.driver);
  }

  function standingsRowSlug(row) {
    return slugifyDriverStatsName(row?.driverName || row?.driver || row?.driverId);
  }

  function buildStandingsIdentityLookupMaps(standingsRows) {
    const bySrhDriverId = new Map();
    const bySlug = new Map();
    const byNormalizedName = new Map();

    for (const row of standingsRows || []) {
      const srhDriverId = String(row.driverId || row.driver_id || '').trim();
      if (!srhDriverId) continue;

      bySrhDriverId.set(srhDriverId, row);

      const slug = standingsRowSlug(row);
      if (slug) {
        if (!bySlug.has(slug)) bySlug.set(slug, []);
        bySlug.get(slug).push(row);
      }

      const name = standingsRowName(row);
      if (name) {
        if (!byNormalizedName.has(name)) byNormalizedName.set(name, []);
        byNormalizedName.get(name).push(row);
      }
    }

    return { bySrhDriverId, bySlug, byNormalizedName };
  }

  function buildIdentityResult(profile, srhDriverId, matchedBy, resolved) {
    const profileDriverId = String(profile?.driver_id || '').trim();
    return {
      profileDriverId: profileDriverId || null,
      iracingCustomerId: normalizeCustomerId(profile?.iracing_customer_id) || null,
      srhDriverId: srhDriverId || null,
      matchedBy: matchedBy || null,
      resolved: resolved === true,
      identitySplit:
        resolved === true &&
        Boolean(srhDriverId) &&
        Boolean(profileDriverId) &&
        String(srhDriverId) !== profileDriverId,
    };
  }

  function resolveDriverStatsIdentity(profile, context) {
    const profileDriverId = String(profile?.driver_id || '').trim();
    const iracingCustomerId = normalizeCustomerId(profile?.iracing_customer_id);
    const maps =
      context?.standingsMaps ||
      buildStandingsIdentityLookupMaps(context?.standingsRows || []);

    function resolveFromSrhId(srhDriverId, matchedBy) {
      const id = String(srhDriverId || '').trim();
      if (!id || !maps.bySrhDriverId.has(id)) return null;
      return buildIdentityResult(profile, id, matchedBy, true);
    }

    const explicitSrhId = String(
      profile?.srh_driver_id ||
        profile?.standings_driver_id ||
        profile?.srhDriverId ||
        profile?.standingsDriverId ||
        ''
    ).trim();
    let result = resolveFromSrhId(explicitSrhId, 'explicit_srh_driver_id');
    if (result) return result;

    const snapshotId = String(
      context?.careerSnapshot?.matched_driver_id ||
        profile?.matched_driver_id ||
        profile?.career_snapshot_matched_driver_id ||
        ''
    ).trim();
    result = resolveFromSrhId(snapshotId, 'career_snapshot_matched_driver_id');
    if (result) return result;

    result = resolveFromSrhId(profileDriverId, 'driver_id');
    if (result) return result;

    result = resolveFromSrhId(iracingCustomerId, 'iracing_customer_id');
    if (result) return result;

    const profileSlug = slugifyDriverStatsName(
      profile?.slug || profile?.display_name || profile?.iracing_name || profileDriverId
    );
    if (profileSlug && maps.bySlug.has(profileSlug)) {
      const slugMatches = maps.bySlug.get(profileSlug) || [];
      if (slugMatches.length === 1) {
        return buildIdentityResult(profile, String(slugMatches[0].driverId), 'slug', true);
      }
      if (slugMatches.length > 1) {
        return buildIdentityResult(profile, null, 'slug_conflict', false);
      }
    }

    for (const name of collectProfileNames(profile)) {
      const nameMatches = maps.byNormalizedName.get(name) || [];
      if (nameMatches.length === 1) {
        return buildIdentityResult(
          profile,
          String(nameMatches[0].driverId),
          'normalized_name',
          true
        );
      }
      if (nameMatches.length > 1) {
        return buildIdentityResult(profile, null, 'normalized_name_conflict', false);
      }
    }

    return buildIdentityResult(profile, null, null, false);
  }

  function findStandingsRowForIdentity(identity, standingsRows, maps) {
    if (!identity?.resolved || !identity.srhDriverId) return null;
    const lookup = maps || buildStandingsIdentityLookupMaps(standingsRows || []);
    return lookup.bySrhDriverId.get(String(identity.srhDriverId)) || null;
  }

  function countOfficialResultsForDriver(srhDriverId, schedules) {
    if (!srhDriverId) return 0;
    const driverKey = String(srhDriverId);
    let count = 0;

    for (const schedule of Object.values(schedules || {})) {
      const buckets = schedule?.drivers || {};
      for (const bucket of Object.values(buckets)) {
        const result = bucket?.[driverKey];
        if (result?.finish_pos != null || String(result?.provisional || '').toUpperCase() === 'Y') {
          count += 1;
          break;
        }
      }
    }

    return count;
  }

  function buildDriverStatsIdentityDiagnostics(profile, context) {
    const standingsRows = context?.standingsRows || [];
    const standingsMaps =
      context?.standingsMaps || buildStandingsIdentityLookupMaps(standingsRows);
    const identity = resolveDriverStatsIdentity(profile, {
      ...context,
      standingsRows,
      standingsMaps,
    });
    const standingsRow = findStandingsRowForIdentity(identity, standingsRows, standingsMaps);
    const schedules = context?.schedules || {};
    const recentRaces = Array.isArray(context?.recentRaces) ? context.recentRaces : [];
    const seasonResultCount =
      identity.resolved && identity.srhDriverId
        ? countOfficialResultsForDriver(identity.srhDriverId, schedules)
        : 0;
    const recentResultCount = recentRaces.length;

    let exclusionReason = null;
    if (!identity.resolved) {
      exclusionReason = 'Driver profile could not be linked to SimRacerHub identity.';
    } else if (seasonResultCount === 0 && !standingsRow?.races) {
      exclusionReason = 'No official completed race results for resolved identity.';
    }

    return {
      profileDriverId: identity.profileDriverId,
      resolvedSrhDriverId: identity.srhDriverId,
      identityMatchMethod: identity.matchedBy,
      standingsRowFound: Boolean(standingsRow),
      officialResultsFound: seasonResultCount > 0 || Number(standingsRow?.races) > 0,
      seasonResultCount,
      recentResultCount,
      statsSource: identity.resolved ? 'simracerhub_standings' : null,
      exclusionReason,
    };
  }

  global.BPDriverStatsIdentity = {
    normalizeDriverStatsName,
    slugifyDriverStatsName,
    buildStandingsIdentityLookupMaps,
    resolveDriverStatsIdentity,
    findStandingsRowForIdentity,
    buildDriverStatsIdentityDiagnostics,
  };
})(window);
