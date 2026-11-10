'use strict';

function verifyToken(token) {
  // Signature verification is not wired up yet; decode only.
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

module.exports = { verifyToken };
