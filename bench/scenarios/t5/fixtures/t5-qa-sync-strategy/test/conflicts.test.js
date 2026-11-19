const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveConflict } = require('../src/conflicts/resolve-conflict');
test('newer conflict wins', () => {
  const old = {id:'x', updatedAt:'2024-01-01T00:00:00Z', value:1};
  const newer = {id:'x', updatedAt:'2024-01-02T00:00:00Z', value:2};
  assert.equal(resolveConflict(old, newer), newer);
});
