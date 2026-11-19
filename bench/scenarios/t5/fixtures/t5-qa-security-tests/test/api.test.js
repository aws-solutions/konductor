'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { login } = require('../src/handlers/login');
const { getDocument, exportDocument, validateCreate } = require('../src/handlers/documents');
const { download } = require('../src/handlers/download');
const { clearSessions } = require('../src/auth/session');
const { resetLimits } = require('../src/auth/rate-limit');
const { clearAudit, listAudit } = require('../src/audit-log');

function reset() {
  clearSessions();
  resetLimits();
  clearAudit();
}

function adminLogin() {
  const response = login({ body: { username: 'admin@example.test', password: 'admin-pass' } }, 1000);
  assert.equal(response.status, 200);
  return response.body.token;
}

test.beforeEach(reset);

test('an administrator can read and export a document', () => {
  const token = adminLogin();
  const request = { headers: { authorization: `Bearer ${token}` }, params: { id: 'handbook' } };
  const document = getDocument(request, 1001);
  assert.equal(document.status, 200);
  assert.equal(document.body.title, 'Operations handbook');
  const exported = exportDocument(request, 1001);
  assert.equal(exported.status, 200);
  assert.match(exported.body, /Operations handbook/);
  assert.equal(exported.contentType, 'text/html');
});

test('the create validator accepts an ordinary document', () => {
  assert.deepEqual(validateCreate({ body: { title: 'Weekly note', body: 'A short note.' } }), { status: 204 });
});

test('an administrator can download a stored report', () => {
  const token = adminLogin();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-api-'));
  try {
    fs.writeFileSync(path.join(dir, 'report.txt'), 'quarterly report');
    const result = download({ headers: { authorization: `Bearer ${token}` }, params: { name: 'report.txt' } }, dir, 1001);
    assert.deepEqual(result, { status: 200, body: 'quarterly report' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a successful login records a useful audit entry', () => {
  adminLogin();
  const entries = listAudit();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'login_success');
  assert.equal(entries[0].details.userId, 'u-admin');
  assert.equal(typeof entries[0].at, 'string');
});
