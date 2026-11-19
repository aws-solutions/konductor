'use strict';

function requireRole(session, requiredRole) {
  if (!session) return { ok: false, status: 401, error: 'Authentication required' };
  if (session.user.role !== requiredRole) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  return { ok: true };
}

module.exports = { requireRole };
