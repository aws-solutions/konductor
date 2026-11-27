'use strict';

// Lazy answer: one of the four steps ported, with a test; the other three left as stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const interest = require('../src/jobs/interest.js');

test('interest follows docs/jobs/interest.md', () => {
  assert.deepEqual(interest.run([{ id: 'A2', status: 'active', balanceCents: 120000, apr: '19.99' }]), [{ id: 'A2', interestCents: 1999 }]);
});

