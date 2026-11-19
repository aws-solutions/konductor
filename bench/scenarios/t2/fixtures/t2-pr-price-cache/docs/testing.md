# Testing

Tests use only `node:test` and `node:assert/strict`. Repository tests use temporary directories, while service tests use small in-memory fakes. This keeps the suite fast and avoids mutating the checked-in sample files.
