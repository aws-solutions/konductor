'use strict';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const sessions = new Map();
let sequence = 0;

function issueToken(user, now = Date.now()) {
  const token = `sess-${++sequence}-${user.id}`;
  const expiresAt = now + TOKEN_TTL_MS;
  sessions.set(token, { user: { ...user }, issuedAt: now, expiresAt });
  return { token, expiresAt };
}

function getSession(token, now = Date.now()) {
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= now) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function revokeToken(token) {
  return sessions.delete(token);
}

function clearSessions() {
  sessions.clear();
  sequence = 0;
}

module.exports = { TOKEN_TTL_MS, issueToken, getSession, revokeToken, clearSessions };
