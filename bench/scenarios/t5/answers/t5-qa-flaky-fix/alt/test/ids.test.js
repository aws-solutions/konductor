// Changes for this request; see the commit message for the reasoning.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newId } = require('../src/ids');

test('creates formatted job identifiers', () => {
  const id = newId('job', () => 0.123456);
  assert.match(id, /^job_[a-z0-9]+_[a-z0-9]{7}$/);
});

test('two generated identifiers differ for distinct random values', () => {
  const values = [0.1, 0.2];
  const random = () => values.shift();
  assert.notEqual(newId('job', random), newId('job', random));
});
