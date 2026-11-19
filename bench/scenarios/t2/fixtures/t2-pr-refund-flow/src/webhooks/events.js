import { makeId } from '../utils/ids.js';

export function queueMerchantEvent(store, merchantId, type, payload) {
  return store.addEvent({ id: makeId('evt'), merchantId, type, payload, createdAt: new Date().toISOString() });
}

export function refundEvent(store, merchantId, refund) {
  return queueMerchantEvent(store, merchantId, 'refund.created', {
    refundId: refund.id,
    orderId: refund.orderId,
    amountMinor: refund.amountMinor
  });
}
