# Development

Use `npm test` for the test suite and `npm run lint` for a syntax check. Tests use temporary directories and should leave the working tree unchanged.

The filesystem and retry modules use async functions internally. Public calls keep the error-first callback form and also return a promise, so callers can migrate one call site at a time. Callback-mode promise rejections are observed by the compatibility bridge.
