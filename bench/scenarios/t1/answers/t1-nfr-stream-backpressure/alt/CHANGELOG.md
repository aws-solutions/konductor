# Changelog

## 2.5.0

- Added backpressure handling to the export endpoint:
  - Respects `maxBufferedBytes` limit (default 64) to prevent memory overflow
  - Waits for `drain` event when sink.write() returns false
  - Does not fetch new pages while sink buffer is full
  - Properly handles sink close event: stops writes/fetches and closes source
  - Closes source after normal completion and after fetchPage errors
  - On fetchPage error: preserves written records, appends error record, ends once
  - Sets status 500 only when no records were written before error
  - Continues through empty pages (not treated as end markers)

## 2.4.0

- Clarified the export response format and local data source behaviour.

## 2.3.0

- Added the health endpoint and a small command-line entry point.
