const GOOGLE_SHEET_ID = '1wtHM9fsXd3jNtrU47mBCBeKB7iruFKo9g-3oQAx0x30';
const GOOGLE_SHEET_GID = '1380371312';

const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=${GOOGLE_SHEET_GID}`;

const HEADER_ALIASES = {
  timestamp: ['timestamp'],
  email: ['email address', 'email'],
  driverName: ['driver name', 'name'],
  carNumber: ['car number', 'car #', 'car'],
  hometown: ['hometown'],
  stateCountry: ['state / country', 'state/country', 'state country'],
  bio: ['driver bio', 'bio'],
  yearsSimRacing: ['years of sim racing experience', 'years sim racing'],
  drivingStyle: ['driving style'],
  favoriteTrack: ['favorite track'],
  favoriteNascarDriver: ['favorite nascar driver'],
  accomplishment: ['biggest accomplishment in sim racing', 'biggest accomplishment'],
  seasonGoal: ['goal for this season', 'season goal'],
  funFact: ['something other drivers may not know', 'fun fact'],
  driverImage: ['driver image', 'driver photo'],
  carImage: ['car image', 'car photo'],
  streams: ['do you stream your races', 'stream your races', 'stream races'],
  facebook: ['facebook'],
  twitter: ['x / twitter', 'x/twitter', 'twitter', 'x'],
  instagram: ['instagram'],
  youtube: ['youtube'],
  twitch: ['twitch'],
  tiktok: ['tiktok'],
  permission: [
    'permission',
    'i give permission',
    'permission to publish',
    'permission checkbox',
    'may we publish',
    'publish my bio',
  ],
  birthdate: ['birthdate', 'date of birth', 'birthday'],
};

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function mapHeaders(headerRow) {
  const mapped = {};
  headerRow.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
        if (!mapped[field]) mapped[field] = index;
      }
    }
  });
  return mapped;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => String(value).trim())) rows.push(row);
  }

  return rows;
}

function cellValue(row, index) {
  if (index == null || index < 0) return '';
  return String(row[index] ?? '').trim();
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCarNumber(value) {
  return String(value || '')
    .replace(/[^0-9]/g, '')
    .replace(/^0+/, '') || '';
}

function parsePermission(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return ['yes', 'y', 'true', '1', 'checked', 'agree', 'i agree'].some(
    (token) => text === token || text.startsWith(`${token},`) || text.includes(token)
  );
}

function parseStreamer(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return ['yes', 'y', 'true', '1'].includes(text) || /\byes\b/.test(text);
}

function normalizeUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^www\./i.test(url)) return `https://${url}`;
  if (/^(twitch|youtube|instagram|facebook|twitter|x|tiktok)\./i.test(url)) {
    return `https://${url}`;
  }
  return url;
}

function pickStreamUrl(row) {
  const candidates = [
    normalizeUrl(row.twitch),
    normalizeUrl(row.youtube),
    normalizeUrl(row.tiktok),
    normalizeUrl(row.twitter),
    normalizeUrl(row.facebook),
  ].filter(Boolean);
  return candidates[0] || '';
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowToFormEntry(row, headers) {
  const get = (field) => cellValue(row, headers[field]);
  return {
    timestamp: get('timestamp'),
    timestampMs: parseTimestamp(get('timestamp')),
    email: get('email'),
    driverName: get('driverName'),
    carNumber: get('carNumber'),
    hometown: get('hometown'),
    stateCountry: get('stateCountry'),
    bio: get('bio'),
    yearsSimRacing: get('yearsSimRacing'),
    drivingStyle: get('drivingStyle'),
    favoriteTrack: get('favoriteTrack'),
    favoriteNascarDriver: get('favoriteNascarDriver'),
    accomplishment: get('accomplishment'),
    seasonGoal: get('seasonGoal'),
    funFact: get('funFact'),
    driverImageUrl: normalizeUrl(get('driverImage')),
    carImageUrl: normalizeUrl(get('carImage')),
    streams: get('streams'),
    facebook: normalizeUrl(get('facebook')),
    twitter: normalizeUrl(get('twitter')),
    instagram: normalizeUrl(get('instagram')),
    youtube: normalizeUrl(get('youtube')),
    twitch: normalizeUrl(get('twitch')),
    tiktok: normalizeUrl(get('tiktok')),
    permissionGranted: parsePermission(get('permission')),
    birthdate: get('birthdate'),
  };
}

export async function fetchGoogleFormResponses() {
  const response = await fetch(SHEET_CSV_URL, {
    headers: { 'user-agent': 'BP-Truck-Series-Website/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Google Sheet fetch failed (${response.status}). Ensure the sheet is published or link-shared.`);
  }

  const text = await response.text();
  const table = parseCsv(text);
  if (table.length < 2) {
    throw new Error('Google Sheet returned no form responses.');
  }

  const headers = mapHeaders(table[0]);
  if (headers.driverName == null) {
    throw new Error('Could not find Driver Name column in Google Sheet.');
  }

  const entries = table
    .slice(1)
    .map((row) => rowToFormEntry(row, headers))
    .filter((entry) => entry.driverName);

  const latestByDriver = new Map();
  for (const entry of entries) {
    const key = normalizeName(entry.driverName);
    const existing = latestByDriver.get(key);
    if (!existing || entry.timestampMs >= existing.timestampMs) {
      latestByDriver.set(key, entry);
    }
  }

  return {
    sheetUrl: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit#gid=${GOOGLE_SHEET_GID}`,
    headersFound: Object.keys(headers),
    totalRows: entries.length,
    latestEntries: [...latestByDriver.values()],
  };
}

function profileNames(profile) {
  return [
    profile.display_name,
    profile.iracing_name,
    profile.driver_name,
  ]
    .filter(Boolean)
    .map(normalizeName);
}

function matchProfile(entry, profiles) {
  const entryName = normalizeName(entry.driverName);
  const entryCar = normalizeCarNumber(entry.carNumber);

  let match = profiles.find((profile) => profileNames(profile).includes(entryName));
  if (match) {
    return { profile: match, method: 'name', conflicts: [] };
  }

  match = profiles.find((profile) => {
    const names = profileNames(profile);
    return names.some(
      (name) =>
        (name.includes(entryName) || entryName.includes(name)) &&
        name.split(' ').filter((t) => t.length > 2).length >= 2
    );
  });
  if (match) {
    return { profile: match, method: 'name_fuzzy', conflicts: [] };
  }

  if (entryCar) {
    const carMatches = profiles.filter(
      (profile) => normalizeCarNumber(profile.car_number) === entryCar
    );
    if (carMatches.length === 1) {
      return { profile: carMatches[0], method: 'car_number', conflicts: [] };
    }
    if (carMatches.length > 1) {
      return {
        profile: null,
        method: null,
        conflicts: [`Multiple drivers share car #${entry.carNumber}`],
      };
    }
  }

  return { profile: null, method: null, conflicts: [] };
}

function buildProposedUpdates(entry, profile) {
  if (!entry.permissionGranted) {
    return {
      permissionGranted: false,
      proposed: null,
      skipReason: 'Permission not granted — public bio/social fields will not sync.',
    };
  }

  const hometown = [entry.hometown, entry.stateCountry].filter(Boolean).join(', ');
  const isStreamer = parseStreamer(entry.streams);
  const streamUrl = isStreamer ? pickStreamUrl(entry) : normalizeUrl(profile?.stream_url || '');

  const proposed = {
    bio: entry.bio || null,
    years_sim_racing: entry.yearsSimRacing || null,
    driving_style: entry.drivingStyle || null,
    favorite_track: entry.favoriteTrack || null,
    favorite_nascar_driver: entry.favoriteNascarDriver || null,
    sim_racing_accomplishment: entry.accomplishment || null,
    season_goal: entry.seasonGoal || null,
    fun_fact: entry.funFact || null,
    facebook_url: entry.facebook || null,
    twitter_url: entry.twitter || null,
    instagram_url: entry.instagram || null,
    youtube_url: entry.youtube || null,
    twitch_url: entry.twitch || null,
    tiktok_url: entry.tiktok || null,
    car_image_url: entry.carImageUrl || null,
    form_email: entry.email || null,
    form_submitted_at: entry.timestamp ? new Date(entry.timestampMs || Date.now()).toISOString() : null,
    form_permission_granted: true,
    is_streamer: isStreamer,
    stream_url: streamUrl || null,
  };

  if (entry.birthdate) {
    proposed.date_of_birth = entry.birthdate;
  }
  if (hometown) {
    proposed.hometown = hometown;
  }

  return { permissionGranted: true, proposed, skipReason: null };
}

export function buildFormSyncPreview(profiles, sheetData) {
  const unmatched = [];
  const matched = [];
  const skipped = [];

  for (const entry of sheetData.latestEntries) {
    const { profile, method, conflicts } = matchProfile(entry, profiles);
    const preview = buildProposedUpdates(entry, profile);

    const base = {
      formDriverName: entry.driverName,
      formCarNumber: entry.carNumber,
      formTimestamp: entry.timestamp,
      permissionGranted: entry.permissionGranted,
      driverImageUrl: entry.driverImageUrl,
      carImageUrl: entry.carImageUrl,
      isStreamer: parseStreamer(entry.streams),
      streamUrl: parseStreamer(entry.streams) ? pickStreamUrl(entry) : '',
      socialLinks: {
        facebook: entry.facebook,
        twitter: entry.twitter,
        instagram: entry.instagram,
        youtube: entry.youtube,
        twitch: entry.twitch,
        tiktok: entry.tiktok,
      },
      proposed: preview.proposed,
      skipReason: preview.skipReason,
      conflicts,
    };

    if (!profile) {
      unmatched.push(base);
      continue;
    }

    if (!entry.permissionGranted) {
      skipped.push({
        ...base,
        driver_id: profile.driver_id,
        displayName: profile.display_name || profile.iracing_name,
        matchMethod: method,
      });
      continue;
    }

    matched.push({
      ...base,
      driver_id: profile.driver_id,
      displayName: profile.display_name || profile.iracing_name,
      iracingName: profile.iracing_name,
      matchMethod: method,
      existingPhotoUrl: profile.photo_url || '',
    });
  }

  return {
    sheetUrl: sheetData.sheetUrl,
    totalFormRows: sheetData.totalRows,
    latestResponseCount: sheetData.latestEntries.length,
    matched,
    skipped,
    unmatched,
  };
}

function mergeBioFields(existing, proposed) {
  const row = { ...existing };
  for (const [key, value] of Object.entries(proposed)) {
    if (value == null || value === '') continue;
    row[key] = value;
  }
  row.photo_url = existing.photo_url || '';
  row.updated_at = new Date().toISOString();
  return row;
}

export async function applyFormSyncUpdates(sb, profiles, driverIds, sheetData) {
  const idSet = new Set(driverIds.map(String));
  const preview = buildFormSyncPreview(profiles, sheetData);
  const toApply = preview.matched.filter((item) => idSet.has(String(item.driver_id)));

  const results = [];
  for (const item of toApply) {
    const existing = profiles.find((p) => String(p.driver_id) === String(item.driver_id));
    if (!existing || !item.proposed) continue;

    const merged = mergeBioFields(existing, item.proposed);
    const { error } = await sb.from('driver_profiles').upsert(merged, { onConflict: 'driver_id' });
    results.push({
      driver_id: item.driver_id,
      displayName: item.displayName,
      ok: !error,
      error: error?.message || null,
    });
  }

  return {
    applied: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    results,
  };
}
