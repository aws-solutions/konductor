# HTTP notes

The current adapter exposes `GET /stock/:warehouse/:sku`. It returns
`{sku, warehouseId, quantity}` or a 404 when the pair is not known. JSON
errors have a stable `code` and a human-readable `message`.

Business errors are returned as non-2xx responses. Unexpected store errors
must reach the application error boundary so the caller can retry safely.
The application error boundary logs the request id and returns a generic 500.

Stock changes are followed by a `stock.changed` event. Consumers may read the
store during handling, so the write has to be complete before the event is
published.
