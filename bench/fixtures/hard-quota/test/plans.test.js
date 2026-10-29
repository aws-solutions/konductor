'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlans, resolvePlan } = require('../src');

test('loadPlans lists the known plans', () => {
  assert.deepEqual(Object.keys(loadPlans()).sort(), ['free', 'internal', 'pro']);
});

test('resolvePlan returns the limits of a plan', () => {
  const free = resolvePlan('free');
  assert.equal(free.minute, 10);
  assert.equal(free.day, 200);
});

test('resolvePlan rejects unknown plans', () => {
  assert.throws(() => resolvePlan('gold'), /gold/);
});
