import { slugify } from './_lib.js';
import { normalizeCustomerId } from './_iracing.js';

const MATCH_PRIORITY = ['driver_id', 'slug', 'iracing_customer_id', 'normalized_name'];

export function normalizeDriverWriteName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildIncomingDriverSlug(body = {}) {
  return slugify(body.display_name || body.iracing_name || body.driver_id || '');
}

function pickPrimaryMatchMethod(methods = new Set()) {
  for (const method of MATCH_PRIORITY) {
    if (methods.has(method)) return method;
  }
  return null;
}

function addIdentityMatch(matches, profile, method) {
  if (!profile?.driver_id) return;
  const driverId = String(profile.driver_id);
  if (!matches.has(driverId)) {
    matches.set(driverId, { profile, methods: new Set() });
  }
  matches.get(driverId).methods.add(method);
}

function shouldUseIncomingCustomerIdForMatch(incomingDriverId, incomingCustomerId) {
  if (!incomingCustomerId) return false;
  if (!incomingDriverId) return true;
  return incomingCustomerId !== incomingDriverId;
}

export function resolveExistingProfileFromLoadedProfiles(incoming = {}, profiles = []) {
  const incomingDriverId = String(incoming.driver_id || '').trim();
  const incomingSlug = buildIncomingDriverSlug(incoming);
  const incomingCustomerId = normalizeCustomerId(
    incoming.iracing_customer_id ?? incoming.iracingCustomerId
  );
  const incomingName = normalizeDriverWriteName(incoming.display_name || incoming.iracing_name);
  const matches = new Map();

  if (incomingDriverId) {
    const profile = profiles.find((row) => String(row.driver_id) === incomingDriverId);
    if (profile) addIdentityMatch(matches, profile, 'driver_id');
  }

  if (incomingSlug) {
    const profile = profiles.find((row) => String(row.slug || '') === incomingSlug);
    if (profile) addIdentityMatch(matches, profile, 'slug');
  }

  if (shouldUseIncomingCustomerIdForMatch(incomingDriverId, incomingCustomerId)) {
    const profile = profiles.find(
      (row) => normalizeCustomerId(row.iracing_customer_id) === incomingCustomerId
    );
    if (profile) addIdentityMatch(matches, profile, 'iracing_customer_id');
  }

  if (incomingName) {
    for (const profile of profiles) {
      const names = [profile.iracing_name, profile.display_name, profile.driver_name]
        .map(normalizeDriverWriteName)
        .filter(Boolean);
      if (names.includes(incomingName)) {
        addIdentityMatch(matches, profile, 'normalized_name');
      }
    }
  }

  const uniqueIds = [...matches.keys()];
  if (uniqueIds.length > 1) {
    return {
      conflict: true,
      profile: null,
      matchMethod: null,
      matches: uniqueIds.map((id) => ({
        driver_id: id,
        methods: [...matches.get(id).methods],
        profile: matches.get(id).profile,
      })),
    };
  }

  if (uniqueIds.length === 1) {
    const entry = matches.get(uniqueIds[0]);
    return {
      conflict: false,
      profile: entry.profile,
      matchMethod: pickPrimaryMatchMethod(entry.methods),
      matches: [
        {
          driver_id: uniqueIds[0],
          methods: [...entry.methods],
          profile: entry.profile,
        },
      ],
    };
  }

  return { conflict: false, profile: null, matchMethod: null, matches: [] };
}

export async function resolveExistingProfileForDriverWrite(sb, incoming = {}) {
  const incomingDriverId = String(incoming.driver_id || '').trim();
  const incomingSlug = buildIncomingDriverSlug(incoming);
  const incomingCustomerId = normalizeCustomerId(
    incoming.iracing_customer_id ?? incoming.iracingCustomerId
  );
  const incomingName = normalizeDriverWriteName(incoming.display_name || incoming.iracing_name);
  const matches = new Map();

  if (incomingDriverId) {
    const { data } = await sb
      .from('driver_profiles')
      .select('*')
      .eq('driver_id', incomingDriverId)
      .maybeSingle();
    if (data) addIdentityMatch(matches, data, 'driver_id');
  }

  if (incomingSlug) {
    const { data } = await sb
      .from('driver_profiles')
      .select('*')
      .eq('slug', incomingSlug)
      .maybeSingle();
    if (data) addIdentityMatch(matches, data, 'slug');
  }

  if (shouldUseIncomingCustomerIdForMatch(incomingDriverId, incomingCustomerId)) {
    const { data } = await sb
      .from('driver_profiles')
      .select('*')
      .eq('iracing_customer_id', incomingCustomerId)
      .maybeSingle();
    if (data) addIdentityMatch(matches, data, 'iracing_customer_id');
  }

  if (incomingName) {
    const { data: profiles } = await sb.from('driver_profiles').select('*');
    for (const profile of profiles || []) {
      const names = [profile.iracing_name, profile.display_name, profile.driver_name]
        .map(normalizeDriverWriteName)
        .filter(Boolean);
      if (names.includes(incomingName)) {
        addIdentityMatch(matches, profile, 'normalized_name');
      }
    }
  }

  const uniqueIds = [...matches.keys()];
  if (uniqueIds.length > 1) {
    return {
      conflict: true,
      profile: null,
      matchMethod: null,
      matches: uniqueIds.map((id) => ({
        driver_id: id,
        methods: [...matches.get(id).methods],
        profile: matches.get(id).profile,
      })),
    };
  }

  if (uniqueIds.length === 1) {
    const entry = matches.get(uniqueIds[0]);
    return {
      conflict: false,
      profile: entry.profile,
      matchMethod: pickPrimaryMatchMethod(entry.methods),
      matches: [
        {
          driver_id: uniqueIds[0],
          methods: [...entry.methods],
          profile: entry.profile,
        },
      ],
    };
  }

  return { conflict: false, profile: null, matchMethod: null, matches: [] };
}

const PRESERVE_IF_INCOMING_BLANK = new Set([
  'form_email',
  'date_of_birth',
  'hometown',
  'team',
  'photo_url',
  'bio',
  'years_sim_racing',
  'driving_style',
  'favorite_track',
  'favorite_nascar_driver',
  'sim_racing_accomplishment',
  'season_goal',
  'fun_fact',
  'facebook_url',
  'twitter_url',
  'instagram_url',
  'youtube_url',
  'twitch_url',
  'tiktok_url',
  'car_image_url',
  'stream_url',
  'standing_photo_url',
]);

export function sanitizeIncomingCustomerId(incoming = {}, existing = null) {
  const incomingDriverId = String(incoming.driver_id || '').trim();
  const incomingCustomerId = normalizeCustomerId(
    incoming.iracing_customer_id ?? incoming.iracingCustomerId
  );
  const existingCustomerId = normalizeCustomerId(existing?.iracing_customer_id);

  if (existingCustomerId) {
    if (!incomingCustomerId || incomingCustomerId === incomingDriverId) {
      return existingCustomerId;
    }
    if (incomingCustomerId === existingCustomerId) {
      return existingCustomerId;
    }
    return incomingCustomerId;
  }

  if (incomingCustomerId && incomingCustomerId !== incomingDriverId) {
    return incomingCustomerId;
  }

  return incomingCustomerId || null;
}

export function mergeDriverProfilePatch(existing = {}, patch = {}, incoming = {}) {
  const merged = { ...patch };
  delete merged.driver_id;

  const sanitizedCustomerId = sanitizeIncomingCustomerId(incoming, existing);
  if (sanitizedCustomerId) {
    merged.iracing_customer_id = sanitizedCustomerId;
  } else if (existing.iracing_customer_id) {
    merged.iracing_customer_id = existing.iracing_customer_id;
  } else {
    delete merged.iracing_customer_id;
  }

  if (existing.slug) {
    merged.slug = existing.slug;
  }

  for (const [key, value] of Object.entries(merged)) {
    if (key === 'updated_at') continue;
    if (!PRESERVE_IF_INCOMING_BLANK.has(key)) continue;
    const incomingValue = value == null ? '' : String(value).trim();
    const existingValue =
      existing[key] == null ? '' : String(existing[key]).trim();
    if (!incomingValue && existingValue) {
      merged[key] = existing[key];
    }
  }

  if (!String(merged.iracing_name || '').trim() && existing.iracing_name) {
    merged.iracing_name = existing.iracing_name;
  }
  if (!String(merged.display_name || '').trim() && existing.display_name) {
    merged.display_name = existing.display_name;
    merged.driver_name = existing.display_name;
  }

  merged.updated_at = new Date().toISOString();
  return merged;
}
