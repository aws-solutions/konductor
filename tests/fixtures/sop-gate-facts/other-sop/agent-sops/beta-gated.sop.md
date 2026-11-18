# Alpha Gated

Orchestration: strict (phase-gated SOP)

## Overview

A minimal phase-gated SOP.

## Progress Tracking

- **Phase list.** This SOP's phases, in order, are: `draft`, `review`, and `summary`, the same ids as Steps 0 through 2.
- **Gate facts.** The result is the highest severity word among findings still open and not overridden at the boundary, copied verbatim from the checker's report whatever its verdict word, or `none`. Write it only after the checker's report is complete. The evidence is a path relative to `output_dir`. When the engineer overrides a finding, record `gate_<phase>_override` naming the finding ids and the approver. At a 5-round cap the engineer resolves or overrides each finding, and the note names the finding ids, `round cap` and the approver. An unattended run stops and never writes an override. A boundary phase in `skip_phases` writes no gate facts, and its `SKIPPED` entry needs a `skip_reason`.

## Steps

### 0. Draft

- Record `gate_draft_result` (`approved`), `gate_draft_evidence` (`out/draft.md`, relative to `output_dir`), and `gate_draft_checker` (`user`).

### 1. Review

- Record `gate_review_result`, `gate_review_evidence` (`out/review.md`), `gate_review_checker`, and, on an override, `gate_review_override`.

### 2. Summary

- Summarize the run.

**Expected Output:** `sdlc-summary.md`.
