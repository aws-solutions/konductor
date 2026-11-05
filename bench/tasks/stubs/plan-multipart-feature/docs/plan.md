# Plan

Task 1: migration, schema and backfill of existing items, before the service. Done when it passes.
Task 2: service. Depends on the migration.
Task 3: routes. Depends on the service.
Task 4: read paths. Depends on the service.
Task 5: README, in parallel.
Risks: mitigation by a spike. Concurrent 50 requests, atomic lock test.
