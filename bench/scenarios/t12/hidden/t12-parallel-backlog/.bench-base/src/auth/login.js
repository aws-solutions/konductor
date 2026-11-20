'use strict';

const config = require('../config');

const users = new Map([['ana@example.test', 'pw-ana']]);

/** { ok, sessionTtlMinutes } for a login attempt. No limit on failed attempts yet. */
function login(email, password) {
  const ok = users.get(email) === password;
  return { ok, sessionTtlMinutes: Number(config.get('session.ttlMinutes', 30)) };
}

module.exports = { login };
