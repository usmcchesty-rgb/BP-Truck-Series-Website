const IRACING_AUTH_URL = 'https://members-ng.iracing.com/auth';
const IRACING_DATA_BASE = 'https://members-ng.iracing.com/data';

let cachedSession = null;
let cachedSessionExpiresAt = 0;

function getIracingCredentials() {
  const email = String(process.env.IRACING_EMAIL || process.env.IRACING_USERNAME || '').trim();
  const password = String(process.env.IRACING_PASSWORD || '').trim();
  const totp = String(process.env.IRACING_TOTP || '').trim();
  return { email, password, totp };
}

export function isIracingLookupConfigured() {
  const { email, password } = getIracingCredentials();
  return Boolean(email && password);
}

function normalizeCustomerId(value) {
  return String(value ?? '').trim().replace(/\D/g, '');
}

function extractCookieHeader(response) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  if (typeof getSetCookie === 'function') {
    const cookies = getSetCookie();
    if (Array.isArray(cookies) && cookies.length) {
      return cookies.map((entry) => entry.split(';')[0]).join('; ');
    }
  }

  const raw = response.headers.get('set-cookie');
  if (!raw) return '';
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((entry) => entry.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function loginToIracing() {
  const now = Date.now();
  if (cachedSession && cachedSessionExpiresAt > now) {
    return cachedSession;
  }

  const { email, password, totp } = getIracingCredentials();
  if (!email || !password) {
    throw new Error('iRacing lookup credentials are not configured.');
  }

  const response = await fetch(IRACING_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, totp }),
  });

  if (!response.ok) {
    throw new Error(`iRacing authentication failed (${response.status}).`);
  }

  const cookieHeader = extractCookieHeader(response);
  if (!cookieHeader) {
    throw new Error('iRacing authentication did not return a session cookie.');
  }

  cachedSession = cookieHeader;
  cachedSessionExpiresAt = now + 15 * 60 * 1000;
  return cookieHeader;
}

async function fetchIracingDataEndpoint(path, params = {}) {
  const cookieHeader = await loginToIracing();
  const url = new URL(`${IRACING_DATA_BASE}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  const metaResponse = await fetch(url, {
    headers: { Cookie: cookieHeader },
  });
  if (!metaResponse.ok) {
    throw new Error(`iRacing data request failed (${metaResponse.status}).`);
  }

  const meta = await metaResponse.json();
  if (!meta?.link) {
    throw new Error('iRacing data response did not include a result link.');
  }

  const dataResponse = await fetch(meta.link);
  if (!dataResponse.ok) {
    throw new Error(`iRacing result fetch failed (${dataResponse.status}).`);
  }

  return dataResponse.json();
}

function extractDisplayName(payload, customerId) {
  if (!payload || typeof payload !== 'object') return '';

  const direct =
    payload.display_name ||
    payload.displayName ||
    payload.name ||
    payload.username ||
    '';
  if (direct) return String(direct).trim();

  const keyed = payload[customerId] || payload[String(Number(customerId))];
  if (keyed && typeof keyed === 'object') {
    return String(
      keyed.display_name || keyed.displayName || keyed.name || keyed.username || ''
    ).trim();
  }

  const members = payload.members || payload.data;
  if (Array.isArray(members)) {
    const match = members.find(
      (row) => String(row?.cust_id ?? row?.customer_id ?? row?.custId) === customerId
    );
    if (match) {
      return String(
        match.display_name || match.displayName || match.name || match.username || ''
      ).trim();
    }
  }

  const firstObject = Object.values(payload).find(
    (value) => value && typeof value === 'object' && !Array.isArray(value)
  );
  if (firstObject) {
    return String(
      firstObject.display_name ||
        firstObject.displayName ||
        firstObject.name ||
        firstObject.username ||
        ''
    ).trim();
  }

  return '';
}

export async function lookupIracingMember(customerIdInput) {
  const customerId = normalizeCustomerId(customerIdInput);
  if (!customerId || !/^\d+$/.test(customerId)) {
    return {
      configured: true,
      ok: false,
      status: 400,
      error: 'Valid numeric Customer ID is required.',
    };
  }

  if (!isIracingLookupConfigured()) {
    return {
      configured: false,
      ok: false,
      status: 503,
      error:
        'iRacing lookup is not configured on the server yet. Enter your display name manually.',
    };
  }

  try {
    const payload = await fetchIracingDataEndpoint('member/get', { cust_ids: customerId });
    const displayName = extractDisplayName(payload, customerId);
    if (!displayName) {
      return {
        configured: true,
        ok: false,
        status: 404,
        verified: false,
        customerId,
        error: 'No iRacing member was found for this Customer ID.',
      };
    }

    return {
      configured: true,
      ok: true,
      status: 200,
      verified: true,
      customerId,
      displayName,
    };
  } catch (error) {
    cachedSession = null;
    cachedSessionExpiresAt = 0;
    return {
      configured: true,
      ok: false,
      status: 502,
      verified: false,
      customerId,
      error: error.message || 'iRacing lookup failed.',
    };
  }
}
