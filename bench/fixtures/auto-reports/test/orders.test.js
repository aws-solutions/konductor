'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadOrders } = require('../src');

test('orders load from data/orders.json', () => {
  const orders = loadOrders(path.join(__dirname, '..', 'data'));
  assert.equal(orders.length, 10);
  assert.equal(orders[9].status, 'cancelled');
});
