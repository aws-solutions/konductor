'use strict';

const { BookingError } = require('./errors');
const { createIdSource } = require('./ids');
const { createKeyedLock } = require('./lock');
const { runWithDeadline } = require('./deadline');

const DEFAULT_TIMEOUT_MS = 2000;
const HOLD = { pending: true };

const seatsKey = (eventId) => `seats:${eventId}`;
const bookingKey = (eventId, userId) => `booking:${eventId}:${userId}`;

function createBookingService({ store, payments, notifier, events, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const ids = createIdSource('b');
  // One process per host (docs/OPERATIONS.md), so a lock per event in memory guards the store's read and write.
  const withLock = createKeyedLock();
  let confirmed = 0;
  let notifyFailures = 0;

  function eventOf(eventId) {
    const event = events[eventId];
    if (!event) throw new BookingError('UNKNOWN_EVENT', `unknown event ${eventId}`);
    return event;
  }

  async function freeSeats(eventId) {
    const left = await store.get(seatsKey(eventId));
    return left === undefined ? eventOf(eventId).capacity : left;
  }

  async function remaining(eventId) {
    eventOf(eventId);
    return withLock(eventId, () => freeSeats(eventId));
  }

  // Takes a seat and marks the user as paying, in one step under the event lock.
  function reserve(eventId, userId) {
    return withLock(eventId, async () => {
      if (await store.get(bookingKey(eventId, userId))) throw new BookingError('DUPLICATE', `${userId} already holds a seat for ${eventId}`);
      const left = await freeSeats(eventId);
      if (left <= 0) throw new BookingError('SOLD_OUT', `${eventId} is sold out`);
      await store.set(seatsKey(eventId), left - 1);
      await store.set(bookingKey(eventId, userId), HOLD);
    });
  }

  function release(eventId, userId) {
    return withLock(eventId, async () => {
      await store.set(seatsKey(eventId), (await freeSeats(eventId)) + 1);
      await store.set(bookingKey(eventId, userId), undefined);
    });
  }

  function confirm(booking) {
    confirmed++;
    // A confirmation is best effort: its failure is counted, never thrown at the caller and never left unhandled.
    Promise.resolve().then(() => notifier.send(booking)).catch(() => { notifyFailures++; });
  }

  async function book(eventId, userId, { signal } = {}) {
    const event = eventOf(eventId);
    if (signal?.aborted) throw new BookingError('ABORTED', 'the caller cancelled the booking');
    await reserve(eventId, userId);
    try {
      await runWithDeadline((chargeSignal) => payments.charge({ eventId, userId, amountCents: event.priceCents, signal: chargeSignal }), {
        timeoutMs,
        callerSignal: signal,
        onError: (err) => new BookingError('PAYMENT_FAILED', `payment failed: ${err.message}`),
      });
    } catch (err) {
      await release(eventId, userId);
      throw err;
    }
    const booking = { bookingId: ids.next(), eventId, userId };
    await withLock(eventId, () => store.set(bookingKey(eventId, userId), booking));
    confirm(booking);
    return booking;
  }

  const stats = () => ({ confirmed, notifyFailures });

  return { book, remaining, stats };
}

module.exports = { createBookingService, DEFAULT_TIMEOUT_MS };
