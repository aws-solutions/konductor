'use strict';

const config = require('../config');

const users = new Map([['ana@example.test', 'pw-ana']]);
const WINDOW_MS = 60000;
const failures = new Map(); // email -> times of failed logins in the last minute

/** { ok, sessionTtlMinutes, reason? } for a login attempt; refused once the account has too many recent failures. */
function login(email, password, now = Date.now()) {
  const limit = Number(config.get('login.maxFailedPerMinute', 5));
  const recent = (failures.get(email) || []).filter((t) => now - t < WINDOW_MS);
  failures.set(email, recent);
  const sessionTtlMinutes = Number(config.get('session.ttlMinutes', 30));
  if (recent.length >= limit) return { ok: false, reason: 'too_many_attempts', sessionTtlMinutes };
  const ok = users.get(email) === password;
  if (!ok) recent.push(now);
  return { ok, sessionTtlMinutes };
}

module.exports = { login };
