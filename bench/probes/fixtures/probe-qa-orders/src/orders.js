'use strict';

const CANCELLABLE = new Set(['placed', 'packed']);
const APPROVAL_LIMIT = 500;

const itemsTotal = (order) => order.items.reduce((sum, item) => sum + item.price * item.qty, 0);

function refundAmount(order) {
  const items = itemsTotal(order);
  return order.cancelledFrom === 'placed' ? items + order.shipping : items;
}

function cancelOrder(order, actor) {
  if (!CANCELLABLE.has(order.status)) throw new Error('order cannot be cancelled');
  if (actor.id !== order.customerId && actor.role !== 'support') throw new Error('not allowed');
  return { ...order, status: 'cancelled', cancelledFrom: order.status };
}

function requestRefund(order, actor, ledger) {
  if (order.status !== 'cancelled') throw new Error('order is not cancelled');
  if (ledger.has(order.id)) return ledger.get(order.id);
  const amount = refundAmount(order);
  const refund = { orderId: order.id, amount, state: amount > APPROVAL_LIMIT ? 'pending-approval' : 'issued' };
  ledger.set(order.id, refund);
  return refund;
}

module.exports = { cancelOrder, refundAmount, requestRefund };
