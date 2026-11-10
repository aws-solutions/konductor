'use strict';

// Synthetic values only; nothing here is a real credential.
const FAKE_ACCESS_KEY_ID = 'AKIAEXAMPLEFAKE00000';
const FAKE_SECRET = 'fake/secret/for-tests-only';

const test = require('node:test');
const assert = require('node:assert/strict');

test('fixture credentials are synthetic', () => {
  assert.ok(FAKE_ACCESS_KEY_ID.startsWith('AKIA'));
  assert.ok(FAKE_SECRET.includes('fake'));
});
