import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderInput } from '../src/validation/order-input.js';

test('accepts a normal update', () => {
  assert.deepEqual(validateOrderInput({ items: [], deliveryNote: 'Use the side door' }, { partial: true }), []);
});

test('allows an omitted note', () => {
  assert.deepEqual(validateOrderInput({ items: [] }, { partial: true }), []);
});

test('limits the note length', () => {
  assert.ok(validateOrderInput({ items: [], deliveryNote: 'x'.repeat(181) }, { partial: true }).includes('deliveryNote is too long'));
});

test('requires the fields needed for a new order', () => {
  assert.deepEqual(validateOrderInput({ items: [] }), ['customerId is required', 'total is required', 'currency is required']);
});
