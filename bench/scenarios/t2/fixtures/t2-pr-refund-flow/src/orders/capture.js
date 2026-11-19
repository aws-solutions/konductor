import { conflict, forbidden } from '../errors.js';
import { findOrder } from './repository.js';
import { makeId } from '../utils/ids.js';

export function captureOrder({ store, merchantId, orderId, amountMinor }) {
  const order = findOrder(store, orderId);
  if (order.merchantId !== merchantId) throw forbidden('order belongs to another merchant');
  if (order.status !== 'authorized') throw conflict('order is not authorized');
  if (amountMinor !== order.totalMinor) throw conflict('capture amount must equal order total');
  order.status = 'captured';
  order.capturedMinor = amountMinor;
  store.addEntry({ id: makeId('led'), type: 'capture', orderId, amountMinor });
  return order;
}
