import { MemoryStore } from '../src/store/memory-store.js';

export function orderStore(order = {}) {
  return new MemoryStore({ orders: [{
    id: 'ord_test', merchantId: 'm_green', customerId: 'cus_test', totalMinor: 2500,
    capturedMinor: 2500, status: 'captured', ...order
  }] });
}
