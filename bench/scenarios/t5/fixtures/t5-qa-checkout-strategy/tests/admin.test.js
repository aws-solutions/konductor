const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcile } = require('../src/admin/reconcile');
const { parseCouponCsv } = require('../src/admin/import-coupons');

test('reconcile identifies matches and differences', () => {
  const result = reconcile([{ id: 'a', amount: 2 }], [{ id: 'a', amount: 2 }, { id: 'b', amount: 4 }]);
  assert.deepEqual(result.matched, ['a']);
  assert.deepEqual(result.missing, []);
});

test('coupon importer parses rows', () => {
  const rows = parseCouponCsv('code,kind,amount,expires\nSPRING,percent,15,2025-06-01');
  assert.equal(rows[0].amount, 15);
});
