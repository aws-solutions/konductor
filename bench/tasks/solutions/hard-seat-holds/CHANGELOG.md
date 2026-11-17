# Changelog

## Unreleased

- Concurrent bookings no longer oversell: the seat and the user's hold are taken in one step under a lock per event.
- A charge times out after `timeoutMs`, a caller can abort through `signal`, and both abort the charge and free the seat.
- A failed confirmation is counted in `stats().notifyFailures` instead of failing the booking or going unhandled.

## 0.3.0

- Events are read from `config/events.json`.
- `remaining(eventId)` reports free seats.

## 0.2.0

- Bookings are kept in the async store instead of a local map.
