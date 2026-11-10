---
name: ws-integration-tests
description: How to run this project's integration tests locally.
origin: user-authored
version: 2
last_used: 2026-09-12
related: []
---

# Integration tests

## When to use
- Running `make itest` locally before pushing.

## Steps
1. `docker compose up -d postgres`
2. `make migrate`
3. `make itest`

## Pitfalls
- Postgres takes ~5s to accept connections; `make migrate` fails if run immediately.

## Verification
- `make itest` prints `PASS` for every package.
