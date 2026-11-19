import { conflict } from '../errors.js';
import { appendEntry } from '../ledger/ledger.js';
import { makeId } from '../utils/ids.js';

export function createPayout({ store, merchantId, amountMinor }) {
  if (amountMinor <= 0) throw conflict('payout must be positive');
  const payout = { id: makeId('pay'), merchantId, amountMinor, status: 'queued' };
  store.outbox.push({ type: 'payout.created', payload: payout });
  appendEntry(store, { type: 'payout', merchantId, amountMinor, sourceId: payout.id });
  return payout;
}
