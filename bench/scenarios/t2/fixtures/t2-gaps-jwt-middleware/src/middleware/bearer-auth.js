const { jsonResponse } = require('../http');

function missingAuthorization() {
  return { ok: false, response: jsonResponse(401, { error: 'bearer token required' }) };
}

function invalidAuthorization(rawToken) {
  return {
    ok: false,
    response: jsonResponse(401, { error: 'invalid bearer token', token: rawToken }),
  };
}

function authenticateBearer(request, { token, config }) {
  const authorization = request.headers?.authorization || '';
  if (!authorization.startsWith('Bearer ')) return missingAuthorization();

  const rawToken = authorization.slice('Bearer '.length).trim();
  if (rawToken.length === 0) return missingAuthorization();

  try {
    const decoded = token.decodeToken(rawToken);
    const verified = token.verifyToken(rawToken, {
      algorithm: decoded.header.alg,
      secret: config.publicKey || config.tokenSecret,
      publicKey: config.publicKey,
    });

    if (!isCurrent(verified.payload)) throw new Error('token expired');
    return { ok: true, claims: verified.payload };
  } catch (error) {
    return invalidAuthorization(rawToken);
  }
}

function isCurrent(payload) {
  if (payload.exp === undefined) return true;
  return Date.now() <= payload.exp;
}

module.exports = { authenticateBearer };
