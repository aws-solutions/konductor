'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { join, offerNext } = require('../src/waitlist.js');

test('waitlist holds 5 and offers the first', () => {
  for (let i = 0; i < 5; i++) assert.equal(join('Birch', '2026-05-10', `g${i}`), true);
  assert.equal(join('Birch', '2026-05-10', 'g5'), false);
  assert.equal(offerNext('Birch', '2026-05-10', 0).guest, 'g0');
});
