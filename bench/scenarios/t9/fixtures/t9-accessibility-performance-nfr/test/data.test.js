import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orders } from '../data/orders.js';
import { isKnownStatus } from '../src/status.js';
import { parseDate } from '../src/dates.js';

test('the generated data has about fifteen hundred orders', () => {
  assert.equal(orders.length, 1500);
});

test('order ids are unique', () => {
  assert.equal(new Set(orders.map((o) => o.id)).size, orders.length);
});

test('every order has a known status and a real date', () => {
  for (const o of orders) {
    assert.ok(isKnownStatus(o.status), o.id);
    assert.notEqual(parseDate(o.date), null, o.id);
  }
});

test('totals equal the sum of the lines', () => {
  for (const o of orders) {
    assert.equal(o.total, o.items.reduce((sum, i) => sum + i.qty * i.price, 0), o.id);
  }
});

test('orders are listed newest first', () => {
  for (let i = 1; i < orders.length; i += 1) assert.ok(orders[i - 1].date >= orders[i].date);
});
