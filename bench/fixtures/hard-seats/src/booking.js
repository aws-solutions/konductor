'use strict';

const { BookingError } = require('./errors');
const { createIdSource } = require('./ids');

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
    const event = eventOf(eventId);
    const left = await store.get(seatsKey(eventId));
    return left === undefined ? event.capacity : left;
  }

  async function book(eventId, userId, { signal } = {}) {
    const event = eventOf(eventId);
    const existing = await store.get(bookingKey(eventId, userId));
    if (existing) throw new BookingError('DUPLICATE', `${userId} already booked ${eventId}`);
    const left = await remaining(eventId);
    if (left <= 0) throw new BookingError('SOLD_OUT', `${eventId} is sold out`);
    try {
      await payments.charge({ eventId, userId, amountCents: event.priceCents });
    } catch (err) {
      throw new BookingError('PAYMENT_FAILED', `payment failed: ${err.message}`);
    }
    await store.set(seatsKey(eventId), left - 1);
    const booking = { bookingId: ids.next(), eventId, userId };
    await store.set(bookingKey(eventId, userId), booking);
    confirmed++;
    notifier.send(booking);
    return booking;
  }

  const stats = () => ({ confirmed, notifyFailures });

  return { book, remaining, stats };
}

module.exports = { createBookingService, DEFAULT_TIMEOUT_MS };
