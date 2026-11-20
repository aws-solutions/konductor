const test = require('node:test');
const assert = require('node:assert/strict');
const { minutesBetween } = require('../src/clock');

test('clock counts minutes across an hour', () => {
  assert.equal(minutesBetween('2025-01-01T09:00:00Z', '2025-01-01T10:35:00Z'), 95);
});
