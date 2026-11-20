import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCartView } from '../src/cart/view.js';
import { sampleCart } from './fixtures/cart.js';
import { hasMinorMoney } from './helpers/assertions.js';

test('cart view contains lines and money values', () => {
  const view = buildCartView(sampleCart, { taxRate: 0 });
  assert.equal(view.items.length, 2);
  assert.equal(view.items[0].lineTotal.minor, 3600);
  assert.equal(view.subtotal.minor, 4800);
  assert.equal(view.shipping.amount.minor, 695);
  assert.equal(view.total.minor, 5495);
  hasMinorMoney(view.total);
});

test('delivery is free at the configured threshold', () => {
  const view = buildCartView({ items: [{ id: 'a', name: 'A', quantity: 1, unitAmount: 9000 }] }, { taxRate: 0 });
  assert.equal(view.shipping.amount.minor, 0);
  assert.equal(view.shipping.label, 'Free delivery');
});
