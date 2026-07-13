(function (global) {
  const ROSTER_STATUS_ORDER = { current: 0, new_approved: 1, inactive: 2 };

  function normalizeCustomerId(value) {
    return String(value ?? '').trim().replace(/\D/g, '');
  }

  function normalizeSyncName(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripPhotoUrlQuery(url) {
    return String(url || '').split('?')[0].split('#')[0];
  }

  function resolveRosterStatus({ active, inStandings }) {
    if (!active) return 'inactive';
    if (inStandings) return 'current';
    return 'new_approved';
  }

  function findStandingsMatchForProfile(profile, standingsList, profileList) {
    const name = normalizeSyncName(profile?.iracing_name || profile?.display_name);
    const customerId = normalizeCustomerId(
      profile?.iracing_customer_id || profile?.iracingCustomerId
    );

    for (const row of standingsList) {
      const rowName = normalizeSyncName(row.driver || row.driverName);
      if (name && rowName && name === rowName) return row;
    }

    for (const row of standingsList) {
      const standingsProfile = profileList.find(
        (entry) => String(entry.driver_id) === String(row.driverId)
      );
      if (
        customerId &&
        normalizeCustomerId(
          standingsProfile?.iracing_customer_id || standingsProfile?.iracingCustomerId
        ) === customerId
      ) {
        return row;
      }
    }

    return null;
  }

  function shouldHideDuplicateApprovedProfile(profile, standingsList, profileList, standingsDriverIds) {
    const driverId = String(profile?.driver_id || '').trim();
    if (!driverId || standingsDriverIds.has(driverId)) return false;

    const hasApplicationLink = Boolean(
      profile?.source_application_id ||
        profile?.sourceApplicationId ||
        profile?.approved_application_at ||
        profile?.approvedApplicationAt
    );
    if (!hasApplicationLink) return false;

    return Boolean(findStandingsMatchForProfile(profile, standingsList, profileList));
  }

  function profileFromRow(profile, row, options = {}) {
    const active = profile?.active !== false;
    const inStandings = Boolean(options.in_standings);
    const applicationSynced = Boolean(options.application_synced);

    return {
      driver_id: String(options.driver_id || row?.driverId || profile?.driver_id || ''),
      iracing_customer_id:
        profile?.iracing_customer_id ||
        profile?.iracingCustomerId ||
        normalizeCustomerId(options.iracing_customer_id || row?.driverId || ''),
      iracing_name: row?.driver || profile?.iracing_name || profile?.display_name || 'Unknown Driver',
      display_name: profile?.display_name || row?.driver || profile?.iracing_name || 'Unknown Driver',
      form_email: profile?.form_email || profile?.formEmail || '',
      car_number: profile?.car_number || '',
      bp_number: profile?.bp_number || profile?.car_number || '',
      photo_url: stripPhotoUrlQuery(profile?.photo_url || row?.photoUrl || ''),
      date_of_birth: profile?.date_of_birth || profile?.dateOfBirth || '',
      hometown: profile?.hometown || '',
      team: profile?.team || '',
      is_streamer: profile?.is_streamer === true,
      stream_url: profile?.stream_url || '',
      standing_photo_url: stripPhotoUrlQuery(
        profile?.standing_photo_url || profile?.standingPhotoUrl || ''
      ),
      standingPhotoUrl: profile?.standingPhotoUrl || '',
      standing_photo_zoom: profile?.standing_photo_zoom ?? profile?.standingPhotoZoom,
      standingPhotoZoom: profile?.standingPhotoZoom,
      standing_photo_x: profile?.standing_photo_x ?? profile?.standingPhotoX,
      standingPhotoX: profile?.standingPhotoX,
      standing_photo_y: profile?.standing_photo_y ?? profile?.standingPhotoY,
      standingPhotoY: profile?.standingPhotoY,
      standing_photo_updated_at:
        profile?.standing_photo_updated_at || profile?.standingPhotoUpdatedAt,
      standingPhotoUpdatedAt: profile?.standingPhotoUpdatedAt,
      standing_photo_enabled: profile?.standing_photo_enabled ?? profile?.standingPhotoEnabled,
      standingPhotoEnabled: profile?.standingPhotoEnabled,
      active,
      in_standings: inStandings,
      source_application_id:
        profile?.source_application_id || profile?.sourceApplicationId || null,
      application_synced: applicationSynced,
      roster_status:
        options.roster_status || resolveRosterStatus({ active, inStandings }),
    };
  }

  function buildDriverList(standingsRows, profiles) {
    const profileList = Array.isArray(profiles) ? profiles : [];
    const standingsList = Array.isArray(standingsRows) ? standingsRows : [];
    const byId = Object.fromEntries(profileList.map((p) => [String(p.driver_id), p]));
    const standingsDriverIds = new Set(standingsList.map((row) => String(row.driverId)));
    const standingsCustomerIds = new Set();
    const usedProfileIds = new Set();
    const list = [];

    for (const row of standingsList) {
      const profile = byId[String(row.driverId)] || null;
      if (profile) {
        usedProfileIds.add(String(profile.driver_id));
        const customerId = normalizeCustomerId(
          profile.iracing_customer_id || profile.iracingCustomerId
        );
        if (customerId) standingsCustomerIds.add(customerId);
      }
      const active = profile?.active !== false;
      const applicationSynced = Boolean(
        profile?.source_application_id ||
          profile?.sourceApplicationId ||
          profile?.approved_application_at ||
          profile?.approvedApplicationAt
      );
      list.push(
        profileFromRow(profile, row, {
          driver_id: String(row.driverId),
          in_standings: true,
          application_synced: applicationSynced,
          roster_status: resolveRosterStatus({ active, inStandings: true }),
        })
      );
    }

    for (const profile of profileList) {
      const driverId = String(profile.driver_id || '').trim();
      if (!driverId || usedProfileIds.has(driverId)) continue;

      if (
        shouldHideDuplicateApprovedProfile(
          profile,
          standingsList,
          profileList,
          standingsDriverIds
        )
      ) {
        continue;
      }

      usedProfileIds.add(driverId);

      const customerId = normalizeCustomerId(
        profile.iracing_customer_id || profile.iracingCustomerId
      );
      const standingsMatch = findStandingsMatchForProfile(profile, standingsList, profileList);
      const inStandings =
        standingsDriverIds.has(driverId) ||
        (customerId && standingsCustomerIds.has(customerId)) ||
        Boolean(standingsMatch);
      const active = profile.active !== false;

      list.push(
        profileFromRow(profile, standingsMatch, {
          driver_id: driverId,
          iracing_customer_id: customerId,
          in_standings: inStandings,
          application_synced: inStandings && Boolean(profile.source_application_id),
          roster_status: resolveRosterStatus({ active, inStandings }),
        })
      );
    }

    return list.sort((a, b) => {
      const groupDiff =
        (ROSTER_STATUS_ORDER[a.roster_status] ?? 99) -
        (ROSTER_STATUS_ORDER[b.roster_status] ?? 99);
      if (groupDiff !== 0) return groupDiff;
      return String(a.display_name || a.iracing_name || '').localeCompare(
        String(b.display_name || b.iracing_name || '')
      );
    });
  }

  function filterActiveDrivers(drivers) {
    return (Array.isArray(drivers) ? drivers : []).filter((driver) => driver.active !== false);
  }

  function formatDriverDropdownLabel(driver, options = {}) {
    const name = driver?.display_name || driver?.iracing_name || 'Unknown';
    const number = driver?.bp_number || driver?.car_number || '';
    const label = number ? `#${number} ${name}` : name;
    const showNewBadge = options.showNewBadge !== false;
    const suffix = options.suffix ? String(options.suffix(driver) || '') : '';
    const newSuffix =
      showNewBadge && driver?.roster_status === 'new_approved' ? ' (New)' : '';
    const syncedSuffix = driver?.application_synced ? ' (Application Synced)' : '';
    return `${label}${newSuffix}${syncedSuffix}${suffix}`;
  }

  async function fetchDriverRoster(options = {}) {
    const { adminPassword = '', includeInactive = false } = options;
    const headers = {};
    if (adminPassword) {
      headers['X-Admin-Password'] = adminPassword;
    }

    const driversFetch = Object.keys(headers).length
      ? fetch('/api/drivers', { headers })
      : fetch('/api/drivers');

    const [standingsRes, driversRes] = await Promise.all([
      fetch('/api/standings'),
      driversFetch,
    ]);
    const standingsData = await standingsRes.json();
    const profiles = await driversRes.json();

    if (!standingsRes.ok) {
      throw new Error(standingsData.error || 'Failed to load standings');
    }
    if (!driversRes.ok) {
      throw new Error(profiles.error || 'Failed to load driver profiles');
    }

    let list = buildDriverList(standingsData.rows || [], profiles);
    if (!includeInactive) {
      list = filterActiveDrivers(list);
    }
    return list;
  }

  global.BPAdminDriverRoster = {
    ROSTER_STATUS_ORDER,
    normalizeCustomerId,
    normalizeSyncName,
    stripPhotoUrlQuery,
    resolveRosterStatus,
    findStandingsMatchForProfile,
    shouldHideDuplicateApprovedProfile,
    profileFromRow,
    buildDriverList,
    filterActiveDrivers,
    formatDriverDropdownLabel,
    fetchDriverRoster,
  };
})(typeof window !== 'undefined' ? window : globalThis);
