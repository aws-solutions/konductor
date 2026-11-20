const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileRoving } = require('../src/roving.js');

test('reconciliation chooses a usable successor when the active entry is unavailable', () => {
  const state = reconcileRoving([
    { label: 'General' },
    { label: 'Alerts', disabled: true },
    { label: 'Team' },
  ], 1);
  assert.equal(state.activeIndex, 2);
  assert.deepEqual(state.items.map((item) => item.tabIndex), [-1, -1, 0]);
  assert.equal(state.items[1].selected, false);
});
