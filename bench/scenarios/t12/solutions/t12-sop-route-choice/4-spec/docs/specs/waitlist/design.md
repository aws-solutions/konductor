# Waitlist: design

## Data

A waitlist entry: `{ room, date, guest, joinedAt }`, kept per room and date in join order. An offer:
`{ room, date, guest, offeredAt, expiresAt }`, with `expiresAt` two hours after `offeredAt`.

## Flow

- Join (WL-1, WL-2): the clash check in `src/overlap.js` decides whether the room is fully booked; the list refuses a
  sixth entry.
- Cancel (WL-4): the cancellation path calls the waitlist after it has worked out the refund; the first entry gets an
  offer.
- Expiry (WL-5): a job that runs every minute moves expired offers to the next entry; an empty list ends the chain.
- Accept (WL-6): the offer turns into a normal booking request, so the clash check runs again.

## Not decided here

Ordering for loyalty members (open question in requirements.md). The design keeps the order in one function so either
answer is a small change.
