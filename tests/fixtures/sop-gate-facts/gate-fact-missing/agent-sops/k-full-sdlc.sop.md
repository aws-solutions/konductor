# Alpha Gated

Orchestration: strict (phase-gated SOP)

## Overview

A minimal phase-gated SOP.

## Progress Tracking

- **Phase list.** This SOP's phases, in order, are: `draft`, `review`, and `summary`, the same ids as Steps 0 through 2.
- **Gate facts.** The result is the highest severity word among findings still open and not overridden at the boundary, copied verbatim from the checker's report whatever its verdict word, or `none`. Write it only after the checker's report is complete. The evidence is a path relative to `output_dir`. When the engineer overrides a finding, record `gate_<phase>_override` naming the finding ids and the approver. At a 5-round cap with an engineer present, the cap exit is its own recorded route: the note names the finding ids and `round cap`, with no approver needed. An unattended run stops and never writes an override. A finding the engineer resolves or overrides, or that a recorded round-cap exit closes, is no longer open for this purpose. A boundary phase in `skip_phases` writes no gate facts, and its `SKIPPED` entry needs a `skip_reason`.
- **Fix-cycle cap.** `max_fix_cycles` is written into `run.data` once at session minting, as a non-negative integer, even when it is the default `2`.

## Steps

### 0. Draft

- Record `gate_draft_result` (`approved`), `gate_draft_evidence` (`out/draft.md`, relative to `output_dir`), and `gate_draft_checker` (`user`).

### 1. Review

- Record `gate_review_result`, `gate_review_evidence` (`out/review.md`), a checker, and, on an override, `gate_review_override`.

### 2. Summary

- Delegate `konductor verify-run --session <session file> --root <output_dir> --allow-running` to `k-developer`, run from `codebase_path` with the absolute session path and absolute `output_dir`. Then write `sdlc-summary.md` with its exit and every reason and info line, `CONFIG_SOURCE` included, under `Gate check`. Exit 0 is a pass. Exit 1 is a halt; report it in the summary. Exit 2 is an open finding; report it in the summary. Exit 3 is a spent fix budget; report it in the summary. Exit 6 is a completed run with a skipped gate; report it in the summary. Exit 64 is a usage error; an `unexpected argument` naming `--root` records `verify-run unavailable: needs a build with --root`. Exit 65 is a session integrity failure; report it in the summary. If this run never minted a session file, the summary records `verify-run: no session file`. If `konductor` is not found or reports an `unrecognized subcommand`, the summary records `verify-run unavailable`.

**Expected Output:** `sdlc-summary.md` with a `Gate check` section.
