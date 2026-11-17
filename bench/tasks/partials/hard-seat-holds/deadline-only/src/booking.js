'use strict';

const { BookingError } = require('./errors');
const { createIdSource } = require('./ids');
const { runWithDeadline } = require('./deadline');

const DEFAULT_TIMEOUT_MS = 2000;

const seatsKey = (eventId) => `seats:${eventId}`;
const bookingKey = (eventId, userId) => `booking:${eventId}:${userId}`;

function createBookingService({ store, payments, notifier, events, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const ids = createIdSource('b');
  let confirmed = 0;
  let notifyFailures = 0;

  function eventOf(eventId) {
    const event = events[eventId];
    if (!event) throw new BookingError('UNKNOWN_EVENT', `unknown event ${eventId}`);
    return event;
  }

  async function remaining(eventId) {
    const left = await store.get(seatsKey(eventId));
    return left === undefined ? eventOf(eventId).capacity : left;
  }

  async function book(eventId, userId, { signal } = {}) {
    const event = eventOf(eventId);
    if (signal?.aborted) throw new BookingError('ABORTED', 'aborted');
    if (await store.get(bookingKey(eventId, userId))) throw new BookingError('DUPLICATE', 'duplicate');
    const left = await remaining(eventId);
    if (left <= 0) throw new BookingError('SOLD_OUT', 'sold out');
    await runWithDeadline((chargeSignal) => payments.charge({ eventId, userId, amountCents: event.priceCents, signal: chargeSignal }), {
      timeoutMs,
      callerSignal: signal,
      onError: (err) => new BookingError('PAYMENT_FAILED', `payment failed: ${err.message}`),
    });
    await store.set(seatsKey(eventId), left - 1);
    const booking = { bookingId: ids.next(), eventId, userId };
    await store.set(bookingKey(eventId, userId), booking);
    confirmed++;
    Promise.resolve().then(() => notifier.send(booking)).catch(() => { notifyFailures++; });
    return booking;
  }

  return { book, remaining, stats: () => ({ confirmed, notifyFailures }) };
}

module.exports = { createBookingService, DEFAULT_TIMEOUT_MS };
