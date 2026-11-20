const test = require('node:test');
const assert = require('node:assert/strict');
const labels = require('../src/legacy-labels');

test('keeps desk labels stable', () => {
  assert.deepEqual(labels, { open: 'Open now', closed: 'Closed', paused: 'Temporarily unavailable' });
});
