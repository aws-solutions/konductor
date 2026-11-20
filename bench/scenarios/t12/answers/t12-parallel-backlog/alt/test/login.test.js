'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { login } = require('../src/auth/login');

test('the account locks after maxFailedPerMinute (5) failures and opens again a minute later', () => {
  const t0 = 1_000_000;
  for (let i = 1; i <= 4; i++) assert.equal(login('ana@example.test', 'nope', t0 + i).ok, false);
  assert.equal(login('ana@example.test', 'nope', t0 + 5).locked, undefined);
  assert.equal(login('ana@example.test', 'pw-ana', t0 + 6).locked, true);
  assert.equal(login('ana@example.test', 'pw-ana', t0 + 60001).ok, true);
});
