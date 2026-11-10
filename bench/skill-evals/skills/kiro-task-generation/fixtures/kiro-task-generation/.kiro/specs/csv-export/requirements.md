# Requirements Document: CSV Export

## Introduction

Workspace admins can export the task list of a project as CSV.

## Requirements

### Requirement 1

**User Story:** As a workspace admin, I want to export a project's tasks as CSV, so that I can analyze them in a spreadsheet.

#### Acceptance Criteria

1.1 WHEN an admin requests an export for a project THEN the system SHALL create an export job and return its id.
1.2 WHEN the job completes THEN the CSV SHALL contain one row per task with columns id, title, status, assignee, dueDate.
1.3 IF the project has more than 50,000 tasks THEN the system SHALL reject the request with a clear error.

### Requirement 2

**User Story:** As a workspace admin, I want to download a finished export, so that I can open it locally.

#### Acceptance Criteria

2.1 WHEN the export is ready THEN the system SHALL return a download URL valid for 15 minutes.
2.2 IF the export is not ready THEN the system SHALL return its current status instead of a URL.

### Requirement 3

**User Story:** As a security officer, I want exports restricted to admins of the same workspace, so that task data does not leak.

#### Acceptance Criteria

3.1 IF a non-admin requests an export THEN the system SHALL respond with 403.
3.2 IF a user requests an export from another workspace THEN the system SHALL respond with 404.

### Requirement 4

**User Story:** As a workspace admin, I want special characters handled correctly, so that the file opens cleanly.

#### Acceptance Criteria

4.1 WHEN a field contains a comma, quote, or newline THEN the CSV SHALL quote and escape it per RFC 4180.
4.2 WHEN a field starts with =, +, - or @ THEN the system SHALL prefix it with a single quote to prevent formula injection.
