import test from 'node:test';
import assert from 'node:assert/strict';
import { addMinutes, nowUtc } from '../src/util/clock.js';

test('clock produces UTC ISO values', () => {
  const value = nowUtc();
  assert.match(value, /^20\d\d-\d\d-\d\dT/);
  assert.equal(addMinutes('2025-01-01T00:00:00.000Z', 15), '2025-01-01T00:15:00.000Z');
});
