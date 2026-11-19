import test from 'node:test';
import assert from 'node:assert/strict';
import { asMinorUnits, formatMinorUnits } from '../src/money.js';

test('money converts decimal strings', () => {
  assert.equal(asMinorUnits('12.50'), 1250);
  assert.equal(formatMinorUnits(1250), '12.50');
});
