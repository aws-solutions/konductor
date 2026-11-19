import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEntry } from '../src/ledger/ledger.js';
import { MemoryStore } from '../src/store/memory-store.js';

test('ledger accepts positive integer minor units', () => {
  const store = new MemoryStore();
  const entry = appendEntry(store, { type: 'capture', amountMinor: 1200, orderId: 'ord_1' });
  assert.equal(entry.amountMinor, 1200);
});

test('ledger rejects decimals and negatives', () => {
  const store = new MemoryStore();
  assert.throws(() => appendEntry(store, { type: 'capture', amountMinor: 1.2 }), /integers/);
  assert.throws(() => appendEntry(store, { type: 'capture', amountMinor: 0 }), /positive/);
});
