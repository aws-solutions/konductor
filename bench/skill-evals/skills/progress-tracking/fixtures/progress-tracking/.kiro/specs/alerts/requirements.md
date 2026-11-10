# Requirements: Alerts

## Introduction
Notify users when a watched metric crosses a threshold.

## Requirements

### Requirement 1
**User Story:** As an operator, I want to define thresholds, so that I get alerted.
#### Acceptance Criteria
1. WHEN a user saves a threshold THEN the system SHALL persist it.
2. WHEN a threshold is invalid THEN the system SHALL reject it with an error.

### Requirement 2
**User Story:** As an operator, I want alert notifications, so that I can react.
#### Acceptance Criteria
1. WHEN a metric crosses a threshold THEN the system SHALL create an alert.
2. WHEN an alert is created THEN the system SHALL email the owner.
3. WHEN the same alert fires twice within 10 minutes THEN the system SHALL suppress the duplicate.
