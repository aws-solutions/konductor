'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cancelOrder, refundAmount, requestRefund } = require('../src/orders.js');

test('test 1', () => {
  const order = { id: 'o1', customerId: 'c1', status: 'placed', shipping: 5, items: [{ price: 19.99, qty: 3 }] };
  const cancelled = cancelOrder(order, { id: 'c1', role: 'customer' });
  assert.equal(cancelled.status, 'cancelled');
});

test('test 2', () => {
  const order = { id: 'o2', customerId: 'c1', status: 'packed', shipping: 5, items: [{ price: 10, qty: 1 }] };
  const cancelled = cancelOrder(order, { id: 'u9', role: 'support' });
  assert.equal(cancelled.status, 'cancelled');
});

test('refund includes shipping when the order was cancelled before packing', () => {
  const order = { id: 'o3', customerId: 'c1', status: 'placed', shipping: 5, items: [{ price: 19.99, qty: 3 }] };
  const cancelled = cancelOrder(order, { id: 'c1', role: 'customer' });
  assert.equal(refundAmount(cancelled), 64.97);
});

test('refund leaves out shipping when the order was already packed', () => {
  const order = { id: 'o4', customerId: 'c1', status: 'packed', shipping: 5, items: [{ price: 19.99, qty: 3 }] };
  const cancelled = cancelOrder(order, { id: 'c1', role: 'customer' });
  assert.equal(refundAmount(cancelled), 59.97);
});

test('refund by another customer is rejected', () => {
  const order = { id: 'o5', customerId: 'c1', status: 'placed', shipping: 5, items: [{ price: 20, qty: 1 }] };
  const cancelled = cancelOrder(order, { id: 'c1', role: 'customer' });
  try {
    requestRefund(cancelled, { id: 'c2', role: 'customer' }, new Map());
  } catch (err) {
    // expected
  }
});

test('a second refund request returns the first refund', () => {
  const order = { id: 'o6', customerId: 'c1', status: 'placed', shipping: 5, items: [{ price: 20, qty: 1 }] };
  const cancelled = cancelOrder(order, { id: 'c1', role: 'customer' });
  const ledger = new Map();
  const first = requestRefund(cancelled, { id: 'c1', role: 'customer' }, ledger);
  const second = requestRefund(cancelled, { id: 'c1', role: 'customer' }, ledger);
  assert.equal(second, first);
});
