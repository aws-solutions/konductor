# Alpha Gated

Orchestration: strict (phase-gated SOP)

## Overview

A minimal phase-gated SOP.

## Progress Tracking

- **Phase list.** This SOP's phases, in order, are: `draft`, `review`, and `summary`, the same ids as Steps 0 through 2.
- **Gate facts.** The result is the highest severity word among findings still open at the boundary, copied verbatim from the checker's report whatever its verdict word, or `none`. A checker's IMPORTANT maps to HIGH. Write it only after the checker's report is complete. The evidence is a path relative to the project root. A boundary phase in `skip_phases` writes no gate facts, and its `SKIPPED` entry needs a `skip_reason`.

## Steps

### 0. Draft

- Record `gate_draft_result` (`approved`), `gate_draft_evidence` (`out/draft.md`, relative to the project root), and `gate_draft_checker` (`user`).

### 1. Review

- Record `gate_review_result`, `gate_review_evidence` (`out/review.md`), and `gate_review_checker`.

### 2. Summary

- Delegate `konductor verify-run --session <session file> --allow-running` to `k-developer`. Then write `sdlc-summary.md` with its exit. If this run never minted a session file, the summary records `verify-run: no session file`. If `konductor` is not found or reports an `unrecognized subcommand`, the summary records `verify-run unavailable`.
