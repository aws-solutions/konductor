# Quillbox API

A small notes API. Plain Node.js 24, CommonJS, no dependencies.

- `node src/server.js` starts it on port 8080.
- `node --test test/` runs the tests.

Requests carry an API key in the `X-Api-Key` header; `src/auth.js` looks it up in `data/keys.json`.
In production two instances run behind one load balancer. They share state through the key-value client in
`src/kv.js` (an in-memory stand-in here, a managed key-value service in production).

Product requests live in `docs/product/`, older decision notes in `docs/notes/`.
