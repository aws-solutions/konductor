'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpaqueToken, createRefreshToken, digest, tokensEqual } = require('../src/token-service');

test('creates URL-safe opaque tokens', () => {
  const token = createOpaqueToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 32);
});

test('labels refresh tokens without reducing their random payload', () => {
  const token = createRefreshToken();
  assert.match(token, /^r_[A-Za-z0-9_-]{40,}$/);
});

test('digests and compares token values', () => {
  assert.equal(digest('abc').length, 64);
  assert.equal(tokensEqual('abc', 'abc'), true);
  assert.equal(tokensEqual('abc', 'abd'), false);
});
