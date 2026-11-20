# Service architecture

The HTTP adapter validates a receipt request, the renderer turns a normalized record into a document, and the delivery port sends that document to an inbox. The in-memory store used by tests has the same shape as the production repository adapter.

`src/receipt-service.js` owns the application sequence. `src/validation.js` rejects malformed input before storage. `src/receipt-format.js` owns the current envelope, while `src/legacy.js` preserves the older envelope for clients that have not migrated. Shared errors and time parsing live under `src/shared/`.

The service is intentionally stateless between requests. Operational files are read by scripts and deployment tooling rather than by the request path. UTC is the service boundary and records retain their original ISO timestamp.
