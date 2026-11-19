'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertUserId, assertPayload } = require('../src/validators');

test('validators accept ordinary input', () => {
  assert.equal(assertUserId('ada'), 'ada');
  assert.deepEqual(assertPayload({ ok: true }, 100), { ok: true });
});

test('validators reject blank users and large payloads', () => {
  assert.throws(() => assertUserId(' '), /userId/);
  assert.throws(() => assertPayload({ text: '12345' }, 5), /too large/);
});
