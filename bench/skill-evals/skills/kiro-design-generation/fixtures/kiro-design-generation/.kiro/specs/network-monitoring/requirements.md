# Requirements Document: network-monitoring

## Introduction

Network engineers create monitors that probe an endpoint on a schedule and alert when it fails. Target: 2,000 monitors per account, probe results visible within 60 s.

## Requirements

### Requirement 1: Create monitor

**User Story:** As a network engineer, I want to create a monitor for an endpoint, so that I know when it goes down.

#### Acceptance Criteria

1. WHEN a user submits a valid monitor (name, target URL, interval 60-3600 s) THEN the system SHALL store it and return its id.
2. IF a monitor with the same name exists in the account THEN the system SHALL reject the request with a conflict error.

### Requirement 2: List and get monitors

**User Story:** As a network engineer, I want to list my monitors, so that I can see their status.

#### Acceptance Criteria

1. WHEN a user lists monitors THEN the system SHALL return at most 50 per page with a continuation token.
2. WHEN a user requests a monitor id that does not exist THEN the system SHALL return not found.

### Requirement 3: Probe and alert

**User Story:** As a network engineer, I want to be alerted when a probe fails 3 times in a row, so that I can react.

#### Acceptance Criteria

1. WHEN a monitor's interval elapses THEN the system SHALL probe the target with a 10 s timeout.
2. WHEN 3 consecutive probes fail THEN the system SHALL publish an alert to the account's SNS topic.

### Requirement 4: Pause monitor

**User Story:** As a network engineer, I want to pause a monitor during maintenance, so that I don't get false alerts.

#### Acceptance Criteria

1. WHEN a user pauses a monitor THEN the system SHALL stop probing it until resumed.
2. IF the caller does not own the monitor's account THEN the system SHALL deny the request.
