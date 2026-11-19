# Changelog

## 0.5.0 - 2024-02-02

- Reduced monthly report database work to a fixed joined query.
- Streamed CSV and JSON rows so large reports do not need a full in-memory copy.
- Validate month arguments before opening a report.

## 0.4.0 - 2024-02-01

- Added JSON output for scheduled reports.
- Added a month option to the command line tool.

## 0.3.0 - 2023-11-15

- Added customer email addresses to report rows.
- Added fixture loading and sample data checks.

## 0.2.0 - 2023-08-12

- Report totals are represented as integer cents.
