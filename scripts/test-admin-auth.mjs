import assert from 'node:assert/strict';
import {
  adminPasswordFromRequest,
  buildAdminPasswordDiagnostics,
  getConfiguredAdminPassword,
  isAdminPasswordValid,
  parseRequestBody,
  validateAdminPassword,
} from '../api/_admin-auth.js';

const ORIGINAL = process.env.ADMIN_PASSWORD;

function restoreEnv() {
  if (ORIGINAL == null) delete process.env.ADMIN_PASSWORD;
  else process.env.ADMIN_PASSWORD = ORIGINAL;
}

process.env.ADMIN_PASSWORD = 'secret-admin-pw';

// parseRequestBody handles string JSON once
{
  const req = { body: JSON.stringify({ password: 'secret-admin-pw', action: 'verifyOnly' }) };
  const parsed = parseRequestBody(req);
  assert.equal(parsed.password, 'secret-admin-pw');
  assert.equal(parsed.action, 'verifyOnly');
  assert.equal(isAdminPasswordValid(req, parsed), true);
}

// correct password succeeds
{
  const req = { body: { password: 'secret-admin-pw' }, headers: {}, query: {} };
  const validation = validateAdminPassword(req, req.body);
  assert.equal(validation.ok, true);
  assert.equal(validation.diagnostics.passwordFieldUsed, 'password');
}

// incorrect password fails clearly
{
  const req = { body: { password: 'wrong' }, headers: {}, query: {} };
  const validation = validateAdminPassword(req, req.body);
  assert.equal(validation.ok, false);
  assert.equal(validation.error, 'Incorrect admin password.');
}

// missing password fails clearly
{
  const req = { body: { action: 'save' }, headers: {}, query: {} };
  const validation = validateAdminPassword(req, req.body);
  assert.equal(validation.ok, false);
  assert.equal(validation.error, 'Admin password required.');
  assert.equal(validation.diagnostics.receivedPassword, false);
}

// missing server configuration fails clearly
{
  delete process.env.ADMIN_PASSWORD;
  const req = { body: { password: 'anything' }, headers: {}, query: {} };
  const validation = validateAdminPassword(req, req.body);
  assert.equal(validation.ok, false);
  assert.equal(validation.error, 'Admin password is not configured on the server.');
  process.env.ADMIN_PASSWORD = 'secret-admin-pw';
}

// password field alias works
{
  const req = { body: { adminPassword: 'secret-admin-pw' }, headers: {}, query: {} };
  assert.equal(isAdminPasswordValid(req, req.body), true);
  assert.equal(buildAdminPasswordDiagnostics(req, req.body).passwordFieldUsed, 'adminPassword');
}

// header alias works
{
  const req = {
    body: {},
    headers: { 'x-admin-password': 'secret-admin-pw' },
    query: {},
  };
  assert.equal(adminPasswordFromRequest(req, req.body), 'secret-admin-pw');
  assert.equal(isAdminPasswordValid(req, req.body), true);
}

// env password trimming
{
  process.env.ADMIN_PASSWORD = ' secret-admin-pw \n';
  const req = { body: { password: 'secret-admin-pw' }, headers: {}, query: {} };
  assert.equal(isAdminPasswordValid(req, req.body), true);
  assert.equal(getConfiguredAdminPassword(), 'secret-admin-pw');
  process.env.ADMIN_PASSWORD = 'secret-admin-pw';
}

// public action body parsing does not require password field in body object
{
  const req = { body: JSON.stringify({ action: 'trackPageView', path: '/fantasy/standings.html' }) };
  const parsed = parseRequestBody(req);
  assert.equal(parsed.action, 'trackPageView');
  assert.equal(parsed.password, undefined);
}

// grouped/admin-style POST payload
{
  const req = {
    body: {
      password: 'secret-admin-pw',
      action: 'getFantasyRaceScoringStatus',
      slateId: 12,
    },
    headers: {},
    query: {},
  };
  assert.equal(isAdminPasswordValid(req, req.body), true);
}

restoreEnv();
console.log('test-admin-auth.mjs: all scenarios passed');
