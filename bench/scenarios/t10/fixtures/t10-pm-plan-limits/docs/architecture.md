# Architecture overview

Sprig is a single Node process with a small dependency-free HTTP adapter. `src/app.js` assembles a store, repositories, services, and router. The server module only handles listening and graceful shutdown.

The repository layer at `src/repositories/` translates collection records into useful operations. It is the only layer that reads and writes the JSON store. Services at `src/services/` apply cross-record rules before returning plain result objects. Route handlers translate those results to status codes.

The store uses a per-instance write queue. Callers that need a read followed by a write use its lock helper so the complete operation is serialized. Reads return copies of records; service code must not mutate a repository result and expect persistence.

Every route is registered in one router table. Error codes are lowercase dotted names and are stable enough for the command-line client. The audit repository is append-only for local debugging.
