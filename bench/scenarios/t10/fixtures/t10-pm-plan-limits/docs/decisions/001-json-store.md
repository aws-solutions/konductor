# ADR 001: JSON file persistence

## Status

Accepted.

## Decision

Use one JSON file per local service instance and keep persistence behind repositories. A small team installation values a readable backup over a database dependency. Writes are queued within a process, and callers that combine a read with a write use the store lock.

## Consequences

The service is easy to run and inspect. File size and process count limit the design. A future multi-process deployment would need a different coordination mechanism rather than assuming this queue spans processes.
