'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../src/request');
const { manualClock } = require('../src/clock');

test('missing fields get defaults and the receive time comes from the clock', () => {
  const r = normalize({}, manualClock(5));
  assert.deepEqual(r, { method: 'GET', path: '/', query: {}, headers: {}, user: null, ip: null, receivedAt: 5 });
});

test('the method is upper-cased', () => {
  assert.equal(normalize({ method: 'post' }, manualClock(0)).method, 'POST');
});
