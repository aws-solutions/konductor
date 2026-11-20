// Changes for this request; see the commit message for the reasoning.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { issueToken, getSession, TOKEN_TTL_MS, clearSessions } = require('../src/auth/session');
const { requireRole } = require('../src/auth/roles');
const { login } = require('../src/handlers/login');
const { getDocument, exportDocument, validateCreate } = require('../src/handlers/documents');
const { safeStorageName, downloadFile } = require('../src/storage/download');
const { validateDocumentInput, MAX_TITLE_LENGTH, MAX_BODY_LENGTH } = require('../src/validation/input');
const { renderDocumentExport } = require('../src/export/html');
const { LIMIT, recordFailure, recordSuccess, resetLimits } = require('../src/auth/rate-limit');
const { clearAudit, listAudit } = require('../src/audit-log');

function resetState() {
  clearSessions();
  resetLimits();
  clearAudit();
}

test.beforeEach(resetState);

test('a token is unusable at its exact expiry time', () => {
  const issuedAt = 5000;
  const token = issueToken({ id: 'u-editor', role: 'editor' }, issuedAt);
  assert.equal(getSession(token.token, issuedAt + TOKEN_TTL_MS), null);
});

test('a role name that resembles admin is still denied', () => {
  const result = requireRole({ user: { id: 'u-editor', role: 'administrator' } }, 'admin');
  assert.deepEqual(result, { ok: false, status: 403, error: 'Forbidden' });
});

test('an owner can read their document but another owner cannot', () => {
  const own = login({ body: { username: 'editor@example.test', password: 'editor-pass' } }, 100);
  const headers = { authorization: `Bearer ${own.body.token}` };
  assert.equal(getDocument({ headers, params: { id: 'notes-7' } }, 101).status, 200);
  assert.equal(getDocument({ headers, params: { id: 'handbook' } }, 101).status, 403);
});

test('dot-segment names are rejected before a file read', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'download-check-'));
  try {
    fs.writeFileSync(path.join(root, 'inside.txt'), 'inside');
    assert.equal(safeStorageName('folder/../inside.txt'), null);
    assert.equal(downloadFile(root, 'folder/../inside.txt').status, 400);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('encoded traversal is decoded and rejected', () => {
  assert.equal(safeStorageName('%2e%2e%2fprivate.txt'), null);
  assert.equal(safeStorageName('%2E%2E%5Cprivate.txt'), null);
});

test('absolute storage names are rejected', () => {
  const absolute = path.join(path.parse(process.cwd()).root, 'private.txt');
  assert.equal(path.isAbsolute(absolute), true);
  assert.equal(safeStorageName(absolute), null);
});

test('title limits include the exact allowed boundary', () => {
  const result = validateDocumentInput({ title: 't'.repeat(MAX_TITLE_LENGTH), body: 'ok' });
  assert.equal(result.ok, true);
  assert.deepEqual(validateDocumentInput({ title: 't'.repeat(MAX_TITLE_LENGTH + 1), body: 'ok' }).errors, ['title is too long']);
});

test('document input rejects wrong types and oversized bodies', () => {
  assert.equal(validateDocumentInput({ title: 'ok', body: 42 }).ok, false);
  assert.match(validateDocumentInput({ title: 'ok', body: 42 }).errors[0], /body/);
  assert.equal(validateDocumentInput({ title: 'ok', body: 'x'.repeat(MAX_BODY_LENGTH + 1) }).ok, false);
  assert.equal(validateCreate({ body: { title: 'ok', body: 'x'.repeat(MAX_BODY_LENGTH + 1) } }).status, 400);
});

test('exported titles escape markup characters', () => {
  const html = renderDocumentExport({ title: '<img src=x onerror=1> & "quoted"', body: 'plain' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&amp;/);
  assert.match(html, /&quot;quoted&quot;/);
});

test('login attempts lock at the limit and success clears the state', () => {
  assert.equal(recordFailure('person', 100).allowed, true);
  assert.equal(recordFailure('person', 101).allowed, true);
  assert.deepEqual(recordFailure('person', 102), { allowed: false, locked: true, remaining: 0 });
  assert.deepEqual(recordFailure('person', 103), { allowed: false, locked: true, remaining: 0 });
  recordSuccess('person');
  assert.deepEqual(recordFailure('person', 104), { allowed: true, locked: false, remaining: LIMIT - 1 });
});

test('the login handler reports a lockout and audits failures', () => {
  const bad = () => login({ body: { username: 'editor@example.test', password: 'wrong' } }, 200);
  assert.equal(bad().status, 401);
  assert.equal(bad().status, 401);
  assert.equal(bad().status, 429);
  assert.equal(login({ body: { username: 'editor@example.test', password: 'editor-pass' } }, 201).status, 429);
  assert.equal(listAudit().filter((entry) => entry.event === 'login_failure').length, 3);
});

test('expired bearer sessions are refused by document handlers', () => {
  const issued = issueToken({ id: 'u-admin', role: 'admin' }, 900);
  const response = getDocument({ headers: { authorization: `Bearer ${issued.token}` }, params: { id: 'handbook' } }, 900 + TOKEN_TTL_MS);
  assert.equal(response.status, 401);
});
