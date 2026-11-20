# HTTP API

The service keeps its API intentionally small. `/health` returns `{"ok":true}` with a JSON content type. `/export` returns `application/x-ndjson`; each non-empty source record is serialized with `JSON.stringify` and followed by a newline.

The export code can also be used without an HTTP server. `createExportHandler({ source })` returns a request handler, and `exportRecords({ source, sink })` writes to a Node-style response sink. A source is made with `createPagedSource(pages)` where each page is an array of ordinary JavaScript values.
