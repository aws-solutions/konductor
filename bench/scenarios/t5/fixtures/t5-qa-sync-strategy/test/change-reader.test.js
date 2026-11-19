const test = require('node:test');
const assert = require('node:assert/strict');
const { ChangeReader } = require('../src/capture/change-reader');
test('reader starts after a sequence', () => {
  const reader = new ChangeReader([{sequence:1}, {sequence:2}]);
  assert.deepEqual(reader.readAfter(1), [{sequence:2}]);
});
