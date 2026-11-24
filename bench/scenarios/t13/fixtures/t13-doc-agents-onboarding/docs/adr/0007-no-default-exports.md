# ADR 0007: no default exports

- Status: accepted
- Date: 2025-11-02

TypeScript modules in this service use named exports. Default exports hide the
symbol name at import sites and make refactoring less predictable. New modules
must export named functions, types, or constants. Existing default exports are
converted when a file is otherwise changed.
