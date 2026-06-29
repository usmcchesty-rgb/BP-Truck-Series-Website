import crypto from 'crypto';

const IRACING_AUTH_URL = 'https://members-ng.iracing.com/auth';
const IRACING_DATA_BASE = 'https://members-ng.iracing.com/data';
const SESSION_TTL_MS = 15 * 60 * 1000;

/** @type {{ cookieHeader: string, expiresAt: number } | null} */
let cachedSession = null;

export const IRACING_ERROR = {
  MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
  INVALID_CUSTOMER_ID: 'INVALID_CUSTOMER_ID',
  LOGIN_FAILED: 'LOGIN_FAILED',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  API_UNAVAILABLE: 'API_UNAVAILABLE',
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
};

export class IracingApiError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = 'IracingApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

export function getIracingCredentials() {
  return {
    email: readEnv('IRACING_EMAIL') || readEnv('IRACING_USERNAME'),
    password: readEnv('IRACING_PASSWORD'),
    totp: readEnv('IRACING_TOTP'),
  };
}

export function isIracingConfigured() {
  const { email, password } = getIracingCredentials();
  return Boolean(email && password);
}

export function normalizeCustomerId(value) {
  return String(value ?? '').trim().replace(/\D/g, '');
}

/**
 * Legacy members-ng login password encoding (required since late 2024).
 *
 * Steps per iRacing legacy auth documentation:
 * 1. Lowercase the account email.
 * 2. Concatenate: plainPassword + lowercasedEmail (password first, email second).
 * 3. SHA-256 hash the concatenated string (binary digest).
 * 4. Base64-encode the digest and send that value as the JSON `password` field.
 *
 * IRACING_PASSWORD must be the plain account password in Vercel env vars.
 * This helper performs the hash before transmission; never store/send plain text
 * from application code outside this function.
 */
export function hashLegacyIracingPassword(password, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const digest = crypto.createHash('sha256').update(`${password}${normalizedEmail}`, 'utf8').digest();
  return digest.toString('base64');
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

function clearSessionCache() {
  cachedSession = null;
}

export async function authenticateIracing() {
  if (!isIracingConfigured()) {
    throw new IracingApiError(
      IRACING_ERROR.MISSING_CREDENTIALS,
      'Missing IRACING_EMAIL and/or IRACING_PASSWORD environment variables.',
      503
    );
  }

  const now = Date.now();
  if (cachedSession && cachedSession.expiresAt > now) {
    return cachedSession.cookieHeader;
  }

  const { email, password, totp } = getIracingCredentials();
  const hashedPassword = hashLegacyIracingPassword(password, email);

  let response;
  try {
    response = await fetch(IRACING_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: hashedPassword,
        totp,
      }),
    });
  } catch (error) {
    throw new IracingApiError(
      IRACING_ERROR.API_UNAVAILABLE,
      'Unable to reach iRacing authentication service.',
      502,
      { cause: error.message }
    );
  }

  let authBody = null;
  try {
    authBody = await response.json();
  } catch {
    authBody = null;
  }

  if (!response.ok) {
    throw new IracingApiError(
      IRACING_ERROR.LOGIN_FAILED,
      authBody?.message || authBody?.error || `iRacing authentication failed (${response.status}).`,
      response.status === 401 ? 401 : 502,
      { status: response.status, body: authBody }
    );
  }

  const cookieHeader = extractCookieHeader(response);
  if (!cookieHeader) {
    throw new IracingApiError(
      IRACING_ERROR.LOGIN_FAILED,
      'iRacing authentication succeeded but no session cookie was returned.',
      502,
      { body: authBody }
    );
  }

  cachedSession = {
    cookieHeader,
    expiresAt: now + SESSION_TTL_MS,
  };
  return cookieHeader;
}

export async function fetchIracingData(path, params = {}) {
  const cookieHeader = await authenticateIracing();
  const url = new URL(`${IRACING_DATA_BASE}/${String(path || '').replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  let metaResponse;
  try {
    metaResponse = await fetch(url, {
      headers: { Cookie: cookieHeader },
    });
  } catch (error) {
    throw new IracingApiError(
      IRACING_ERROR.API_UNAVAILABLE,
      'Unable to reach iRacing data API.',
      502,
      { cause: error.message }
    );
  }

  let meta = null;
  try {
    meta = await metaResponse.json();
  } catch {
    meta = null;
  }

  if (!metaResponse.ok) {
    throw new IracingApiError(
      IRACING_ERROR.API_UNAVAILABLE,
      meta?.message || meta?.error || `iRacing data request failed (${metaResponse.status}).`,
      metaResponse.status >= 500 ? 502 : metaResponse.status,
      { status: metaResponse.status, body: meta }
    );
  }

  if (!meta?.link) {
    throw new IracingApiError(
      IRACING_ERROR.UNEXPECTED_RESPONSE,
      'iRacing data response did not include a result link.',
      502,
      { body: meta }
    );
  }

  let dataResponse;
  try {
    dataResponse = await fetch(meta.link);
  } catch (error) {
    throw new IracingApiError(
      IRACING_ERROR.API_UNAVAILABLE,
      'Unable to fetch iRacing result payload.',
      502,
      { cause: error.message }
    );
  }

  let payload = null;
  try {
    payload = await dataResponse.json();
  } catch {
    payload = null;
  }

  if (!dataResponse.ok) {
    throw new IracingApiError(
      IRACING_ERROR.API_UNAVAILABLE,
      `iRacing result fetch failed (${dataResponse.status}).`,
      502,
      { status: dataResponse.status, body: payload }
    );
  }

  return payload;
}

function pickMemberObject(payload, customerId) {
  if (!payload || typeof payload !== 'object') return null;

  const keyed = payload[customerId] ?? payload[String(Number(customerId))];
  if (keyed && typeof keyed === 'object' && !Array.isArray(keyed)) return keyed;

  if (Array.isArray(payload.members)) {
    return (
      payload.members.find(
        (row) => String(row?.cust_id ?? row?.customer_id ?? row?.custId) === customerId
      ) || null
    );
  }

  if (Array.isArray(payload.data)) {
    return (
      payload.data.find(
        (row) => String(row?.cust_id ?? row?.customer_id ?? row?.custId) === customerId
      ) || null
    );
  }

  const objectValues = Object.values(payload).filter(
    (value) => value && typeof value === 'object' && !Array.isArray(value)
  );
  if (objectValues.length === 1) return objectValues[0];

  return (
    objectValues.find(
      (row) => String(row?.cust_id ?? row?.customer_id ?? row?.custId) === customerId
    ) || null
  );
}

function normalizeMemberRecord(member, customerId) {
  if (!member || typeof member !== 'object') return null;

  const displayName = String(
    member.display_name || member.displayName || member.name || member.username || ''
  ).trim();
  if (!displayName) return null;

  const clubName = String(
    member.club_name || member.clubName || member.club || member.affiliate_name || ''
  ).trim();

  const memberSinceRaw =
    member.member_since ||
    member.memberSince ||
    member.created ||
    member.created_at ||
    member.registration_date ||
    null;

  return {
    customer_id: String(member.cust_id ?? member.customer_id ?? member.custId ?? customerId),
    display_name: displayName,
    club_name: clubName || null,
    member_since: memberSinceRaw ? String(memberSinceRaw) : null,
    debug: {
      topLevelKeys: member && typeof member === 'object' ? Object.keys(member).slice(0, 24) : [],
      cust_id: member.cust_id ?? member.customer_id ?? member.custId ?? null,
      display_name: member.display_name ?? member.displayName ?? null,
      club_name: member.club_name ?? member.clubName ?? null,
      member_since: memberSinceRaw,
    },
  };
}

export async function getIracingMember(customerIdInput) {
  const customerId = normalizeCustomerId(customerIdInput);
  if (!customerId || !/^\d+$/.test(customerId)) {
    throw new IracingApiError(
      IRACING_ERROR.INVALID_CUSTOMER_ID,
      'Customer ID must be numeric.',
      400,
      { customerId: customerIdInput }
    );
  }

  if (!isIracingConfigured()) {
    throw new IracingApiError(
      IRACING_ERROR.MISSING_CREDENTIALS,
      'Missing IRACING_EMAIL and/or IRACING_PASSWORD environment variables.',
      503
    );
  }

  try {
    const payload = await fetchIracingData('member/get', { cust_ids: customerId });
    const member = pickMemberObject(payload, customerId);

    if (!member) {
      throw new IracingApiError(
        IRACING_ERROR.MEMBER_NOT_FOUND,
        'No iRacing member was found for this Customer ID.',
        404,
        {
          customerId,
          topLevelKeys:
            payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 24) : [],
        }
      );
    }

    const normalized = normalizeMemberRecord(member, customerId);

    if (!normalized) {
      throw new IracingApiError(
        IRACING_ERROR.UNEXPECTED_RESPONSE,
        'iRacing returned an unexpected member payload shape.',
        502,
        {
          customerId,
          topLevelKeys: Object.keys(member).slice(0, 24),
        }
      );
    }

    return {
      ok: true,
      configured: true,
      ...normalized,
    };
  } catch (error) {
    clearSessionCache();

    if (error instanceof IracingApiError) {
      throw error;
    }

    throw new IracingApiError(
      IRACING_ERROR.API_UNAVAILABLE,
      error.message || 'iRacing lookup failed.',
      502
    );
  }
}

/**
 * Backward-compatible wrapper used by the Join application flow.
 */
export async function lookupIracingMember(customerIdInput) {
  try {
    const result = await getIracingMember(customerIdInput);
    return {
      configured: true,
      ok: true,
      status: 200,
      verified: true,
      customerId: result.customer_id,
      displayName: result.display_name,
    };
  } catch (error) {
    if (!(error instanceof IracingApiError)) {
      return {
        configured: isIracingConfigured(),
        ok: false,
        status: 502,
        verified: false,
        customerId: normalizeCustomerId(customerIdInput),
        error: error.message || 'iRacing lookup failed.',
      };
    }

    const customerId = normalizeCustomerId(customerIdInput);
    const base = {
      configured: error.code !== IRACING_ERROR.MISSING_CREDENTIALS,
      ok: false,
      status: error.status,
      verified: false,
      customerId,
      error: error.message,
      code: error.code,
      details: error.details,
    };

    if (error.code === IRACING_ERROR.MISSING_CREDENTIALS) {
      return {
        ...base,
        configured: false,
        error:
          'iRacing lookup is not configured on the server yet. Enter your display name manually.',
      };
    }

    if (error.code === IRACING_ERROR.MEMBER_NOT_FOUND) {
      return {
        ...base,
        status: 404,
        error: 'No iRacing member was found for this Customer ID.',
      };
    }

    return base;
  }
}

export const isIracingLookupConfigured = isIracingConfigured;
