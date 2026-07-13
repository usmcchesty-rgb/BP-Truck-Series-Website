export function parseRequestBody(req) {
  let raw;
  try {
    raw = req?.body;
  } catch {
    return {};
  }

  if (raw == null || raw === '') return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    return raw;
  }
  return {};
}

export function getConfiguredAdminPassword() {
  const value = process.env.ADMIN_PASSWORD;
  if (value == null || value === '') return '';
  return String(value).trim();
}

export function adminPasswordFromRequest(req, body = {}) {
  const parsedBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  return String(
    parsedBody.password ??
      parsedBody.adminPassword ??
      req?.query?.password ??
      req?.headers?.['x-admin-password'] ??
      req?.headers?.['X-Admin-Password'] ??
      '',
  ).trim();
}

export function resolveAdminPasswordField(req, body = {}) {
  const parsedBody = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (parsedBody.password != null && String(parsedBody.password).length) {
    return { field: 'password', value: String(parsedBody.password).trim() };
  }
  if (parsedBody.adminPassword != null && String(parsedBody.adminPassword).length) {
    return { field: 'adminPassword', value: String(parsedBody.adminPassword).trim() };
  }
  if (req?.query?.password) {
    return { field: 'query.password', value: String(req.query.password).trim() };
  }
  const header =
    req?.headers?.['x-admin-password'] ?? req?.headers?.['X-Admin-Password'] ?? '';
  if (header) {
    return { field: 'x-admin-password', value: String(header).trim() };
  }
  return { field: null, value: '' };
}

export function buildAdminPasswordDiagnostics(req, body = {}) {
  const resolved = resolveAdminPasswordField(req, body);
  const supplied = adminPasswordFromRequest(req, body);
  return {
    adminPasswordConfigured: Boolean(getConfiguredAdminPassword()),
    receivedPassword: Boolean(supplied),
    receivedPasswordLength: supplied.length,
    passwordFieldUsed: resolved.field,
  };
}

export function validateAdminPassword(req, body = {}) {
  const configured = getConfiguredAdminPassword();
  const supplied = adminPasswordFromRequest(req, body);
  const diagnostics = buildAdminPasswordDiagnostics(req, body);

  if (!configured) {
    return {
      ok: false,
      error: 'Admin password is not configured on the server.',
      diagnostics,
    };
  }
  if (!supplied) {
    return {
      ok: false,
      error: 'Admin password required.',
      diagnostics,
    };
  }
  if (supplied !== configured) {
    return {
      ok: false,
      error: 'Incorrect admin password.',
      diagnostics,
    };
  }
  return { ok: true, diagnostics };
}

export function isAdminPasswordValid(req, body = {}) {
  return validateAdminPassword(req, body).ok;
}

export function adminAuthFailurePayload(validation) {
  return {
    error: validation.error,
    adminPasswordConfigured: validation.diagnostics?.adminPasswordConfigured ?? false,
    receivedPassword: validation.diagnostics?.receivedPassword ?? false,
    receivedPasswordLength: validation.diagnostics?.receivedPasswordLength ?? 0,
    passwordFieldUsed: validation.diagnostics?.passwordFieldUsed ?? null,
  };
}

export function requireAdminPassword(req, res, body = {}) {
  const validation = validateAdminPassword(req, body);
  if (validation.ok) return validation;
  res.status(401).json(adminAuthFailurePayload(validation));
  return null;
}
