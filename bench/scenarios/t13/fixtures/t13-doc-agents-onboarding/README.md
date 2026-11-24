# Harborline service

Harborline is the small HTTP service behind account preferences and session checks.
The repository contains the service source, local operational notes, and the evidence
used by the on-call rotation.

## Repository map

- `src/` contains the TypeScript service.
- `test/` contains fast local checks.
- `scripts/` contains maintenance helpers.
- `docs/` contains architecture and runbook notes.
- `ops/` contains exported operational records.
- `logs/` and `metrics/` contain sampled service evidence.

The service is intentionally small, but changes should still be easy to review and
safe to run locally. The contributor guide is retained as the starting point for
team practices and is due for a refresh.
