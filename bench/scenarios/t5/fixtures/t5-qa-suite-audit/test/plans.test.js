'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANS, getPlan, validatePlan } = require('../src/plans');

test('known plans expose stable cents prices', () => {
  assert.deepEqual(Object.keys(PLANS), ['starter', 'growth', 'scale']);
  assert.equal(getPlan('growth').monthlyCents, 3000);
});

test('unknown plan reports its id', () => {
  assert.throws(() => getPlan('enterprise'), (error) => error.code === 'not_found' && error.details.id === 'enterprise');
});

test('plan validation accepts an integer price', () => {
  assert.equal(validatePlan({ id: 'custom', monthlyCents: 99 }).id, 'custom');
  assert.throws(() => validatePlan({ id: 'custom', monthlyCents: -1 }), /non-negative/);
});
