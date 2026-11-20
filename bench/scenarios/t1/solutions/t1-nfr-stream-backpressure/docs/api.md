# HTTP API

The service keeps its API intentionally small. `/health` returns `{"ok":true}` with a JSON content type. `/export` returns `application/x-ndjson`; each non-empty source record is serialized with `JSON.stringify` and followed by a newline.

The export code can also be used without an HTTP server. `createExportHandler({ source, maxBufferedBytes })` returns a request handler, and `exportRecords({ source, sink, maxBufferedBytes })` writes to a Node-style response sink. The default `maxBufferedBytes` is `BUFFER_LIMIT_BYTES` (64). A sink may expose `bufferedBytes` or Node's `writableLength`; writes wait for its `drain` event when the limit is reached.

A source is made with `createPagedSource(pages)` where each page is an array of ordinary JavaScript values. If the source fails, an export that has not written a record gets status 500; every failed export ends with `{"error":"export failed"}` as a line. A closed sink stops fetching pages and closes the source.
