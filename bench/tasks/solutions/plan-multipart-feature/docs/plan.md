# Plan: stock reservations

Goal: let sales staff hold stock for 15 minutes without lowering the stock count by hand. This is a work breakdown only. Nothing is implemented here.

Scope: the five parts in the request and the platform note. Out of scope: customer accounts, notifications and a reservation history screen.

## Tasks

### T1. Migration and backfill

- Covers: a reservations table and the stored reserved quantity, with every existing item backfilled to nothing reserved.
- Depends on: nothing. This is the first task and it is applied before the new version is deployed.
- Done when: the migration runs on a copy of the data, every existing item reports its full stock as available, and the rollback script restores the old schema.

### T2. Reservation service

- Covers: reserve and release, the 15 minute expiry, and available quantity as stock minus active reservations. The reserve step uses one atomic check so concurrent requests cannot oversell.
- Depends on: T1, because the service reads and writes the new schema.
- Done when: unit tests pass for reserve, release, expiry after 15 minutes, a reserve above the available quantity, and a concurrency test with 50 parallel reserve calls on one item that never reserves more than the stock.

### T3. Routes

- Covers: `POST /items/:id/reserve` and `DELETE /reservations/:id` with the admin token check and the 400, 404 and 409 answers.
- Depends on: T2, because the handlers call the service.
- Done when: handler tests show 403 without the token, 400 for a missing or fractional qty, 404 for an unknown item or reservation, 409 when fewer units are available, and 201 and 200 on success.

### T4. Read paths

- Covers: `GET /items/:id` shows stock and available, and the reorder report uses available quantity.
- Depends on: T2, because both read the available quantity from the service.
- Done when: a test shows an item with 10 in stock and 4 reserved reports 6 available, and the reorder report lists an item whose available quantity is at or below its reorder level.

### T5. Documentation

- Covers: README routes, error codes and the 15 minute rule.
- Depends on: nothing. The request fixes the route contract, so this can run in parallel with T1 to T4.
- Done when: the README lists both routes with their error codes, and a reviewer confirms each statement matches the request.

## Order and parallel work

T1, then T2, then T3 and T4 together. T5 runs in parallel from the start. The critical path is T1, T2, T3.

## Risks

- Deploy order. If the new version runs before the migration, reads of the reserved quantity fail on existing items. Mitigation: T1 is applied first, the backfill is part of it, and the release steps say so.
- Oversell under load. Fifty requests in one second can read the same quantity. Mitigation: an atomic check in T2 and the concurrency test in its done check. A spike on the locking choice comes first if the store has no row lock.
- Expiry without a sweeper. Reservations that expire but are not removed could keep counting. Mitigation: count only reservations whose expiry time is in the future, and test it in T2.
