# HTTP API

The service keeps its API intentionally small. `/health` returns `{"ok":true}` with a JSON content type. `/export` returns `application/x-ndjson`; each non-empty source record is serialized with `JSON.stringify` and followed by a newline.

The export code can also be used without an HTTP server. `createExportHandler({ source, maxBufferedBytes })` returns a request handler, and `exportRecords({ source, sink, maxBufferedBytes })` writes to a Node-style response sink. A source is made with `createPagedSource(pages)` where each page is an array of ordinary JavaScript values.

## Backpressure Handling

The `maxBufferedBytes` parameter (default 64) controls how many bytes may be buffered before waiting. When `sink.bufferedBytes` approaches this limit, the export pauses writing and waits for the `drain` event before continuing. This prevents memory exhaustion when the downstream consumer cannot keep up with the export rate. New pages are not fetched while the sink buffer is full.

## Error Handling

On a `fetchPage` error, any successfully written records are preserved, and an error record `{"error":"export failed"}` is appended. The response status is set to 500 only when no records were written before the error occurred.
