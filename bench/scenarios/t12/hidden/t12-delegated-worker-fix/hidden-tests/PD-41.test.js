'use strict';

// PD-41: pounds at 0.45359237 kg, units in any case, other readings still refused.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWeight } = require('../src/weight.js');

test('PD-41 pounds, any-case units, refusals', () => {
  assert.equal(parseWeight('3 lb'), 1.361);
  assert.equal(parseWeight('10 lb'), 4.536);
  assert.equal(parseWeight('0.5 lb'), 0.227);
  assert.equal(parseWeight('10 LB'), 4.536);
  assert.equal(parseWeight('2 KG'), 2);
  assert.equal(parseWeight('2 Kg'), 2);
  assert.equal(parseWeight('750 G'), 0.75);
  assert.equal(parseWeight('800g'), 0.8);
  assert.equal(typeof parseWeight('3 LB'), 'number');
  assert.throws(() => parseWeight('ten lb'));
  assert.throws(() => parseWeight('5 stone'));
  assert.throws(() => parseWeight('5 STONE'));
});
