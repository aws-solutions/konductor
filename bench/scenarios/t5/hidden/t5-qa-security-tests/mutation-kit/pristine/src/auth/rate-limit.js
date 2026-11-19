'use strict';

const LIMIT = 3;
const WINDOW_MS = 60 * 1000;
const attempts = new Map();

function checkLogin(identifier, now = Date.now()) {
  let state = attempts.get(identifier);
  if (state && now - state.startedAt >= WINDOW_MS) {
    attempts.delete(identifier);
    state = undefined;
  }
  if (!state) {
    state = { failures: 0, startedAt: now };
    attempts.set(identifier, state);
  }
  if (state.failures >= LIMIT) return { allowed: false, locked: true, remaining: 0 };
  return { allowed: true, locked: false, remaining: LIMIT - state.failures };
}

function recordFailure(identifier, now = Date.now()) {
  const status = checkLogin(identifier, now);
  if (!status.allowed) return status;
  const state = attempts.get(identifier);
  state.failures += 1;
  return { allowed: state.failures < LIMIT, locked: state.failures >= LIMIT, remaining: Math.max(0, LIMIT - state.failures) };
}

function recordSuccess(identifier) {
  attempts.delete(identifier);
}

function resetLimits() {
  attempts.clear();
}

module.exports = { LIMIT, WINDOW_MS, checkLogin, recordFailure, recordSuccess, resetLimits };
