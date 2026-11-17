# seat-desk

Books seats for small events. A booking takes one seat, charges the user and sends a confirmation.

## Usage

```js
const { createBookingService, createStore, createFakePayments, createNotifier, loadEvents } = require('./src');

const service = createBookingService({
  store: createStore(),
  payments: createFakePayments(),
  notifier: createNotifier(),
  events: loadEvents(),
});
const booking = await service.book('launch-night', 'user-1');
// { bookingId: 'b-1', eventId: 'launch-night', userId: 'user-1' }
await service.remaining('launch-night'); // 39
```

`book` rejects with a `BookingError` whose `code` says why (see `docs/BOOKING-SPEC.md`).

## Concurrent calls

Many `book` calls for one event may run at once. Each call takes its seat and marks the user as paying in one step
under a lock per event (`src/lock.js`), then charges outside the lock. A charge that fails, passes `timeoutMs`
(default 2000) or is aborted through the caller's `signal` gives the seat back, and the signal passed to
`payments.charge` is aborted so the gateway stops the charge (`src/deadline.js`). The lock lives in memory, which
is enough for one process per host (`docs/OPERATIONS.md`).

A confirmation that fails does not fail the booking. It is counted in `stats().notifyFailures`.

## Layout

- `src/index.js` public exports
- `src/booking.js` the booking service
- `src/store.js` async key-value store (the production store is a network service; this one is in memory)
- `src/payments.js` fake payment gateway used in examples and tests
- `src/notifier.js` confirmation sender
- `src/errors.js` `BookingError`
- `src/ids.js` booking ids
- `src/lock.js` lock per key for one process
- `src/deadline.js` timeout and cancel for the charge
- `src/events.js` reads `config/events.json` (events, capacity and price)
