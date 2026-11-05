# Feature request: stock reservations

Status: approved. Owner: Sales Operations.

## What we want

Sales staff need to hold stock for a customer while an order is being confirmed. Today they lower the stock count by hand and put it back later, which causes mistakes.

1. A reservation holds a quantity of one item for 15 minutes. After that the hold ends by itself and the stock is available again.
2. `POST /items/:id/reserve` with `{ "qty": n }` creates a reservation and returns its id and expiry time. It needs the admin token. It answers 400 for a missing or non-integer qty, 404 for an unknown item and 409 when fewer than qty units are available.
3. `DELETE /reservations/:id` releases a reservation early. It needs the admin token and answers 404 for an unknown or already ended reservation.
4. Available quantity is the stock minus the active reservations. `GET /items/:id` shows both numbers.
5. The reorder report must use the available quantity, not the stock count.
6. The README must describe the new routes, their error codes and the 15-minute rule.

## Load

During the morning rush up to 50 reserve requests can arrive for the same item within one second. Stock must never be oversold.

## Notes from the platform team

The production store is a SQL database. Schema changes are applied by a migration script that runs before a new version is deployed. Existing items must show their full stock as available from the first minute after the release.
