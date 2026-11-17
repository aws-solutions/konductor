'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBookingService, createStore, createFakePayments, createNotifier } = require('../src');

const EVENTS = { small: { name: 'Small', capacity: 2, priceCents: 100 } };

function setup(payments = createFakePayments({ delayMs: 1 })) {
  const notifier = createNotifier();
  return { notifier, service: createBookingService({ store: createStore(), payments, notifier, events: EVENTS }) };
}

test('a booking takes one seat and sends a confirmation', async () => {
  const { service, notifier } = setup();
  const booking = await service.book('small', 'u1');
  assert.deepEqual(booking, { bookingId: 'b-1', eventId: 'small', userId: 'u1' });
  assert.equal(await service.remaining('small'), 1);
  assert.equal(notifier.sent.length, 1);
});

test('bookings one after another stop at capacity', async () => {
  const { service } = setup();
  await service.book('small', 'u1');
  await service.book('small', 'u2');
  await assert.rejects(service.book('small', 'u3'), { code: 'SOLD_OUT' });
});

test('a user cannot book the same event twice', async () => {
  const { service } = setup();
  await service.book('small', 'u1');
  await assert.rejects(service.book('small', 'u1'), { code: 'DUPLICATE' });
});

test('a declined payment takes no seat', async () => {
  const { service } = setup(createFakePayments({ delayMs: 1, fail: () => 'card declined' }));
  await assert.rejects(service.book('small', 'u1'), { code: 'PAYMENT_FAILED' });
  assert.equal(await service.remaining('small'), 2);
});

test('an unknown event is refused', async () => {
  const { service } = setup();
  await assert.rejects(service.book('nope', 'u1'), { code: 'UNKNOWN_EVENT' });
});
