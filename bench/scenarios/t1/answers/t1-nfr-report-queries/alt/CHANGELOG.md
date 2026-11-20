# Changelog

## 0.5.0 - 2024-03-15

- Optimized report generation to use at most 3 SQL queries per month (now uses a single query).
- Reduced memory usage to stay below 8 MiB for 12,000 order rows by streaming results.
- Added optional connection parameter to ReportDatabase for instrumented database work.
- Added month validation to reject malformed inputs at the CLI.
- Fixed ordering to match expected output exactly (customer_id, order_date, order_id).

## 0.4.0 - 2024-02-01

- Added JSON output for scheduled reports.
- Added a month option to the command line tool.

## 0.3.0 - 2023-11-15

- Added customer email addresses to report rows.
- Added fixture loading and sample data checks.

## 0.2.0 - 2023-08-12

- Report totals are represented in integer cents.
