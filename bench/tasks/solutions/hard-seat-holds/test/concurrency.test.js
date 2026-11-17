'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookingService, createStore, createFakePayments, createNotifier } = require('../src');

const EVENTS = { show: { name: 'Show', capacity: 3, priceCents: 100 } };
const make = (payments = createFakePayments({ delayMs: 2 }), extra = {}) => createBookingService({ store: createStore(), payments, notifier: createNotifier(), events: EVENTS, ...extra });

test('50 calls at once on 3 seats confirm 3 and leave none free', async () => {
  const s = make();
  const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => s.book('show', `u${i}`)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
  assert.equal(await s.remaining('show'), 0);
});

test('a user calling twice at once gets DUPLICATE on the second call', async () => {
  const s = make();
  const [a, b] = await Promise.allSettled([s.book('show', 'u1'), s.book('show', 'u1')]);
  assert.equal(a.status, 'fulfilled');
  assert.equal(b.reason.code, 'DUPLICATE');
});

test('a charge slower than timeoutMs rejects with PAYMENT_TIMEOUT and frees the seat', async () => {
  const s = make(createFakePayments({ delayMs: 200 }), { timeoutMs: 10 });
  await assert.rejects(s.book('show', 'u1'), { code: 'PAYMENT_TIMEOUT' });
  assert.equal(await s.remaining('show'), 3);
});

test('an aborted signal rejects with ABORTED and frees the seat', async () => {
  const s = make(createFakePayments({ delayMs: 200 }));
  const controller = new AbortController();
  const pending = s.book('show', 'u1', { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.equal(await s.remaining('show'), 3);
});

test('a failing confirmation is counted and the booking stands', async () => {
  const s = createBookingService({ store: createStore(), payments: createFakePayments({ delayMs: 1 }), notifier: { send: async () => { throw new Error('relay down'); } }, events: EVENTS });
  await s.book('show', 'u1');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(s.stats(), { confirmed: 1, notifyFailures: 1 });
});
