# Changelog

## 1.5.0

- Fixed high memory usage for large NDJSON exports by streaming records in a single pass.
- Added support for gzipped `.ndjson.gz` input files.
- Improved percentile calculation to use exact nearest-rank method without storing all latencies.
- Added `malformed_lines` count to the report for skipped invalid lines.
- Added latency range validation (0-60000 ms) and improved status code validation.
- Peak memory usage now stays under 8 MiB for 100,000 records.

## 1.4.0

- Clarified the report field names and sample invocation.
- Refreshed the CI job used for the nightly utility.

## 1.3.0

- Added endpoint error totals to the JSON report.
