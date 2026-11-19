'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../src/store');
const { pickerViewModel, bookingViewModel } = require('../src/view-model');

test('store updates state and notifies subscribers', () => {
  const store = createStore({ count: 0 });
  const seen = [];
  store.subscribe((state) => seen.push(state.count));
  store.setState((state) => ({ count: state.count + 1 }));
  assert.deepEqual(seen, [1]);
  assert.deepEqual(store.getState(), { count: 1 });
});

test('view models expose renderable booking data', () => {
  const picker = { visibleYear: 2025, visibleMonth: 5, startDate: '2025-05-01', endDate: '2025-05-03' };
  const form = { valid: true, errors: {} };
  assert.equal(pickerViewModel(picker).hasRange, true);
  assert.deepEqual(bookingViewModel({ form, picker, pricing: { totalLabel: '$30.00' } }), {
    dates: { month: 'May 2025', startDate: '2025-05-01', endDate: '2025-05-03', hoverDate: null, hasRange: true },
    total: '$30.00', canSubmit: true, message: null,
  });
});
