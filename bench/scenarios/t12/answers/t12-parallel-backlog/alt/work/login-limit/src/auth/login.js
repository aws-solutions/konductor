'use strict';

const config = require('../config');

const users = new Map([['ana@example.test', 'pw-ana']]);
const MINUTE = 60000;

// Per account: the failures counted since the first one of the current minute ({ since, count }).
const strikes = new Map();

function strikesOf(email, now) {
  const s = strikes.get(email);
  if (!s || now - s.since >= MINUTE) return { since: now, count: 0 };
  return s;
}

/** { ok, sessionTtlMinutes, locked? }. An account with maxFailedPerMinute failures this minute is locked until it ends. */
function login(email, password, now = Date.now()) {
  const max = Number(config.get('login.maxFailedPerMinute', 5));
  const sessionTtlMinutes = Number(config.get('session.ttlMinutes', 30));
  const s = strikesOf(email, now);
  if (s.count >= max) return { ok: false, locked: true, sessionTtlMinutes };
  const ok = users.get(email) === password;
  strikes.set(email, ok ? s : { since: s.since, count: s.count + 1 });
  return { ok, sessionTtlMinutes };
}

module.exports = { login };
