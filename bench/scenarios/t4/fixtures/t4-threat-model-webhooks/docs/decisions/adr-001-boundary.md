# ADR-001: Keep partner adapters outside the relay

## Decision

Partner-specific parsing happens before the common event envelope reaches the relay. The relay owns authentication, storage, and callback scheduling.

## Context

Different partners use different event names and signing conventions. Keeping that variation at the edge prevents the core delivery path from becoming a collection of conditional branches.

## Consequence

An adapter must provide the source name, event id, occurred time, and normalized payload. Adapter changes do not require changes to the storage schema.
