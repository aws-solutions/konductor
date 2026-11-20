import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCartView } from '../src/cart/view.js';

test('alternate promotion path keeps the row data numeric', () => {
  const view = buildCartView({ items: [{ id: 'a', name: 'A', quantity: 1, unitAmount: 4000 }] }, { taxRate: 0, promoCode: ' take750 ' });
  assert.equal(view.promoCodeRow.code, 'TAKE750');
  assert.equal(view.discount.minor, 750);
  assert.equal(view.freeShippingProgress.remainingMinor, 5250);
});
