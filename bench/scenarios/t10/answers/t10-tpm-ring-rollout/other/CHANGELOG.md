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

- Receipt PDFs now roll out ring by ring (staff, pilot, regional, general) with one promotion at a time and an explicit rollback.
- New go/no-go script answers PROMOTE/HOLD/ROLLBACK from a metrics snapshot.
- The old generator stays in place for Ledger Lantern until its migration ends.
