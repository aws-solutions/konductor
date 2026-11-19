const test = require('node:test');
const assert = require('node:assert/strict');
const { newId } = require('../src/ids');

test('creates formatted job identifiers', () => {
  const id = newId('job');
  assert.match(id, /^job_[a-z0-9]+_[a-z0-9]{7}$/);
});

test('two generated identifiers differ', () => {
  assert.notEqual(newId('job'), newId('job'));
});
