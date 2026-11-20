# Architecture

The router converts HTTP input into service calls. Services validate business
rules and coordinate a store plus event publishers. Stores are asynchronous,
even when the local implementation is memory-backed, so callers must await
all store operations.

`MemoryStore` copies records at its boundary. This prevents an event listener
from changing persisted state by mutating a payload. The real importer has
similar copy-on-write behavior.

The event publisher is deliberately promise-based. It may call a local
listener today and a queue adapter later. A publisher promise represents the
whole downstream handoff.
