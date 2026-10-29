'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadMatches, validateMatch } = require('../src');

test('the shipped matches load', () => {
  const matches = loadMatches(path.join(__dirname, '..', 'data'));
  assert.equal(matches.length, 10);
  assert.equal(matches[0].home, 'Ana');
});

test('a match needs two different players and non-negative integer goals', () => {
  assert.throws(() => validateMatch({ home: 'a', away: 'a', homeGoals: 1, awayGoals: 0 }), /two different players/);
  assert.throws(() => validateMatch({ home: 'a', away: 'b', homeGoals: -1, awayGoals: 0 }), /homeGoals/);
});
