# ADR-004: Retry from durable delivery records

## Decision

RetryScheduler reads pending delivery records and hands them to DeliveryForwarder. A successful response marks the record delivered.

## Context

Callbacks can be temporarily unavailable, and a durable record makes restarts less surprising than an in-memory timer alone.

## Consequence

The scheduler can rebuild its work view after a process restart. Backoff values are stored with the delivery record so an operator can inspect the next attempt.
