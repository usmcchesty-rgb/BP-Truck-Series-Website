/**
 * Shared driver profile resolution across results / standings / fantasy / profile routes.
 *
 * Canonical profile PK is driver_profiles.driver_id (often the iRacing customer ID).
 * SimRacerHub standings/results use a separate SRH driver id (drid).
 * Late-added Season 11 drivers commonly have identitySplit:
 *   profile.driver_id === iracing_customer_id !== srh_driver_id
 */
import { slugify } from './_lib.js';
import { normalizeDriverWriteName } from './_drivers-write-identity.js';

function slugifyName(value) {
  return slugify(String(value || ''));
}

function normalizeLookupName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function twitterHandleFromUrl(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (text.startsWith('@')) return text.slice(1);
  const match = text.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
  return match?.[1]?.replace(/^@/, '') || '';
}

/**
 * Resolve a SimRacerHub standings/results participant to a driver_profiles row.
 */
export function resolveProfileForStandingsRow(standingsRow = {}, profiles = []) {
  const srhDriverId = String(standingsRow.driverId || standingsRow.driver_id || '').trim();
  const rowName = normalizeDriverWriteName(
    standingsRow.driverName || standingsRow.driver || standingsRow.name
  );
  const rowSlug = slugifyName(
    standingsRow.driverName || standingsRow.driver || standingsRow.name
  );

  const byDriverId = profiles.find((profile) => String(profile.driver_id) === srhDriverId);
  if (byDriverId) {
    return {
      profile: byDriverId,
      matchMethod: 'driver_id',
      identitySplit: false,
      profileDriverId: String(byDriverId.driver_id),
      srhDriverId: srhDriverId || null,
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
        srhDriverId: srhDriverId || null,
      };
    }
  }

  const customerMatches = profiles.filter((profile) => {
    const customerId = String(profile.iracing_customer_id || profile.iracingCustomerId || '').trim();
    return customerId && customerId === srhDriverId;
  });
  if (customerMatches.length === 1) {
    const profile = customerMatches[0];
    return {
      profile,
      matchMethod: 'iracing_customer_id',
      identitySplit: String(profile.driver_id) !== srhDriverId,
      profileDriverId: String(profile.driver_id),
      srhDriverId: srhDriverId || null,
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
        srhDriverId: srhDriverId || null,
      };
    }
    if (nameMatches.length > 1) {
      return {
        profile: null,
        matchMethod: 'normalized_name_conflict',
        identitySplit: true,
        profileDriverId: null,
        srhDriverId: srhDriverId || null,
        conflicts: nameMatches.map((profile) => String(profile.driver_id)),
      };
    }
  }

  return {
    profile: null,
    matchMethod: null,
    identitySplit: false,
    profileDriverId: null,
    srhDriverId: srhDriverId || null,
  };
}

function findByDirectFields(profiles, queryId) {
  const raw = String(queryId ?? '').trim();
  if (!raw) return null;

  let match = profiles.find((row) => String(row.driver_id) === raw);
  if (match) return { profile: match, matchedBy: 'driver_id' };

  match = profiles.find(
    (row) =>
      String(row.iracing_customer_id || row.iracingCustomerId || '').trim() === raw
  );
  if (match) return { profile: match, matchedBy: 'iracing_customer_id' };

  match = profiles.find((row) => {
    const srh =
      row.srh_driver_id ||
      row.standings_driver_id ||
      row.srhDriverId ||
      row.standingsDriverId ||
      '';
    return String(srh).trim() === raw;
  });
  if (match) return { profile: match, matchedBy: 'explicit_srh_driver_id' };

  const lookupName = normalizeLookupName(raw);
  const lookupSlug = slugifyName(raw.replace(/^@/, ''));

  if (raw.startsWith('@')) {
    const handle = raw.slice(1).toLowerCase();
    match = profiles.find((row) => {
      const twitter = String(row.twitter_url || row.twitterUrl || '')
        .trim()
        .toLowerCase();
      const twitterHandle = twitterHandleFromUrl(twitter);
      return (
        twitter === raw.toLowerCase() ||
        twitter.includes(`/${handle}`) ||
        twitter.includes(`@${handle}`) ||
        twitterHandle === handle
      );
    });
    if (match) return { profile: match, matchedBy: 'twitter_handle' };

    match = profiles.find((row) => {
      const names = [row.display_name, row.iracing_name].map(normalizeLookupName);
      return names.includes(handle) || names.includes(lookupName);
    });
    if (match) return { profile: match, matchedBy: 'twitter_name' };
  }

  match = profiles.find((row) => {
    const names = [row.display_name, row.iracing_name].map(normalizeLookupName);
    return names.includes(lookupName);
  });
  if (match) return { profile: match, matchedBy: 'normalized_name' };

  if (lookupSlug) {
    match = profiles.find(
      (row) =>
        slugifyName(row.slug || row.display_name || row.iracing_name || '') === lookupSlug ||
        slugifyName(row.driver_id || '') === lookupSlug
    );
    if (match) return { profile: match, matchedBy: 'slug' };
  }

  return null;
}

/**
 * Resolve a public profile query (URL segment) to a driver_profiles row.
 * Accepts profile driver_id, iRacing customer ID, SRH standings id, slug, or name.
 */
export function findDriverProfileByQuery(profiles = [], queryId, options = {}) {
  const direct = findByDirectFields(profiles, queryId);
  if (direct?.profile) {
    return {
      profile: direct.profile,
      matchedBy: direct.matchedBy,
      queryId: String(queryId || '').trim() || null,
    };
  }

  const raw = String(queryId ?? '').trim();
  if (!raw) {
    return { profile: null, matchedBy: null, queryId: null };
  }

  const standingsRows = options.standingsRows || [];
  if (standingsRows.length) {
    const standingsRow =
      standingsRows.find(
        (row) => String(row.driverId || row.driver_id || '').trim() === raw
      ) || null;
    if (standingsRow) {
      const resolution = resolveProfileForStandingsRow(standingsRow, profiles);
      if (resolution.profile) {
        return {
          profile: resolution.profile,
          matchedBy: `standings_${resolution.matchMethod || 'row'}`,
          queryId: raw,
          srhDriverId: resolution.srhDriverId,
          identitySplit: resolution.identitySplit,
        };
      }
    }
  }

  return { profile: null, matchedBy: null, queryId: raw };
}

export function driverProfilePublicUrl(profileOrId) {
  const id =
    typeof profileOrId === 'object' && profileOrId
      ? String(profileOrId.driver_id || '').trim()
      : String(profileOrId || '').trim();
  if (!id) return '/drivers.html';
  return `/drivers/${encodeURIComponent(id)}`;
}
