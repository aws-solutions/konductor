import assert from 'node:assert/strict';

export function hasMinorMoney(value) {
  assert.equal(typeof value.minor, 'number');
  assert.equal(typeof value.formatted, 'string');
}
