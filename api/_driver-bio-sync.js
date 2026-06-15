const GOOGLE_SHEET_ID = '1wtHM9fsXd3jNtrU47mBCBeKB7iruFKo9g-3oQAx0x30';
const GOOGLE_SHEET_GID = '1380371312';

const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=${GOOGLE_SHEET_GID}`;

const HEADER_ALIASES = {
  timestamp: ['timestamp'],
  email: ['email address', 'email'],
  driverName: ['driver name', 'name'],
  carNumber: ['car number', 'number', 'truck number'],
  hometown: ['hometown'],
  stateCountry: ['state country', 'state/country', 'location'],
  bio: ['driver bio', 'bio'],
  yearsSimRacing: ['years of sim racing experience', 'sim racing experience'],
  drivingStyle: ['driving style'],
  favoriteTrack: ['favorite track'],
  favoriteNascarDriver: ['favorite nascar driver'],
  accomplishment: [
    'biggest accomplishment in sim racing',
    'sim racing accomplishment',
    'what is your biggest accomplishment in sim racing',
  ],
  seasonGoal: ['goal for this season', 'season goal', 'what is your goal for this season'],
  funFact: [
    'something other drivers may not know',
    'fun fact',
    'what is something other drivers may not know about you',
  ],
  driverImage: ['driver image'],
  carImage: ['car image'],
  streams: ['do you stream your races', 'streamer'],
  facebook: ['facebook'],
  twitter: ['x twitter', 'x / twitter', 'twitter'],
  instagram: ['instagram'],
  youtube: ['youtube'],
  twitch: ['twitch'],
  tiktok: ['tiktok'],
  permission: ['permission', 'permission checkbox', 'i give blazing pedals permission'],
  birthdate: ['birthdate', 'date of birth', 'dob'],
};

const EXPECTED_HEADER_FIELDS = Object.keys(HEADER_ALIASES);

const SOCIAL_FIELDS = ['facebook', 'twitter', 'instagram', 'youtube', 'twitch', 'tiktok'];

const EXACT_ONLY_ALIASES = new Set(['name', 'number', 'bio', 'dob', 'email']);

const FIELD_LABELS = {
  timestamp: 'Timestamp',
  email: 'Email Address',
  driverName: 'Driver Name',
  carNumber: 'Car Number',
  hometown: 'Hometown',
  stateCountry: 'State / Country',
  bio: 'Driver Bio',
  yearsSimRacing: 'Years of Sim Racing Experience',
  drivingStyle: 'Driving Style',
  favoriteTrack: 'Favorite Track',
  favoriteNascarDriver: 'Favorite NASCAR Driver',
  accomplishment: 'Biggest accomplishment in sim racing',
  seasonGoal: 'Goal for this season',
  funFact: 'Something other drivers may not know',
  driverImage: 'Driver Image',
  carImage: 'Car Image',
  streams: 'Do you stream your races',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  youtube: 'YouTube',
  twitch: 'Twitch',
  tiktok: 'TikTok',
  permission: 'Permission checkbox',
  birthdate: 'Birthdate',
};

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreHeaderMatch(normalizedHeader, alias) {
  const normalizedAlias = normalizeHeader(alias);
  if (!normalizedHeader || !normalizedAlias) return 0;

  if (normalizedHeader === normalizedAlias) {
    return 1000 + normalizedAlias.length;
  }

  if (EXACT_ONLY_ALIASES.has(normalizedAlias)) {
    return 0;
  }

  if (normalizedAlias.length >= 4 && normalizedHeader.includes(normalizedAlias)) {
    return 500 + normalizedAlias.length;
  }

  if (normalizedHeader.length >= 4 && normalizedAlias.includes(normalizedHeader)) {
    return 400 + normalizedHeader.length;
  }

  return 0;
}

function mapHeaders(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeHeader);
  const candidates = [];

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    normalizedHeaders.forEach((header, index) => {
      for (const alias of aliases) {
        const score = scoreHeaderMatch(header, alias);
        if (score > 0) {
          candidates.push({
            field,
            index,
            score,
            header: String(headerRow[index] ?? '').trim(),
            normalizedHeader: header,
            alias,
          });
        }
      }
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const mapped = {};
  const usedColumns = new Set();
  const usedFields = new Set();
  const mappingDetails = {};

  for (const candidate of candidates) {
    if (usedFields.has(candidate.field) || usedColumns.has(candidate.index)) continue;
    mapped[candidate.field] = candidate.index;
    usedFields.add(candidate.field);
    usedColumns.add(candidate.index);
    mappingDetails[candidate.field] = {
      columnIndex: candidate.index,
      headerName: candidate.header,
      normalizedHeader: candidate.normalizedHeader,
      matchedAlias: candidate.alias,
      score: candidate.score,
    };
  }

  return { mapped, mappingDetails, usedColumns, normalizedHeaders };
}

function buildHeaderMappingMeta(headerRow, mapResult) {
  const { mapped, mappingDetails, usedColumns } = mapResult;
  const sheetHeaders = headerRow.map((header, index) => ({
    columnIndex: index,
    headerName: String(header ?? '').trim(),
    normalizedHeader: normalizeHeader(header),
  }));

  const missingExpectedColumns = EXPECTED_HEADER_FIELDS.filter(
    (field) => mapped[field] == null
  ).map((field) => FIELD_LABELS[field] || field);

  const unknownColumns = sheetHeaders
    .filter((column) => !usedColumns.has(column.columnIndex))
    .map((column) => column.headerName)
    .filter(Boolean);

  return {
    sheetHeaders,
    fieldMapping: mappingDetails,
    missingExpectedColumns,
    unknownColumns,
  };
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

function isSuspiciousSocialValue(value) {
  const text = String(value || '').trim();
  if (!text) return false;

  const lower = text.toLowerCase();
  if (/^(yes|no|y|n|true|false)$/i.test(lower)) return true;
  if (/^\d+\+?$/.test(text)) return true;
  if (/^\d+\s*[-–]\s*\d+\+?$/.test(text)) return true;
  if (/^\d+-\d+$/.test(text)) return true;
  if (text.length > 120) return true;
  if (text.split(/\s+/).length >= 8 && /[.!?]/.test(text)) return true;
  if (/\b(years?|experience|racing experience|martinsville|talladega|daytona|charlotte|bristol)\b/i.test(text)) {
    return true;
  }

  return false;
}

function valueMatchesOtherEntryField(value, entry, excludeField) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;

  const compareFields = [
    'driverName',
    'carNumber',
    'hometown',
    'stateCountry',
    'bio',
    'yearsSimRacing',
    'drivingStyle',
    'favoriteTrack',
    'favoriteNascarDriver',
    'accomplishment',
    'seasonGoal',
    'funFact',
    'streams',
    'birthdate',
  ];

  return compareFields.some((field) => {
    if (field === excludeField) return false;
    return String(entry[field] || '').trim().toLowerCase() === normalized;
  });
}

function isLikelyHandle(value) {
  const handle = String(value || '').trim().replace(/^@+/, '');
  return /^[a-z0-9._-]{1,40}$/i.test(handle);
}

function validateTwitterValue(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: '' };

  if (isSuspiciousSocialValue(text)) {
    return { ok: false, warning: `Skipped Twitter/X value "${text}" — looks like a non-social answer.` };
  }

  if (/^https?:\/\//i.test(text) || /^(twitter|x)\./i.test(text)) {
    if (/twitter\.com|x\.com/i.test(text) || /^(twitter|x)\./i.test(text)) {
      return { ok: true, value: normalizeUrl(text) };
    }
    return { ok: false, warning: `Skipped Twitter/X URL "${text}" — must be x.com or twitter.com.` };
  }

  if (text.startsWith('@') || isLikelyHandle(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  return { ok: false, warning: `Skipped Twitter/X value "${text}" — expected @handle or x.com URL.` };
}

function validateFacebookValue(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: '' };

  if (isSuspiciousSocialValue(text)) {
    return { ok: false, warning: `Skipped Facebook value "${text}" — looks like a non-social answer.` };
  }

  if (/^https?:\/\//i.test(text) || /^www\./i.test(text) || /facebook\.com/i.test(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  if (/^facebook\./i.test(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  if (isLikelyHandle(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  return { ok: false, warning: `Skipped Facebook value "${text}" — expected URL or username.` };
}

function validateInstagramValue(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: '' };

  if (isSuspiciousSocialValue(text)) {
    return { ok: false, warning: `Skipped Instagram value "${text}" — looks like a non-social answer.` };
  }

  if (/^https?:\/\//i.test(text) || /instagram\.com/i.test(text) || /^instagram\./i.test(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  if (text.startsWith('@') || isLikelyHandle(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  return { ok: false, warning: `Skipped Instagram value "${text}" — expected @handle or instagram.com URL.` };
}

function validateTikTokValue(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: '' };

  if (isSuspiciousSocialValue(text)) {
    return { ok: false, warning: `Skipped TikTok value "${text}" — looks like a non-social answer.` };
  }

  if (/^https?:\/\//i.test(text) || /tiktok\.com/i.test(text) || /^tiktok\./i.test(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  if (text.startsWith('@') || isLikelyHandle(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  return { ok: false, warning: `Skipped TikTok value "${text}" — expected @handle or tiktok.com URL.` };
}

function validateTwitchValue(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: '' };

  if (isSuspiciousSocialValue(text)) {
    return { ok: false, warning: `Skipped Twitch value "${text}" — looks like a non-social answer.` };
  }

  if (/^https?:\/\//i.test(text) || /twitch\.tv/i.test(text) || /^twitch\./i.test(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  if (isLikelyHandle(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  return { ok: false, warning: `Skipped Twitch value "${text}" — expected twitch.tv URL or username.` };
}

function validateYouTubeValue(value) {
  const text = String(value || '').trim();
  if (!text) return { ok: true, value: '' };

  if (isSuspiciousSocialValue(text)) {
    return { ok: false, warning: `Skipped YouTube value "${text}" — looks like a non-social answer.` };
  }

  if (
    /^https?:\/\//i.test(text) ||
    /youtube\.com|youtu\.be/i.test(text) ||
    /^youtube\./i.test(text)
  ) {
    return { ok: true, value: normalizeUrl(text) };
  }

  if (text.startsWith('@') || isLikelyHandle(text)) {
    return { ok: true, value: normalizeUrl(text) };
  }

  return { ok: false, warning: `Skipped YouTube value "${text}" — expected channel URL or @handle.` };
}

const SOCIAL_VALIDATORS = {
  facebook: validateFacebookValue,
  twitter: validateTwitterValue,
  instagram: validateInstagramValue,
  youtube: validateYouTubeValue,
  twitch: validateTwitchValue,
  tiktok: validateTikTokValue,
};

function validateFormEntry(entry) {
  const cleaned = { ...entry };
  const warnings = [];

  for (const field of SOCIAL_FIELDS) {
    const raw = String(entry[field] || '').trim();
    if (!raw) {
      cleaned[field] = '';
      continue;
    }

    if (valueMatchesOtherEntryField(raw, entry, field)) {
      warnings.push(
        `Skipped ${FIELD_LABELS[field] || field} value "${raw}" — matches another form answer.`
      );
      cleaned[field] = '';
      continue;
    }

    const validator = SOCIAL_VALIDATORS[field];
    const result = validator ? validator(raw) : { ok: true, value: normalizeUrl(raw) };
    if (!result.ok) {
      if (result.warning) warnings.push(result.warning);
      cleaned[field] = '';
      continue;
    }

    cleaned[field] = result.value || '';
  }

  return { entry: cleaned, warnings };
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
  const entry = {
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
    facebook: get('facebook'),
    twitter: get('twitter'),
    instagram: get('instagram'),
    youtube: get('youtube'),
    twitch: get('twitch'),
    tiktok: get('tiktok'),
    permissionGranted: parsePermission(get('permission')),
    birthdate: get('birthdate'),
  };

  const validated = validateFormEntry(entry);
  return {
    ...validated.entry,
    validationWarnings: validated.warnings,
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

  const mapResult = mapHeaders(table[0]);
  const headers = mapResult.mapped;
  const headerMapping = buildHeaderMappingMeta(table[0], mapResult);

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
    headerMapping,
    totalRows: entries.length,
    latestEntries: [...latestByDriver.values()],
  };
}

function profileNames(profile) {
  return [profile.display_name, profile.iracing_name, profile.driver_name]
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
    car_image_url: entry.carImageUrl || null,
    form_email: entry.email || null,
    form_submitted_at: entry.timestamp ? new Date(entry.timestampMs || Date.now()).toISOString() : null,
    form_permission_granted: true,
    is_streamer: isStreamer,
    stream_url: streamUrl || null,
  };

  for (const field of SOCIAL_FIELDS) {
    const dbKey = `${field}_url`;
    const validatedValue = String(entry[field] || '').trim();
    if (validatedValue) {
      proposed[dbKey] = validatedValue;
    }
  }

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
    const rowWarnings = [...(entry.validationWarnings || []), ...(conflicts || [])];

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
      warnings: rowWarnings,
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
    headerMapping: sheetData.headerMapping || null,
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
