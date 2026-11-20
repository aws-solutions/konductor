'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normaliseHeaders, hasHeader } = require('../src/headers');

test('normalises names and joins repeated values', () => {
  assert.deepEqual(normaliseHeaders({ 'X-Mode': 'fast', Accept: ['a', 'b'] }), { 'x-mode': 'fast', accept: 'a, b' });
});

test('checks headers without case sensitivity', () => {
  assert.equal(hasHeader({ 'X-Request': '1' }, 'x-request'), true);
  assert.equal(hasHeader({}, 'x-request'), false);
});
