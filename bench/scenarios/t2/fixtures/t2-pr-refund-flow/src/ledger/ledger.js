import { makeId } from '../utils/ids.js';

export function appendEntry(store, entry) {
  if (!Number.isInteger(entry.amountMinor)) throw new TypeError('ledger amounts must be integers');
  if (entry.amountMinor <= 0) throw new RangeError('ledger amounts must be positive');
  return store.addEntry({ id: makeId('led'), createdAt: new Date().toISOString(), ...entry });
}

export function entriesForOrder(store, orderId) {
  return store.entries.filter((entry) => entry.orderId === orderId);
}
