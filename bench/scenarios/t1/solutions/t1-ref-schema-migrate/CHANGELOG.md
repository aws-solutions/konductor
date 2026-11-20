# Changelog

## 2.5.0 - 2025-03-02

- Split customer address fields into the `addresses` table.
- Backfilled populated addresses while leaving customers without addresses unchanged.
- Added a reversible address migration and moved repository reads and writes to the new relation.

## 2.4.0 - 2025-02-14

- Added customer source tracking.
- Added customer event storage for support imports.
- Improved the seed command output.
