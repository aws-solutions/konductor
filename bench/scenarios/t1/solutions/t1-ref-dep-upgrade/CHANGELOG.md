# Changelog

## 1.4.3 - 2025-02-18

- Migrated report rendering to the bundled Gridline 2 formatter.
- Table output now uses Gridline 2 plain numeric defaults, and compact output uses its tab-separated renderer.
- CSV output now includes the Gridline 2 terminating newline and escaping rules.

## 1.4.2 - 2025-02-14

- Added a compact view for terminal triage.
- Added CSV output for monthly exports.
- Kept the bundled table helper under `vendor/` so reports can run offline.

## 1.4.1 - 2025-01-20

- Made invalid input errors include the source filename.
- Updated the sample sales export.
