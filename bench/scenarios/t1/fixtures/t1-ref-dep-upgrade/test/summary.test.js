const test = require('node:test');
const assert = require('node:assert/strict');
const { sum, summarize } = require('../src/summary');
const { makeSummary } = require('../src/commands/summary');
const { countReasons } = require('../src/commands/returns');

test('sum handles numeric strings and missing values', () => {
  assert.equal(sum([{ n: '2' }, { n: 3 }, {}], 'n'), 5);
});

test('summarize returns requested numeric totals', () => {
  assert.deepEqual(summarize([{ a: 2, b: 3 }, { a: 4, b: 1 }], ['a', 'b']), { a: 6, b: 4 });
});

test('summary command keeps its stable totals', () => {
  assert.deepEqual(makeSummary([{ orders: 2, revenue: 10 }, { orders: 3, revenue: 4 }]), { orders: 5, revenue: 14 });
});

test('returns command groups units by reason', () => {
  assert.deepEqual(countReasons([{ reason: 'Damaged', units: 2 }, { reason: 'Damaged', units: 1 }]), { Damaged: 3 });
});
