# HTTP API notes

Requests use JSON and return `{ "error": "..." }` for client errors. Merchant
identity comes from `x-merchant-id`, while `x-request-id` is optional and is
created by the server if absent.

`POST /v1/orders/:orderId/capture` captures an authorized order. The capture
operation is safe to retry with the same request id.
