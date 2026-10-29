'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ordersFor } = require('../src');

test('ordersFor returns the orders of one customer', () => {
  const orders = ordersFor(path.join(__dirname, '..', 'data'), 'c1');
  assert.deepEqual(orders.map((o) => o.id), ['o1', 'o10']);
});
