import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterOrders } from '../src/filter.js';

const orders = [
  { id: 'TW-3', date: '2025-03-20', customer: 'Zoë Hughes', city: 'Leeds', status: 'processing', items: [{ name: 'Wool blanket' }] },
  { id: 'TW-2', date: '2025-03-10', customer: 'Amélie Dubois', city: 'Lyon', status: 'shipped', items: [{ name: 'Enamel kettle' }] },
  { id: 'TW-1', date: '2025-03-01', customer: 'Owen Quinn', city: 'Cork', status: 'delivered', items: [{ name: 'Enamel camp mug' }] },
];

const ids = (list) => list.map((o) => o.id);

test('no controls set returns everything', () => {
  assert.deepEqual(ids(filterOrders(orders)), ['TW-3', 'TW-2', 'TW-1']);
});

test('status narrows the list', () => {
  assert.deepEqual(ids(filterOrders(orders, { status: 'shipped' })), ['TW-2']);
});

test('query and status combine', () => {
  assert.deepEqual(ids(filterOrders(orders, { query: 'enamel', status: 'delivered' })), ['TW-1']);
});

test('date range is inclusive on both ends', () => {
  assert.deepEqual(ids(filterOrders(orders, { from: '2025-03-01', to: '2025-03-10' })), ['TW-2', 'TW-1']);
});

test('only a from date leaves the end open', () => {
  assert.deepEqual(ids(filterOrders(orders, { from: '2025-03-10' })), ['TW-3', 'TW-2']);
});

test('day-first dates work in the range', () => {
  assert.deepEqual(ids(filterOrders(orders, { from: '15/03/2025' })), ['TW-3']);
});
