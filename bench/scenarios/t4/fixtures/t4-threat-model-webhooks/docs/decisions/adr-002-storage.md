# ADR-002: Use a relational event store

## Decision

The first hosted version stores the event envelope and delivery state in a managed relational database.

## Context

The service needs straightforward tenant queries, an operator view of failed deliveries, and a durable ordering key. A relational store is familiar to the team and leaves room for later partitioning.

## Consequence

The QueryLayer owns statement construction and binds values through the database driver's parameter interface. The service keeps the event body alongside delivery metadata for the retention period described in the design.
