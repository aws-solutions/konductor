# Implementation plan: hold-requests

- [ ] 1. Create the hold table and statuses
  - Add the Hold table with indexes on (titleId, status, createdAt) and (memberId, status).
  - _Requirements: 1, 2, 3, 5 (REQ-1, REQ-2, REQ-4)_
- [ ] 2. Build HoldQueueStore
  - [ ] 2.1 add, listByTitle, listByMember, positionOf
  - [ ] 2.2 claimHead with a row lock so concurrent returns claim different holds
  - _Requirements: 2, 3 (REQ-2, US-2)_
- [ ] 3. Build HoldService placement rules
  - [ ] 3.1 Reject when a copy is available
  - [ ] 3.2 Enforce the 5 active holds limit and reject duplicates
  - _Requirements: 1 (REQ-1, REQ-7, US-1)_
- [ ] 4. Handle returned copies
  - [ ] 4.1 Subscribe to the catalog "copy returned" event
  - [ ] 4.2 Reserve the head of the queue for the configured window
  - _Requirements: 4 (REQ-3, US-3)_
- [ ] 5. Build the Notifier
  - [ ] 5.1 Send the ready email with the reservation end
  - [ ] 5.2 Record notifyFailed on bounce or missing address, with retries
  - _Requirements: 4 (REQ-8, US-3)_
- [ ] 6. Cancel and staff removal
  - [ ] 6.1 Member cancel and offer the copy to the next member
  - [ ] 6.2 Librarian removal with a required reason
  - _Requirements: 5, 6 (REQ-4, REQ-5, US-4, US-5)_
- [ ] 7. Expiry job
  - Expire reserved holds past reservedUntil and reserve the next member.
  - _Requirements: 7 (REQ-6)_
- [ ] 8. Build the HTTP API
  - [ ] 8.1 Member routes: place, list with position, cancel
  - [ ] 8.2 Librarian routes: view queue, remove
  - _Requirements: 1, 3, 5, 6 (US-1, US-2, US-4, US-5)_
- [ ] 9. Retention cleanup
  - Delete finished holds older than 90 days (value pending a decision).
  - _Requirements: 9_
- [ ] 10. Tests and load test
  - [ ] 10.1 Unit and store tests including concurrent claimHead
  - [ ] 10.2 Load test at 50 write requests per second, median under 300 ms
  - _Requirements: 2, 8 (REQ-9)_

## Traceability

| Requirement | Design section | Tasks |
|-------------|----------------|-------|
| 1 Place a hold (REQ-1, REQ-7) | HoldService, Error Handling | 1, 3, 8 |
| 2 Queue order (REQ-2) | HoldQueueStore | 1, 2, 10 |
| 3 Position (US-2) | Data Models | 2, 8 |
| 4 Ready email (REQ-3, REQ-8) | Notifier, Error Handling | 4, 5 |
| 5 Cancel (REQ-4) | HoldService | 6, 8 |
| 6 Staff queue (REQ-5) | HTTP API | 6, 8 |
| 7 Expiry (REQ-6) | HoldService | 7 |
| 8 Performance (REQ-9) | Testing Strategy | 10 |
| 9 Retention | Data Models | 9 |
