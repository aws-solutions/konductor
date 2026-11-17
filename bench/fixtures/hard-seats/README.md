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

## Layout

- `src/index.js` public exports
- `src/booking.js` the booking service
- `src/store.js` async key-value store (the production store is a network service; this one is in memory)
- `src/payments.js` fake payment gateway used in examples and tests
- `src/notifier.js` confirmation sender
- `src/errors.js` `BookingError`
- `src/ids.js` booking ids
- `src/events.js` reads `config/events.json` (events, capacity and price)
