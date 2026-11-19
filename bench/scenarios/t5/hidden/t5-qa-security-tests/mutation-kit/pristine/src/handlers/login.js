'use strict';

const { issueToken } = require('../auth/session');
const { checkLogin, recordFailure, recordSuccess } = require('../auth/rate-limit');
const { recordAudit } = require('../audit-log');

const users = new Map([
  ['admin@example.test', { id: 'u-admin', role: 'admin', password: 'admin-pass' }],
  ['editor@example.test', { id: 'u-editor', role: 'editor', password: 'editor-pass' }],
  ['reviewer@example.test', { id: 'u-reviewer', role: 'reviewer', password: 'reviewer-pass' }],
]);

function login(request, now = Date.now()) {
  const input = request && request.body;
  const username = input && input.username;
  const gate = checkLogin(username, now);
  if (!gate.allowed) return { status: 429, error: 'Too many attempts' };
  const user = users.get(username);
  if (!user || user.password !== (input && input.password)) {
    const failure = recordFailure(username, now);
    recordAudit('login_failure', { username });
    return { status: failure.locked ? 429 : 401, error: failure.locked ? 'Too many attempts' : 'Invalid credentials' };
  }
  recordSuccess(username);
  const token = issueToken({ id: user.id, role: user.role }, now);
  recordAudit('login_success', { username, userId: user.id });
  return { status: 200, body: token };
}

module.exports = { login, users };
