function requireRole(role) {
  return function roleGuard(request) {
    const claims = request.auth;
    if (!claims || claims.role !== role) {
      return { ok: false, status: 403, body: { error: 'required role is missing' } };
    }
    return { ok: true };
  };
}

module.exports = { requireRole };
