# Architecture overview

## Existing system

- Web app for members and staff, behind an HTTP API.
- Catalog service: titles, copies, checkouts and returns. Publishes a "copy returned" event.
- Member service: accounts, roles (member, librarian, manager) and email addresses.
- Shared relational database per service. No message broker beyond the catalog event.

## Planned for holds

- HoldService behind the same HTTP API.
- HoldQueueStore: a table of holds.
- Notifier: sends email through the existing mail relay.

## Hold entity (draft)

| Field | Type | Notes |
|-------|------|-------|
| id | string | |
| titleId | string | |
| memberId | string | |
| status | string | queued, reserved, fulfilled, cancelled, expired |
| createdAt | timestamp | queue order |
| reservedUntil | timestamp | set when a copy is reserved |

## API sketch

| Method | Path | Who |
|--------|------|-----|
| POST | /titles/{id}/holds | member |
| GET | /members/me/holds | member |
| DELETE | /holds/{id} | member or librarian |
| GET | /titles/{id}/holds | librarian |
