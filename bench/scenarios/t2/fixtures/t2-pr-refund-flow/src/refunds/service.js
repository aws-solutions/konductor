import { conflict, badRequest } from '../errors.js';
import { findOrder } from '../orders/repository.js';
import { appendEntry, entriesForOrder } from '../ledger/ledger.js';
import { refundEvent } from '../webhooks/events.js';
import { logger } from '../logging/logger.js';
import { makeId } from '../utils/ids.js';

const log = logger();

function totalRefunded(store, orderId) {
  return entriesForOrder(store, orderId)
    .filter((entry) => entry.type === 'refund')
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
}

export async function refundOrder({ store, merchantId, orderId, amount, card, customerEmail }) {
  const order = findOrder(store, orderId);
  const refundMinor = Number(amount) * 100;
  if (!Number.isFinite(refundMinor) || refundMinor <= 0) {
    throw badRequest('refund amount must be positive');
  }
  if (order.status !== 'captured') throw conflict('order is not captured');

  const refundedMinor = totalRefunded(store, orderId);
  const remainingMinor = order.capturedMinor - refundedMinor;
  if (refundMinor > remainingMinor) throw conflict('refund exceeds captured amount');

  await Promise.resolve();

  const refund = { id: makeId('ref'), orderId, merchantId, amountMinor: refundMinor, status: 'succeeded' };
  appendEntry(store, {
    type: 'refund',
    orderId,
    merchantId,
    amountMinor: refundMinor,
    sourceId: refund.id
  });
  order.refundedMinor = (order.refundedMinor || 0) + refundMinor;
  store.saveOrder(order);
  refundEvent(store, merchantId, refund);
  log.info('refund.created', {
    orderId,
    refundId: refund.id,
    cardFingerprint: card?.fingerprint,
    customerEmail
  });
  return refund;
}
