import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleValue } from '../lib/cycle-value.js';

test('the mutually dependent helpers expose both values', () => {
  assert.equal(cycleValue(), 'cycle-a-cycle-b');
});
