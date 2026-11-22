'use strict';

const crypto = require('node:crypto');

const REFRESH_PREFIX = 'r_';

function createOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function createRefreshToken() {
  return `${REFRESH_PREFIX}${createOpaqueToken(32)}`;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function tokensEqual(left, right) {
  const a = Buffer.from(digest(left), 'hex');
  const b = Buffer.from(digest(right), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSessionToken() {
  return createOpaqueToken(24);
}

module.exports = { createOpaqueToken, createRefreshToken, createSessionToken, digest, tokensEqual };
