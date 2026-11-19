# Prototype

The prototype keeps only the edges needed for a design walk-through. `server.js` serves a health endpoint, while the other modules model signing, storage, queueing, configuration, and callback request construction. They are CommonJS modules so they can be loaded directly by the Node test runner.

A local run does not contact a partner or callback. The sample values under `config/` and `.env.example` are documentation values only.
