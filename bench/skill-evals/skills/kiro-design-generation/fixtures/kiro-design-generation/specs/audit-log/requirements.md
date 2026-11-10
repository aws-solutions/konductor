# Requirements Document: audit-log

## Introduction

Record every create/pause/delete action on monitors so security can review who changed what.

## Requirements

### Requirement 1: Record actions

**User Story:** As a security reviewer, I want each monitor mutation recorded with actor, action, time and before/after values, so that I can audit changes.

#### Acceptance Criteria

1. WHEN a monitor is created, paused, resumed or deleted THEN the system SHALL write an audit record within 5 s.
2. The system SHALL retain audit records for 400 days.

### Requirement 2: Query actions

**User Story:** As a security reviewer, I want to query audit records by monitor and time range, so that I can investigate.

#### Acceptance Criteria

1. WHEN a reviewer queries by monitor id and time range THEN the system SHALL return matching records newest first, 100 per page.
2. IF the caller lacks the AuditReader role THEN the system SHALL deny the request.
