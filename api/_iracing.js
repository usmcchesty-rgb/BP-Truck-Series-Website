import crypto from 'crypto';

const IRACING_TOKEN_URL = 'https://oauth.iracing.com/oauth2/token';
const IRACING_DATA_BASE = 'https://members-ng.iracing.com/data';
const DEFAULT_SCOPE = 'iracing.auth';
const ACCESS_TOKEN_BUFFER_MS = 30 * 1000;

/**
 * Optional in-memory token cache for warm serverless invocations only.
 * Never rely on this across cold starts; each invocation must be able to
 * obtain a fresh token via Password Limited or Refresh Token grant.
 *
 * @type {{
 *   accessToken: string;
 *   accessTokenExpiresAt: number;
 *   refreshToken: string | null;
 *   refreshTokenExpiresAt: number;
 * } | null}
 */
let optionalTokenCache = null;

export const IRACING_ERROR = {
  MISSING_OAUTH_CONFIG: 'MISSING_OAUTH_CONFIG',
  TOKEN_REQUEST_FAILED: 'TOKEN_REQUEST_FAILED',
  INVALID_CUSTOMER_ID: 'INVALID_CUSTOMER_ID',
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

export function getIracingOAuthConfig() {
  return {
    clientId: readEnv('IRACING_CLIENT_ID'),
    clientSecret: readEnv('IRACING_CLIENT_SECRET'),
    email: readEnv('IRACING_EMAIL') || readEnv('IRACING_USERNAME'),
    password: readEnv('IRACING_PASSWORD'),
    scope: readEnv('IRACING_SCOPE') || DEFAULT_SCOPE,
  };
}

export function isIracingConfigured() {
  const { clientId, clientSecret, email, password } = getIracingOAuthConfig();
  return Boolean(clientId && clientSecret && email && password);
}

export function normalizeCustomerId(value) {
  return String(value ?? '').trim().replace(/\D/g, '');
}

/**
 * iRacing OAuth masking algorithm.
 * base64( sha256( secret + normalizedIdentifier ) )
 *
 * - client_secret is masked with client_id
 * - user password is masked with username (email)
 *
 * @see https://oauth.iracing.com/oauth2/book/token_endpoint.html
 */
export function maskIracingSecret(secret, identifier) {
  const normalizedId = String(identifier || '').trim().toLowerCase();
  const digest = crypto.createHash('sha256').update(`${secret}${normalizedId}`, 'utf8').digest();
  return digest.toString('base64');
}

function clearOptionalTokenCache() {
  optionalTokenCache = null;
}

function storeTokenSet(tokenSet) {
  const now = Date.now();
  const accessExpiresIn = Number(tokenSet.expires_in);
  const refreshExpiresIn = Number(tokenSet.refresh_token_expires_in);

  optionalTokenCache = {
    accessToken: String(tokenSet.access_token || ''),
    accessTokenExpiresAt:
      now + (Number.isFinite(accessExpiresIn) ? accessExpiresIn * 1000 : 600_000),
    refreshToken: tokenSet.refresh_token ? String(tokenSet.refresh_token) : null,
    refreshTokenExpiresAt:
      tokenSet.refresh_token && Number.isFinite(refreshExpiresIn)
        ? now + refreshExpiresIn * 1000
        : 0,
  };
}

function getCachedAccessToken() {
  if (!optionalTokenCache?.accessToken) return null;
  if (optionalTokenCache.accessTokenExpiresAt - ACCESS_TOKEN_BUFFER_MS <= Date.now()) {
    return null;
  }
  return optionalTokenCache.accessToken;
}

function getCachedRefreshToken() {
  if (!optionalTokenCache?.refreshToken) return null;
  if (optionalTokenCache.refreshTokenExpiresAt <= Date.now()) return null;
  return optionalTokenCache.refreshToken;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function tokenErrorMessage(body, fallback) {
  if (!body) return fallback;
  if (typeof body.error_description === 'string' && body.error_description.trim()) {
    return body.error_description.trim();
  }
  if (typeof body.error === 'string' && body.error.trim()) {
    return body.error.trim();
  }
  if (typeof body.message === 'string' && body.message.trim()) {
    return body.message.trim();
  }
  return fallback;
}

async function requestOAuthToken(params) {
  const body = new URLSearchParams(params);

  let response;
  try {
    response = await fetch(IRACING_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
  } catch (error) {
    throw new IracingApiError(
      IRACING_ERROR.API_UNAVAILABLE,
      'Unable to reach iRacing OAuth token endpoint.',
      502,
      { cause: error.message }
    );
  }

  const payload = await parseJsonResponse(response);
  if (!response.ok || !payload?.access_token) {
    throw new IracingApiError(
      IRACING_ERROR.TOKEN_REQUEST_FAILED,
      tokenErrorMessage(payload, `iRacing OAuth token request failed (${response.status}).`),
      response.status === 401 ? 401 : 502,
      {
        status: response.status,
        body: payload,
        retryAfter: response.headers.get('retry-after'),
      }
    );
  }

  storeTokenSet(payload);
  return payload.access_token;
}

async function requestPasswordLimitedToken() {
  if (!isIracingConfigured()) {
    throw new IracingApiError(
      IRACING_ERROR.MISSING_OAUTH_CONFIG,
      'Missing IRACING_CLIENT_ID, IRACING_CLIENT_SECRET, IRACING_EMAIL, and/or IRACING_PASSWORD.',
      503
    );
  }

  const { clientId, clientSecret, email, password, scope } = getIracingOAuthConfig();
  return requestOAuthToken({
    grant_type: 'password_limited',
    client_id: clientId,
    client_secret: maskIracingSecret(clientSecret, clientId),
    username: email,
    password: maskIracingSecret(password, email),
    scope,
  });
}

async function requestRefreshToken(refreshToken) {
  const { clientId, clientSecret } = getIracingOAuthConfig();
  if (!clientId || !clientSecret) {
    throw new IracingApiError(
      IRACING_ERROR.MISSING_OAUTH_CONFIG,
      'Missing IRACING_CLIENT_ID and/or IRACING_CLIENT_SECRET.',
      503
    );
  }

  return requestOAuthToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: maskIracingSecret(clientSecret, clientId),
    refresh_token: refreshToken,
  });
}

export async function getIracingAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = getCachedAccessToken();
    if (cached) return cached;
  }

  if (!forceRefresh) {
    const refreshToken = getCachedRefreshToken();
    if (refreshToken) {
      try {
        return await requestRefreshToken(refreshToken);
      } catch (error) {
        clearOptionalTokenCache();
        if (!(error instanceof IracingApiError)) throw error;
        if (
          error.code !== IRACING_ERROR.TOKEN_REQUEST_FAILED &&
          error.code !== IRACING_ERROR.API_UNAVAILABLE
        ) {
          throw error;
        }
      }
    }
  } else {
    clearOptionalTokenCache();
  }

  return requestPasswordLimitedToken();
}

export async function fetchIracingData(path, params = {}, options = {}) {
  const accessToken = await getIracingAccessToken({
    forceRefresh: options.forceRefresh === true,
  });
  const url = new URL(`${IRACING_DATA_BASE}/${String(path || '').replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  async function request(token, retriedAuth = false) {
    let metaResponse;
    try {
      metaResponse = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (error) {
      throw new IracingApiError(
        IRACING_ERROR.API_UNAVAILABLE,
        'Unable to reach iRacing data API.',
        502,
        { cause: error.message }
      );
    }

    const meta = await parseJsonResponse(metaResponse);

    if (metaResponse.status === 401 && !retriedAuth) {
      clearOptionalTokenCache();
      const refreshedToken = await getIracingAccessToken({ forceRefresh: true });
      return request(refreshedToken, true);
    }

    if (!metaResponse.ok) {
      throw new IracingApiError(
        IRACING_ERROR.API_UNAVAILABLE,
        tokenErrorMessage(meta, `iRacing data request failed (${metaResponse.status}).`),
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
      dataResponse = await fetch(meta.link, {
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      throw new IracingApiError(
        IRACING_ERROR.API_UNAVAILABLE,
        'Unable to fetch iRacing result payload.',
        502,
        { cause: error.message }
      );
    }

    const payload = await parseJsonResponse(dataResponse);
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

  return request(accessToken);
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
      auth: 'oauth2_password_limited',
      topLevelKeys: Object.keys(member).slice(0, 24),
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
      IRACING_ERROR.MISSING_OAUTH_CONFIG,
      'Missing IRACING_CLIENT_ID, IRACING_CLIENT_SECRET, IRACING_EMAIL, and/or IRACING_PASSWORD.',
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
    if (error instanceof IracingApiError && error.code === IRACING_ERROR.TOKEN_REQUEST_FAILED) {
      clearOptionalTokenCache();
    }

    if (error instanceof IracingApiError) {
      throw error;
    }

    clearOptionalTokenCache();
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
      configured: error.code !== IRACING_ERROR.MISSING_OAUTH_CONFIG,
      ok: false,
      status: error.status,
      verified: false,
      customerId,
      error: error.message,
      code: error.code,
      details: error.details,
    };

    if (error.code === IRACING_ERROR.MISSING_OAUTH_CONFIG) {
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

/** @deprecated Use getIracingAccessToken() */
export const authenticateIracing = getIracingAccessToken;

/** @deprecated Use getIracingOAuthConfig() */
export const getIracingCredentials = getIracingOAuthConfig;

/** @deprecated Use maskIracingSecret() */
export const hashLegacyIracingPassword = (password, email) =>
  maskIracingSecret(password, email);
