import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCartView } from '../src/cart/view.js';

const cart = (amount) => ({ items: [{ id: 'x', name: 'Sample', quantity: 1, unitAmount: amount }] });

test('the view exposes a promo row and progress object', () => {
  const view = buildCartView(cart(4000), { taxRate: 0, promoCode: ' SAVE15 ' });
  assert.equal(view.promoCodeRow.applied, true);
  assert.equal(view.discount.minor, 600);
  assert.equal(view.freeShippingProgress.remainingMinor, 5100);
  assert.equal(typeof view.freeShippingProgress, 'object');
});

test('free shipping qualification uses the discounted subtotal', () => {
  const view = buildCartView(cart(9000), { taxRate: 0, promoCode: 'SAVE15' });
  assert.equal(view.freeShippingProgress.qualifyingSubtotalMinor, 7650);
  assert.equal(view.freeShippingProgress.remainingMinor, 850);
  assert.equal(view.shipping.amount.minor, 695);
});

test('the free-shipping promotion changes delivery but not merchandise discount', () => {
  const view = buildCartView(cart(7000), { taxRate: 0, promoCode: 'shipday' });
  assert.equal(view.discount.minor, 0);
  assert.equal(view.shipping.amount.minor, 0);
});
