'use strict';

// Fills in the fields every handler can rely on.
function normalize(raw = {}, clock) {
  return {
    method: String(raw.method || 'GET').toUpperCase(),
    path: raw.path || '/',
    query: raw.query || {},
    headers: raw.headers || {},
    user: raw.user ?? null,
    ip: raw.ip ?? null,
    receivedAt: clock.now(),
  };
}

module.exports = { normalize };
