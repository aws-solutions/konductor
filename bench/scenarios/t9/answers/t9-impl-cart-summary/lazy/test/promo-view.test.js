import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCartView } from '../src/cart/view.js';

test('quick promotion check', () => {
  const view = buildCartView({ items: [{ id: 'x', name: 'X', quantity: 1, unitAmount: 4000 }] }, { taxRate: 0, promoCode: 'TAKE750' });
  assert.equal(view.discount.minor, 750);
  assert.equal(view.promoCodeRow.applied, true);
});
