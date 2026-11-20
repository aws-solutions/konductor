const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileRoving } = require('../src/roving.js');

test('a parked item does not retain the only tab stop', () => {
  const result = reconcileRoving([{ label: 'General' }, { label: 'Alerts', disabled: true }, { label: 'Team' }], 1);
  assert.equal(result.activeIndex, 2);
  assert.deepEqual(result.items.map((entry) => entry.tabIndex), [-1, -1, 0]);
});
