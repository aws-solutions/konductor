import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, discount, shipping, findCode, subtotal } from '../site/src/pricing.js';
import { money, validate } from '../site/src/format.js';

const lines = [
  { sku: 'A', name: 'A', unitPence: 850, quantity: 2 },
  { sku: 'B', name: 'B', unitPence: 1200, quantity: 1 },
];

test('subtotal adds every line', () => {
  assert.equal(subtotal(lines), 2900);
});

test('standard delivery is free from £40 before discount', () => {
  assert.equal(shipping(3999, 'standard'), 450);
  assert.equal(shipping(4000, 'standard'), 0);
  assert.equal(shipping(4000, 'express'), 900);
  assert.equal(shipping(0, 'express'), 0);
});

test('promo codes are case-insensitive and trimmed', () => {
  assert.equal(findCode(' leaf10 ').code, 'LEAF10');
  assert.equal(findCode('NOPE'), null);
});

test('fixed codes need a minimum subtotal', () => {
  const steep = findCode('STEEP5');
  assert.equal(discount(2499, steep), 0);
  assert.equal(discount(2500, steep), 500);
});

test('summary combines the rules', () => {
  assert.deepEqual(summarise(lines, 'standard', findCode('LEAF10')), { subtotal: 2900, discount: 290, shipping: 450, total: 3060 });
});

test('money formats pence as pounds', () => {
  assert.equal(money(3060), '£30.60');
  assert.equal(money(-290), '-£2.90');
});

test('validate reports each bad field', () => {
  assert.deepEqual(Object.keys(validate({ name: '', email: 'x', postcode: '12' })), ['name', 'email', 'postcode']);
  assert.deepEqual(validate({ name: 'Ana', email: 'ana@example.com', postcode: 'SW1A 1AA' }), {});
});
