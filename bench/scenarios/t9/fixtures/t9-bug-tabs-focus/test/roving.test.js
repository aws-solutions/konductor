const test = require('node:test');
const assert = require('node:assert/strict');
const { findEnabledIndex, nextEnabledIndex, reconcileRoving } = require('../src/roving.js');

test('the first available entry becomes the starting point', () => {
  assert.equal(findEnabledIndex([{ disabled: false }, { disabled: false }], 0), 0);
  assert.equal(findEnabledIndex([{ disabled: true }, { disabled: false }], 0), 1);
});

test('movement wraps while skipping unavailable entries', () => {
  const items = [{ disabled: false }, { disabled: true }, { disabled: false }];
  assert.equal(nextEnabledIndex(items, 0, 1), 2);
  assert.equal(nextEnabledIndex(items, 0, -1), 2);
});

test('movement reports no destination when every entry is unavailable', () => {
  assert.equal(nextEnabledIndex([{ disabled: true }, { disabled: true }], 0, 1), -1);
});

test('reconciliation gives one entry the roving tab stop', () => {
  const state = reconcileRoving([{ label: 'one' }, { label: 'two' }], 1);
  assert.equal(state.activeIndex, 1);
  assert.deepEqual(state.items.map((item) => item.tabIndex), [-1, 0]);
});

test('a missing list has no active entry', () => {
  assert.equal(reconcileRoving([], 0).activeIndex, -1);
});
