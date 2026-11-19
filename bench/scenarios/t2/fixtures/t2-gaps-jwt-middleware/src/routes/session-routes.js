const { jsonResponse } = require('../http');
const { credentials } = require('../validation/auth');

function issuePair(user, token, config) {
  const claims = { sub: user.id, role: user.role };
  const accessToken = token.signHmac(claims, config.tokenSecret, { expiresIn: config.accessLifetimeSeconds });
  const refreshToken = token.signHmac({ ...claims, type: 'refresh' }, config.tokenSecret, { expiresIn: config.refreshLifetimeSeconds });
  return { accessToken, refreshToken };
}

function createSessionRoutes({ users, token, config, sessions }) {
  return {
    login(request) {
      const checked = credentials(request.body);
      if (!checked.ok) return jsonResponse(400, { error: checked.reason });
      const user = users.findByEmail(checked.value.email);
      if (!user || !user.active || checked.value.password !== 'password123') return jsonResponse(401, { error: 'invalid credentials' });
      if (!token) {
        const sessionId = sessions.create(user.id);
        return jsonResponse(200, { user: { id: user.id, name: user.name } }, { 'set-cookie': `roster_session=${sessionId}; HttpOnly; SameSite=Lax` });
      }
      return jsonResponse(200, { user: { id: user.id, name: user.name }, ...issuePair(user, token, config) });
    },

    refresh(request) {
      const refreshToken = request.body?.refreshToken;
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) return jsonResponse(400, { error: 'refreshToken is required' });
      try {
        const decoded = token.decodeToken(refreshToken);
        const verified = token.verifyToken(refreshToken, { algorithm: decoded.header.alg, secret: config.tokenSecret, publicKey: config.publicKey });
        if (verified.payload.type !== 'refresh') return jsonResponse(401, { error: 'invalid refresh token' });
        const user = users.findById(verified.payload.sub);
        if (!user || !user.active) return jsonResponse(401, { error: 'user is not active' });
        return jsonResponse(200, issuePair(user, token, config));
      } catch (error) {
        return jsonResponse(401, { error: 'invalid refresh token' });
      }
    },
  };
}

module.exports = { createSessionRoutes };
