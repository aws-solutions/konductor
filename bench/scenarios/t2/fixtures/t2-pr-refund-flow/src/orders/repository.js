import { notFound } from '../errors.js';

export function findOrder(store, orderId) {
  const order = store.order(orderId);
  if (!order) throw notFound('order not found');
  return order;
}
