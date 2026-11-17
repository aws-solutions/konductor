'use strict';

// Stress tests for the booking service: many calls at once, so a read, wait and write that is not atomic shows up.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookingService, createStore, createNotifier } = require('../src');

const unhandled = [];
process.on('unhandledRejection', (reason) => { unhandled.push(reason); });

const turns = (n) => new Promise((resolve) => {
  const step = (k) => (k <= 0 ? resolve() : setImmediate(() => step(k - 1)));
  step(n);
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A payments double. `turnsFor(i)` is how many event-loop turns charge number i waits (deterministic, so calls
 * interleave the same way every run); `fail(request)` returns a decline message or null; `hang` makes a charge
 * that never settles unless its signal aborts.
 */
function payments({ turnsFor = (i) => i % 7, fail = () => null, hang = false, settleAfterMs = null } = {}) {
  const calls = [];
  return {
    calls,
    charge(req) {
      const i = calls.length;
      calls.push(req);
      return new Promise((resolve, reject) => {
        req.signal?.addEventListener('abort', () => reject(new Error('charge stopped')), { once: true });
        if (hang) return;
        const done = () => {
          const reason = fail(req);
          if (reason) reject(new Error(reason));
          else resolve({ chargeId: `c-${i}` });
        };
        if (settleAfterMs !== null) setTimeout(done, settleAfterMs);
        else turns(turnsFor(i)).then(done);
      });
    },
  };
}

function service({ capacity = 10, events, pay = payments(), notifier = createNotifier(), timeoutMs } = {}) {
  const ev = events || { show: { name: 'Show', capacity, priceCents: 500 } };
  return createBookingService({ store: createStore(), payments: pay, notifier, events: ev, ...(timeoutMs ? { timeoutMs } : {}) });
}

const settle = (promises) => Promise.allSettled(promises);
const codes = (results) => results.filter((r) => r.status === 'rejected').map((r) => r.reason && r.reason.code);

test('200 calls at once on 10 seats confirm exactly 10 bookings', async () => {
  const s = service({ capacity: 10 });
  const results = await settle(Array.from({ length: 200 }, (_, i) => s.book('show', `u${i}`)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.ok(codes(results).every((c) => c === 'SOLD_OUT'), 'every refused call says SOLD_OUT');
  assert.equal(await s.remaining('show'), 0);
  assert.equal(s.stats().confirmed, 10);
});

test('three events booked at once each stop at their own capacity', async () => {
  const events = { a: { name: 'A', capacity: 5, priceCents: 1 }, b: { name: 'B', capacity: 5, priceCents: 1 }, c: { name: 'C', capacity: 5, priceCents: 1 } };
  const s = service({ events });
  const calls = [];
  for (let i = 0; i < 60; i++) calls.push(s.book(['a', 'b', 'c'][i % 3], `u${i}`).then((b) => b.eventId));
  const done = (await settle(calls)).filter((r) => r.status === 'fulfilled').map((r) => r.value);
  for (const id of ['a', 'b', 'c']) assert.equal(done.filter((x) => x === id).length, 5, id);
  assert.deepEqual([await s.remaining('a'), await s.remaining('b'), await s.remaining('c')], [0, 0, 0]);
});

test('one user booking 20 times at once gets one seat and 19 DUPLICATE', async () => {
  const s = service({ capacity: 10 });
  const results = await settle(Array.from({ length: 20 }, () => s.book('show', 'same-user')));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.deepEqual([...new Set(codes(results))], ['DUPLICATE']);
  assert.equal(await s.remaining('show'), 9);
});

test('declined charges under load free their seats, and no seat is lost or sold twice', async () => {
  const pay = payments({ fail: (req) => (Number(req.userId.slice(1)) % 2 === 0 ? 'card declined' : null) });
  const s = service({ capacity: 5, pay });
  const first = await settle(Array.from({ length: 30 }, (_, i) => s.book('show', `u${i}`)));
  const ok = first.filter((r) => r.status === 'fulfilled').map((r) => r.value.userId);
  assert.ok(ok.length >= 1 && ok.length <= 5, `confirmed ${ok.length}, capacity 5`);
  assert.ok(ok.every((u) => Number(u.slice(1)) % 2 === 1), 'only callers whose charge succeeded hold a seat');
  assert.equal(await s.remaining('show'), 5 - ok.length, 'every declined seat is free again');
  await settle(Array.from({ length: 10 }, (_, i) => s.book('show', `u${101 + 2 * i}`)));
  assert.equal(s.stats().confirmed, 5);
  assert.equal(await s.remaining('show'), 0);
});

test('a declined charge rejects with PAYMENT_FAILED and the user can book again', async () => {
  let declines = 1;
  const pay = payments({ fail: () => (declines-- > 0 ? 'card declined' : null) });
  const s = service({ capacity: 1, pay });
  await assert.rejects(s.book('show', 'u1'), { code: 'PAYMENT_FAILED' });
  assert.equal(await s.remaining('show'), 1);
  assert.equal((await s.book('show', 'u1')).userId, 'u1');
});

test('a charge that never settles rejects with PAYMENT_TIMEOUT and frees the seat', { timeout: 3000 }, async () => {
  const pay = payments({ hang: true });
  const s = service({ capacity: 1, pay, timeoutMs: 30 });
  const started = Date.now();
  await assert.rejects(s.book('show', 'u1'), { code: 'PAYMENT_TIMEOUT' });
  assert.ok(Date.now() - started < 1000, 'the timeout follows timeoutMs');
  assert.equal(await s.remaining('show'), 1);
  assert.ok(pay.calls[0].signal && pay.calls[0].signal.aborted, 'the charge signal is aborted on timeout');
});

test('a charge that settles after the timeout does not confirm a booking', { timeout: 3000 }, async () => {
  const s = service({ capacity: 1, pay: payments({ settleAfterMs: 80 }), timeoutMs: 20 });
  await assert.rejects(s.book('show', 'u1'), { code: 'PAYMENT_TIMEOUT' });
  await sleep(120);
  assert.equal(s.stats().confirmed, 0);
  assert.equal(await s.remaining('show'), 1);
});

test('aborting while the charge runs rejects with ABORTED, aborts the charge and frees the seat', { timeout: 3000 }, async () => {
  const pay = payments({ settleAfterMs: 200 });
  const s = service({ capacity: 1, pay });
  const controller = new AbortController();
  const pending = s.book('show', 'u1', { signal: controller.signal });
  await sleep(10);
  controller.abort();
  await assert.rejects(pending, { code: 'ABORTED' });
  assert.ok(pay.calls[0] && pay.calls[0].signal && pay.calls[0].signal.aborted, 'the charge signal is aborted');
  assert.equal(await s.remaining('show'), 1);
});

test('an already aborted signal rejects with ABORTED and charges nothing', async () => {
  const pay = payments();
  const s = service({ capacity: 1, pay });
  await assert.rejects(s.book('show', 'u1', { signal: AbortSignal.abort() }), { code: 'ABORTED' });
  assert.equal(pay.calls.length, 0);
  assert.equal(await s.remaining('show'), 1);
});

test('a rejected confirmation keeps the booking, is counted and is not unhandled', async () => {
  const before = unhandled.length;
  const notifier = { send: () => Promise.reject(new Error('relay down')) };
  const s = service({ capacity: 2, notifier });
  const booking = await s.book('show', 'u1');
  assert.equal(booking.userId, 'u1');
  await sleep(20);
  assert.equal(s.stats().notifyFailures, 1);
  assert.equal(unhandled.length, before, 'no unhandled rejection');
});

test('a confirmation that throws at once keeps the booking and is counted', async () => {
  const notifier = { send: () => { throw new Error('bad address'); } };
  const s = service({ capacity: 2, notifier });
  const booking = await s.book('show', 'u1');
  assert.equal(booking.userId, 'u1');
  await sleep(20);
  assert.equal(s.stats().notifyFailures, 1);
  assert.equal(s.stats().confirmed, 1);
});

test('bookings one after another get distinct sequential ids', async () => {
  const s = service({ capacity: 3 });
  const ids = [];
  for (const u of ['a', 'b', 'c']) ids.push((await s.book('show', u)).bookingId);
  assert.deepEqual(ids, ['b-1', 'b-2', 'b-3']);
});

test('an unknown event rejects with UNKNOWN_EVENT', async () => {
  const s = service();
  await assert.rejects(s.book('nope', 'u1'), { code: 'UNKNOWN_EVENT' });
});
