# Requirements: Exports

## Introduction
Export query results to CSV.

## Requirements

### Requirement 1
**User Story:** As an analyst, I want CSV exports, so that I can use spreadsheets.
#### Acceptance Criteria
1. WHEN a user requests an export THEN the system SHALL produce a CSV.
2. WHEN an export exceeds 100,000 rows THEN the system SHALL split it into parts.
