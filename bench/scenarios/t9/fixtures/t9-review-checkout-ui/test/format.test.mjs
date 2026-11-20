import test from 'node:test';
import assert from 'node:assert/strict';
import { capitalize, compactDate } from '../src/utils/format.js';
import { buildCheckoutModel } from '../src/utils/checkout-rules.js';
import { describeCheckout } from '../src/ui/large-checkout-model.js';

test('capitalize changes only the first character', () => assert.equal(capitalize('ready'), 'Ready'));
test('compactDate gives a short month and day', () => assert.match(compactDate('2025-01-03T00:00:00Z'), /Jan 3/));
test('checkout model normalizes ready checkout data', () => {
  const model = buildCheckoutModel({ cart: [{ sku: 'a', price: 2, quantity: 1, name: 'A' }], address: { fullName: 'A', postcode: 'ab1' }, payment: { paymentToken: 'tok' } });
  assert.equal(model.canSubmit, true);
  assert.equal(model.address.postcode, 'AB1');
});
test('large checkout description handles coupon and shipping', () => {
  const model = describeCheckout({ cart: [{ sku: 'a', name: 'A', price: 20, quantity: 2 }], coupon: 'TRAIL10', address: { postcode: 'X' } });
  assert.equal(model.state, 'ready');
  assert.equal(model.shipping, 6);
  assert.equal(model.itemCount, 2);
});
