# Changelog

## 2.5.0 - 2025-03-01

- Split customer addresses into a dedicated `addresses` table via migration 013.
- Migration moves existing address data, removes legacy columns from `customers`, and supports rollback.
- Repository operations now use the split table while preserving the `address` object interface.

## 2.4.0 - 2025-02-14

- Added customer source tracking.
- Added customer event storage for support imports.
- Improved the seed command output.

## 2.3.0 - 2024-11-03

- Added archived customer records.
- Added customer tags and notes tables.

## 2.2.0 - 2024-06-19

- Added the initial migration runner.
