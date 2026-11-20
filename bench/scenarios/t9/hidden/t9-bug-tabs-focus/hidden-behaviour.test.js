const test = require('node:test');
const assert = require('node:assert/strict');
const { findEnabledIndex, nextEnabledIndex, reconcileRoving } = require('./src/roving.js');

test('reconciliation moves off an unavailable preferred entry', () => {
  const state = reconcileRoving([{ label: 'A' }, { label: 'B', disabled: true }, { label: 'C' }], 1);
  assert.equal(state.activeIndex, 2);
  assert.deepEqual(state.items.map((item) => item.tabIndex), [-1, -1, 0]);
});

test('reconciliation falls back to the preceding entry at the end', () => {
  const state = reconcileRoving([{ label: 'A' }, { label: 'B', disabled: true }], 1);
  assert.equal(state.activeIndex, 0);
  assert.equal(state.items[0].selected, true);
});

test('reconciliation has no selected entry when all entries are unavailable', () => {
  const state = reconcileRoving([{ disabled: true }, { disabled: true }], 0);
  assert.equal(state.activeIndex, -1);
  assert.equal(state.items.filter((item) => item.selected).length, 0);
});

test('a preferred entry that moved out of range uses the final available entry', () => {
  const state = reconcileRoving([{ label: 'A' }, { label: 'B' }, { label: 'C' }], 9);
  assert.equal(state.activeIndex, 2);
});

test('backward movement skips a disabled neighbor and wraps', () => {
  const items = [{ disabled: false }, { disabled: true }, { disabled: false }, { disabled: true }];
  assert.equal(nextEnabledIndex(items, 2, -1), 0);
  assert.equal(nextEnabledIndex(items, 0, -1), 2);
});

test('the enabled lookup returns no index for an empty collection', () => {
  assert.equal(findEnabledIndex([], 0), -1);
});

test('a disabled first entry yields the next item as the active entry', () => {
  const state = reconcileRoving([{ label: 'A', disabled: true }, { label: 'B' }], 0);
  assert.equal(state.activeIndex, 1);
  assert.equal(state.items[0].tabIndex, -1);
});

test('a disabled final entry yields the preceding item as the active entry', () => {
  const state = reconcileRoving([{ label: 'A' }, { label: 'B', disabled: true }], 1);
  assert.equal(state.activeIndex, 0);
  assert.equal(state.items[1].selected, false);
});

test('an unavailable preferred entry never receives selected state', () => {
  const state = reconcileRoving([{ label: 'A' }, { label: 'B', disabled: true }, { label: 'C' }], 1);
  assert.equal(state.items[1].selected, false);
  assert.notEqual(state.items[1].tabIndex, 0);
});

test('a usable entry remains the only selected entry after reconciliation', () => {
  const state = reconcileRoving([{ label: 'A' }, { label: 'B', disabled: true }, { label: 'C' }], 1);
  assert.equal(state.items.filter((item) => item.selected).length, 1);
  assert.equal(state.items[2].selected, true);
});
