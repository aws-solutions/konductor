# Hold service design

## Summary

The hold service lets members queue for a title with no available copy, reserves a returned copy for the first member, emails them, and releases the copy if nobody collects it. It is a new module behind the existing HTTP API with its own table in the existing relational database.

## Conflicts and gaps in the requirements

- Reservation window: REQ-3 says 7 days, REQ-6 says 5 days. These conflict. I use a single setting, default 5 days, because REQ-6 is the rule that triggers the release; the product owner must confirm the number.
- REQ-7 (5 active holds) has no story and no stated error. I return 409 with the limit in the message.
- REQ-8 and the open questions leave bounced email and missing addresses undefined. See Notifications.
- Two copies returned within seconds: assignment is undefined. See Returns.
- US-2 shows a position but no requirement defines it. I compute it from the queue.
- REQ-9 does not say what the 50 requests per second measures. I assume writes (place and cancel) and report reads separately.
- Retention of finished holds is an open question; I assume 90 days.
- US-6 (weekly report) is out of scope and not designed here.

## Assumptions

1. The catalog service publishes a "copy returned" event with the title and copy ids, at least once.
2. The member service returns an email address, which may be empty.
3. One database transaction can lock a row (`FOR UPDATE SKIP LOCKED` or equivalent).
4. Fines do not block holds in this release.

## Components and responsibilities

- HoldService: place, cancel, remove and expire holds; reacts to returned copies. The only writer of hold state.
- HoldQueueStore: persists holds, orders them and claims the head of a queue atomically.
- Notifier: sends the "ready" email through the existing mail relay and reports success or failure.
- Expiry job: runs every minute inside the service and calls `expireReservations`.

## Data model

Table `hold`:

| Column | Type | Notes |
|--------|------|-------|
| id | string | primary key |
| title_id | string | index (title_id, status, created_at) |
| member_id | string | index (member_id, status) |
| status | enum | queued, reserved, fulfilled, cancelled, expired |
| created_at | timestamp | defines queue order, id breaks ties |
| reserved_until | timestamp | set when reserved |
| notify_failed | boolean | set when the email could not be delivered |
| removal_reason | string | set when a librarian removes the hold |

Status flow: queued, reserved, then fulfilled. A hold can be cancelled from queued or reserved and can expire from reserved.

## API

| Method | Path | Who | Result |
|--------|------|-----|--------|
| POST | /titles/{id}/holds | member | 201 with the hold; 409 if a copy is available or the member has 5 active holds |
| GET | /members/me/holds | member | holds with position |
| DELETE | /holds/{id} | member or librarian | 204; librarians must send a reason (400 without) |
| GET | /titles/{id}/holds | librarian | the queue in order with member and date |

Position of a queued hold = number of queued holds for the title with an earlier `created_at`, plus one. It is computed on read, so it stays right when others cancel.

## Queue ordering and the reservation window

The queue is ordered by `created_at`, then `id`. When a hold becomes reserved, `reserved_until` is set to now plus the configured window (default 5 days). The expiry job selects reserved holds past `reserved_until`, marks them expired and runs the same claim step for the next member.

## Returns, including two at once

On a "copy returned" event, HoldService calls `claimHead(title_id, reserved_until)`. It runs one transaction: select the oldest queued hold for the title with `FOR UPDATE SKIP LOCKED`, set it to reserved, commit. Two copies returned at the same moment run two transactions; the second skips the row the first locked and takes the next hold, so no member receives both copies and no copy is lost. If the queue is empty the copy goes back on the shelf. Duplicate events are harmless because a copy id is recorded with the reservation.

## Notification failures

The email is sent after the transaction commits. If the relay fails, retry with backoff up to three times. If the member has no address or the email bounces, set `notify_failed` and show it in the librarian queue view. A notification failure never blocks the reservation or expiry: the copy stays reserved for the full window.

## Testing

- Unit tests for the rules: available-copy rejection, the 5-hold limit, duplicate holds.
- Store tests on a real database: ordering, position after a cancel, and two concurrent `claimHead` calls returning different holds.
- Notifier tests with a fake relay for success, bounce and missing address.
- Expiry tests with an injected clock.
- A load test at 50 write requests per second with the median under 300 ms.
