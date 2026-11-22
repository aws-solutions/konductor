import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderStore } from '../src/store/order-store.js';

test('round trips an order and its items', () => {
  const store = new OrderStore([]);
  const order = {
    id: 'ord_round', customerId: 'cus_44', status: 'paid', total: 18,
    currency: 'CAD', deliveryNote: '', updatedAt: '2025-01-01T00:00:00.000Z'
  };
  store.updateWithItems(order, [{ sku: 'KIT-X', quantity: 1 }]);
  assert.deepEqual(store.get('ord_round').items, [{ sku: 'KIT-X', quantity: 1 }]);
});

test('returns a copy that callers can change', () => {
  const store = new OrderStore([]);
  store.updateWithItems({
    id: 'ord_copy', customerId: 'cus_45', status: 'paid', total: 12,
    currency: 'GBP', deliveryNote: '', updatedAt: '2025-01-01T00:00:00.000Z'
  }, []);
  const copy = store.get('ord_copy');
  copy.items.push({ sku: 'LOCAL', quantity: 1 });
  assert.deepEqual(store.get('ord_copy').items, []);
});
