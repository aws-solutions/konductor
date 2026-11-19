# Development notes

Keep handlers thin. Validation belongs in `src/utils/validation.js`, and the service owns booking rules. The store is deliberately synchronous because the production replacement will sit behind the same small interface.

Run the full test suite with `npm test`. Tests use an in-process HTTP server, so they do not need a port reserved ahead of time.
