# Requirements Document: tag-sync

## Introduction

Copy tags from monitors to their probe results' CloudWatch metrics so dashboards can filter by tag. Depends on the Tag entity owned by tag-management.

## Requirements

### Requirement 1: Sync on tag change

**User Story:** As an engineer, I want metric dimensions to follow monitor tags, so that dashboards stay accurate.

#### Acceptance Criteria

1. WHEN a tag is added to or removed from a monitor THEN the system SHALL update the monitor's metric dimensions within 5 minutes.
2. IF CloudWatch throttles the update THEN the system SHALL retry with backoff up to 5 times.

### Requirement 2: Backfill

**User Story:** As an admin, I want to backfill dimensions for existing monitors, so that old dashboards work.

#### Acceptance Criteria

1. WHEN an admin starts a backfill THEN the system SHALL process all monitors in the account and report progress.
