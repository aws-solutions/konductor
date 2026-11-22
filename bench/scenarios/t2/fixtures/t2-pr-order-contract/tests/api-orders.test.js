import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderStore } from '../src/store/order-store.js';
import { MemoryQueue } from '../src/events/queue.js';
import { createOrderRoutes } from '../src/routes/orders-route.js';

function makeRoutes() {
  const store = new OrderStore([{
    id: 'ord_test', customerId: 'cus_44', status: 'paid', total: 24,
    currency: 'USD', deliveryNote: '', revision: 3, updatedAt: '2025-02-01T00:00:00.000Z',
    items: [{ sku: 'KIT-ONE', quantity: 1 }]
  }]);
  const queue = new MemoryQueue();
  return { routes: createOrderRoutes({ store, queue, now: () => '2025-02-02T00:00:00.000Z' }), store, queue };
}

test('gets an order in the mobile response shape', () => {
  const { routes } = makeRoutes();
  const result = routes.getOrder('ord_test');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, '$24.00');
  assert.equal(result.body.currency, 'USD');
  assert.equal(result.body.items[0].quantity, 1);
  assert.equal(result.body.responseVersion, '2025-02');
});

test('updates items and publishes the new revision', () => {
  const { routes, store, queue } = makeRoutes();
  const result = routes.updateOrder('ord_test', {
    deliveryNote: 'Ring the bell',
    items: [{ sku: 'KIT-TWO', quantity: 2 }]
  });
  assert.equal(result.statusCode, 200);
  assert.equal(store.get('ord_test').items[0].sku, 'KIT-TWO');
  assert.equal(queue.all()[0].topic, 'orders.updated');
  assert.equal(queue.all()[0].message.sequence, '4');
});

test('rejects malformed update input', () => {
  const { routes } = makeRoutes();
  const result = routes.updateOrder('ord_test', { deliveryNote: '', items: [{ sku: 'KIT-TWO', quantity: 'two' }] });
  assert.equal(result.statusCode, 400);
  assert.ok(result.body.errors.length > 0);
});

test('lists orders by status', () => {
  const { routes } = makeRoutes();
  const result = routes.listOrders('paid');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.length, 1);
  assert.equal(result.body[0].id, 'ord_test');
});

test('rejects an unknown order', () => {
  const { routes } = makeRoutes();
  assert.equal(routes.getOrder('ord_missing').statusCode, 404);
});
