# Booking service spec

`createBookingService({ store, payments, notifier, events, timeoutMs })` returns `{ book, remaining, stats }`.
`timeoutMs` defaults to 2000.

The service runs in a web server, so many `book` calls for the same event are in flight at once. The store is
async: every `get` and `set` waits for the store, and other calls run in between.

## book(eventId, userId, { signal })

Returns a promise of `{ bookingId, eventId, userId }`. On failure it rejects with a `BookingError`:

| code | when |
|---|---|
| `UNKNOWN_EVENT` | the event is not in `events` |
| `SOLD_OUT` | no seat is free when the call takes its seat |
| `DUPLICATE` | the user already holds or is buying a seat for this event |
| `PAYMENT_FAILED` | `payments.charge` rejected |
| `PAYMENT_TIMEOUT` | `payments.charge` did not settle within `timeoutMs` |
| `ABORTED` | the caller's `signal` was aborted before the booking was confirmed |

Rules:

1. Confirmed bookings for an event never exceed its `capacity`, however many calls run at once.
2. A user holds at most one seat per event. A second call while the first is still paying gets `DUPLICATE`.
3. A call takes its seat before it charges. If the charge fails, times out or is aborted, the seat is free again
   and the user may book again.
4. `payments.charge({ eventId, userId, amountCents, signal })` receives an `AbortSignal`. The service aborts it
   when the booking times out or the caller aborts, so the gateway can stop the charge.
5. If `signal` is already aborted, `book` rejects with `ABORTED` and does not charge.
6. After a booking is confirmed the service calls `notifier.send(booking)`. A failed or throwing send does not fail
   the booking; it adds one to `stats().notifyFailures`. Nothing may end as an unhandled rejection.

## remaining(eventId)

Promise of the number of free seats: `capacity` minus confirmed bookings minus seats held by calls still paying.

## stats()

`{ confirmed, notifyFailures }` across all events.
