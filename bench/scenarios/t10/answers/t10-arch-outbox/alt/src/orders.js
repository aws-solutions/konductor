'use strict';
const { nextId } = require('./util/ids');
const { isStatus, requireString } = require('./util/validation');
const { nowIso } = require('./util/clock');
const { appendStatusEvent } = require('./status-events');
function optionsOf(value, broker) {
  if (typeof value === 'function') return { clock: value, broker };
  return value && typeof value === 'object' ? value : {};
}
function createOrder(store, input, clock = Date) {
  requireString(input.externalReference, 'externalReference');
  const order = { id: nextId('ord'), externalReference: input.externalReference, amount: Number(input.amount), currency: input.currency || 'USD', paymentStatus: 'pending', createdAt: nowIso(clock) };
  store.atomicWrite({ orders: store.read('orders').concat(order) }); return order;
}
function updatePaymentStatus(store, orderId, status, value = {}, oldBroker) {
  const opts = optionsOf(value, oldBroker); const clock = opts.clock || Date;
  if (!isStatus(status)) { const e = new Error('invalid payment status'); e.code = 'INVALID_STATUS'; throw e; }
  const orders = store.read('orders'); const order = orders.find(x => x.id === orderId);
  if (!order) { const e = new Error('order not found'); e.code = 'ORDER_NOT_FOUND'; throw e; }
  const changed = order.paymentStatus !== status;
  if (!changed) return order;
  const updatedAt = nowIso(clock);
  const nextOrder = { ...order, paymentStatus: status, updatedAt };
  const event = { orderId, status, occurredAt: updatedAt, payload: { orderId, status, updatedAt }, eventId: opts.eventId };
  appendStatusEvent(store, orderId, status, updatedAt, { ...opts, order: nextOrder, event });
  return nextOrder;
}
function getOrder(store, id) { return store.read('orders').find(x => x.id === id) || null; }
module.exports = { createOrder, updatePaymentStatus, getOrder };
