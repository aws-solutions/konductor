const test = require('node:test');
const assert = require('node:assert/strict');
const { applyPromo } = require('../src/promos/codes');

test('active promo returns a discount', () => {
  const result = applyPromo('WELCOME10', 80);
  assert.equal(result.code, 'WELCOME10');
  assert.equal(result.discount, 8);
});

test('unknown promo has no discount', () => {
  assert.deepEqual(applyPromo('NOPE', 80), { discount: 0, code: null });
});
