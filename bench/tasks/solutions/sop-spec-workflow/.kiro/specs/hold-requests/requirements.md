# Requirements: hold-requests

## Introduction

Members of the library can place a hold on a title that has no available copy, wait in a first-come queue, and get an email when a copy is reserved for them. Librarians can see and edit each queue. This document covers REQ-1 to REQ-9 and stories US-1 to US-5.

Out of scope: US-6 (the weekly hold report) is planned for a later feature.

Open decision: REQ-3 says a reserved copy is held for 7 days and REQ-6 says 5 days. These conflict. The criteria below use a configurable reservation window with a default of 5 days and mark the value as an open item for the product owner.

## Requirements

### Requirement 1: Place a hold (US-1, REQ-1, REQ-7)

**User Story:** As a member, I want to place a hold on a checked-out title so that I get it when it is returned.

#### Acceptance Criteria

1. WHEN a signed-in member places a hold on a title with no available copy, THE Hold Service SHALL add the hold to the end of that title's queue with status queued.
2. WHEN a member places a hold on a title that has an available copy, THE Hold Service SHALL reject the request and tell the member to borrow the copy instead.
3. IF a member already has 5 active holds, THEN THE Hold Service SHALL reject a new hold with a 409 response and an error message that states the limit.
4. IF a member already has an active hold on the same title, THEN THE Hold Service SHALL reject the duplicate hold.

### Requirement 2: Queue order (REQ-2)

**User Story:** As a member, I want holds served in the order they were made so that the queue is fair.

#### Acceptance Criteria

1. THE Hold Queue Store SHALL order the holds of a title by creation time, with the hold id as the tie-breaker.
2. WHEN two copies of the same title are returned at the same time, THE Hold Service SHALL assign each copy to a different member by claiming the head of the queue atomically.

### Requirement 3: See my place in line (US-2)

**User Story:** As a member, I want to see my hold position so that I know how long I may wait.

#### Acceptance Criteria

1. WHEN a member opens their holds, THE Hold Service SHALL return the position of each queued hold, counted from 1.
2. WHEN a hold ahead of a member is cancelled, expires or is removed, THE Hold Service SHALL return a position that is one lower on the next request.

### Requirement 4: Be told when a copy is ready (US-3, REQ-3, REQ-8)

**User Story:** As a member, I want an email when my hold is ready so that I can pick the book up.

#### Acceptance Criteria

1. WHEN a copy is returned and a hold is queued for the title, THE Hold Service SHALL set the first hold to reserved and set the reservation end to the configured window after now.
2. WHEN a hold becomes reserved, THE Notifier SHALL send the member an email that states how long the copy is reserved.
3. IF the email bounces or the member has no email address, THEN THE Hold Service SHALL keep the hold reserved and record a notification failure for staff to see.

### Requirement 5: Cancel a hold (US-4, REQ-4)

**User Story:** As a member, I want to cancel a hold so that I do not block others.

#### Acceptance Criteria

1. WHEN a member cancels one of their own holds before pickup, THE Hold Service SHALL set its status to cancelled.
2. WHEN a hold is cancelled, THE Hold Queue Store SHALL move each hold behind it up by one place.
3. IF a reserved hold is cancelled, THEN THE Hold Service SHALL offer the copy to the next queued member.

### Requirement 6: Manage the queue as staff (US-5, REQ-5)

**User Story:** As a librarian, I want to see and edit a title's hold queue so that I can fix mistakes.

#### Acceptance Criteria

1. WHEN a librarian opens a title's queue, THE Hold Service SHALL list the holds in order with the member and the date of each hold.
2. WHEN a librarian removes a hold, THE Hold Service SHALL require a reason and record it with the removal.
3. IF a librarian removes a hold without a reason, THEN THE Hold Service SHALL reject the request.

### Requirement 7: Reservation expiry (REQ-6)

**User Story:** As a member in a queue, I want unclaimed copies released so that I am not waiting for a book nobody collects.

#### Acceptance Criteria

1. WHEN a reserved hold passes its reservation end without pickup, THE Hold Service SHALL set it to expired and put the copy back on the shelf.
2. WHEN a hold expires and the title has queued holds, THE Hold Service SHALL reserve the copy for the next member and notify them.

### Requirement 8: Performance (REQ-9)

**User Story:** As the library, I want the service to cope with peak load so that members are not kept waiting.

#### Acceptance Criteria

1. WHILE the service receives 50 hold write requests per second, THE Hold Service SHALL answer with a median response time under 300 ms.
2. THE performance target SHALL be measured on writes (place and cancel), and read latency SHALL be reported separately.

### Requirement 9: Data retention (open question)

**User Story:** As staff, I want old holds cleaned up so that member data is not kept longer than needed.

#### Acceptance Criteria

1. WHEN a hold has been cancelled, fulfilled or expired for more than 90 days, THE Hold Queue Store SHALL delete it. The 90 days is an assumption pending a decision.
