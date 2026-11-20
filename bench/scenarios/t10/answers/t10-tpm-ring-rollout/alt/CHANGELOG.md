# Changelog

All notable changes are recorded here.

## 1.6.0 - 2024-07-22

- Added the inbox delivery adapter.
- Moved service settings into `config/`.

## 1.7.0 - 2024-11-06

- Accepted decimal currency inputs at the API boundary.
- Improved malformed receipt error messages.

## 1.8.0 - 2025-02-14

- Added receipt delivery retry limits.
- Recorded renderer timing in service diagnostics.

## Unreleased

- Added ring-aware receipt PDF rollout state with serialized promotion and explicit rollback.
- Added the snapshot go/no-go command with PROMOTE, HOLD, and ROLLBACK outcomes.
- Kept the legacy receipt generator available for existing consumers during migration.
