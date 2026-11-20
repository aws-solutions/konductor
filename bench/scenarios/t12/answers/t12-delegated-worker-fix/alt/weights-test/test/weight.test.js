'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWeight } = require('../src/weight.js');

test('3 lb is 1.361 kg', () => assert.equal(parseWeight('3 lb'), 1.361));
test('capital units from the new scales', () => {
  assert.deepEqual(['10 LB', '2 KG', '2 Kg', '750 G'].map(parseWeight), [4.536, 2, 2, 0.75]);
});
test('stone is still refused, in any case', () => {
  assert.throws(() => parseWeight('5 Stone'));
});
