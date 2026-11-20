import test from 'node:test';
import assert from 'node:assert/strict';
import { validCart } from '../src/validators/cart.js';

test('validator accepts positive cart lines', () => {
  assert.equal(validCart({ items: [{ id: 'x', name: 'X', quantity: 1, unitAmount: 0 }] }), true);
});

test('validator rejects malformed lines', () => {
  assert.equal(validCart({ items: [{ id: 'x', name: 'X', quantity: 0, unitAmount: 4 }] }), false);
});
