# ADR 003: stable HTTP errors

## Status

Accepted.

## Decision

Client errors use a JSON body with a stable `error.code`, a human-readable message, and optional details. The router maps validation failures to 400, missing resources to 404, conflicts to 409, and unexpected failures to 500.

## Consequences

Clients can branch on the code without scraping prose. New codes need a test and a changelog note when they alter client behaviour.
