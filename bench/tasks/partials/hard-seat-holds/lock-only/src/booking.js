'use strict';

const { BookingError } = require('./errors');
const { createIdSource } = require('./ids');
const { createKeyedLock } = require('./lock');

const DEFAULT_TIMEOUT_MS = 2000;

const seatsKey = (eventId) => `seats:${eventId}`;
const bookingKey = (eventId, userId) => `booking:${eventId}:${userId}`;

function createBookingService({ store, payments, notifier, events }) {
  const ids = createIdSource('b');
  const withLock = createKeyedLock();
  let confirmed = 0;
  const notifyFailures = 0;

  function eventOf(eventId) {
    const event = events[eventId];
    if (!event) throw new BookingError('UNKNOWN_EVENT', `unknown event ${eventId}`);
    return event;
  }

  async function freeSeats(eventId) {
    const left = await store.get(seatsKey(eventId));
    return left === undefined ? eventOf(eventId).capacity : left;
  }

  const remaining = async (eventId) => { eventOf(eventId); return withLock(eventId, () => freeSeats(eventId)); };

  async function book(eventId, userId) {
    const event = eventOf(eventId);
    await withLock(eventId, async () => {
      if (await store.get(bookingKey(eventId, userId))) throw new BookingError('DUPLICATE', 'duplicate');
      const left = await freeSeats(eventId);
      if (left <= 0) throw new BookingError('SOLD_OUT', 'sold out');
      await store.set(seatsKey(eventId), left - 1);
      await store.set(bookingKey(eventId, userId), { pending: true });
    });
    try {
      await payments.charge({ eventId, userId, amountCents: event.priceCents });
    } catch (err) {
      await withLock(eventId, async () => {
        await store.set(seatsKey(eventId), (await freeSeats(eventId)) + 1);
        await store.set(bookingKey(eventId, userId), undefined);
      });
      throw new BookingError('PAYMENT_FAILED', `payment failed: ${err.message}`);
    }
    const booking = { bookingId: ids.next(), eventId, userId };
    await store.set(bookingKey(eventId, userId), booking);
    confirmed++;
    notifier.send(booking);
    return booking;
  }

  return { book, remaining, stats: () => ({ confirmed, notifyFailures }) };
}

module.exports = { createBookingService, DEFAULT_TIMEOUT_MS };
