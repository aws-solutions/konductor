# Harborline webhook relay

Harborline is a small prototype for receiving partner events and delivering them to customer callback endpoints. It is intentionally kept dependency-free while the service boundaries and operating model are being reviewed.

The design is in [`docs/design.md`](docs/design.md). The public contract is in [`docs/api.md`](docs/api.md), and short decisions live under [`docs/decisions`](docs/decisions). The code in `prototype/` is a runnable sketch, not a production server.

## Local use

The prototype needs Node.js 24 or newer and has no package install step.

```text
node prototype/server.js
```

Set `RELAY_PORT` to choose a port. The sample configuration uses documentation-only values. The tests exercise the signature helper, the in-memory event store, and the retry queue without opening network connections.

## Repository map

- `docs/` contains the design, API notes, decisions, and operating notes.
- `prototype/` contains the small CommonJS proof of concept.
- `config/` and `data/` hold safe examples for local work.
- `test/` contains the checks that must pass before a design change is merged.
