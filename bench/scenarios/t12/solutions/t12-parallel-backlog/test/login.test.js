'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { login } = require('../src/auth/login');

const HOUR = 3600000;

test('five failed logins in a minute block the sixth attempt, even with the right password', () => {
  const t = 10 * HOUR;
  for (let i = 0; i < 5; i++) assert.equal(login('ana@example.test', 'wrong', t + i).ok, false);
  const r = login('ana@example.test', 'pw-ana', t + 10);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_many_attempts');
});

test('four failures still let the right password in, and old failures expire after a minute', () => {
  const t = 20 * HOUR;
  for (let i = 0; i < 4; i++) login('ana@example.test', 'wrong', t + i);
  assert.equal(login('ana@example.test', 'pw-ana', t + 10).ok, true);
  for (let i = 0; i < 5; i++) login('ana@example.test', 'wrong', t + 100 + i);
  assert.equal(login('ana@example.test', 'pw-ana', t + 100 + 61000).ok, true);
});
