const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

test('checkout charges a cart and returns a paid order', async () => {
  const app = createApp({ MUG: 4 });
  const order = await app.checkout({ id: 'o-1', email: 'a@example.test', lines: [{ sku: 'MUG', unitPrice: 12.5, quantity: 1 }], discount: 0, taxRate: 0.08 });
  assert.equal(order.state, 'paid');
  assert.equal(app.payments.charges.length, 1);
  assert.equal(app.payments.charges[0].amount, 1350);
});
