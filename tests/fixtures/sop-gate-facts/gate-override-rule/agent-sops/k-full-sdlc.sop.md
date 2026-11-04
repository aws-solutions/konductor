# Alpha Gated

Orchestration: strict (phase-gated SOP)

## Overview

A minimal phase-gated SOP.

## Progress Tracking

- **Phase list.** This SOP's phases, in order, are: `draft`, `review`, and `summary`, the same ids as Steps 0 through 2.
- **Gate facts.** The result is the highest severity word among findings still open and not overridden at the boundary, copied verbatim from the checker's report whatever its verdict word, or `none`. Write it only after the checker's report is complete. The evidence is a path relative to `output_dir`. When the engineer overrides a finding, record `gate_<phase>_override` naming the finding ids and the approver. At a 5-round cap the engineer MUST resolve or override each finding, and the note names the finding ids and a template like `F-3 round cap, approved by <alias>`. A finding the engineer resolves or overrides with a named approver is no longer open for this purpose. For an approval boundary the result is `approved` once the engineer approves it. A boundary phase in `skip_phases` writes no gate facts, and its `SKIPPED` entry needs a `skip_reason`.
- **Fix-cycle cap.** `max_fix_cycles` is written into `run.data` once at session minting, as a non-negative integer, even when it is the default `2`.
  - **Reconciliation on resume (max_fix_cycles).** The stored value is the source of truth. If the session has no `max_fix_cycles` key, write the parameter. If the key equals the parameter, continue. If the key differs from the parameter, You MUST NOT continue until the engineer decides: mark the run BLOCKED and ask. A parameter left at its default `2` counts as supplied. (a) Keep the stored value: write nothing. (b) Change the cap: only an explicit reply approves it; write the parameter and append `<stored>-><param> approved by <engineer>` to `max_fix_cycles_change_log`. When `reply_channel_available` is `false`, record `final-summary` BLOCKED and end the run. A later resume that passes this comparison with `final-summary` BLOCKED from this stop resets it to `PENDING` before Step 0.

## Steps

### 0. Draft

- Record `gate_draft_result` (`approved`), `gate_draft_evidence` (`out/draft.md`, relative to `output_dir`), and `gate_draft_checker` (`user`).

### 1. Review

- Record `gate_review_result`, `gate_review_evidence` (`out/review.md`), `gate_review_checker`, and, on an override, `gate_review_override`.

### 2. Summary

- Before running `konductor verify-run`, read the `phases` map and confirm every phase before `summary` is `COMPLETED`, `SKIPPED` (with a `skip_reason`), or `BLOCKED`. Never run `verify-run` with an earlier phase `PENDING`, because it exits 65 with `PHASE_ORDER`.

- Delegate `konductor verify-run --session <session file> --root <output_dir> --allow-running --max-fix-cycles <max_fix_cycles>` to `k-developer`, where `<max_fix_cycles>` is the cap stored in `run.data.max_fix_cycles` after this invocation's reconciliation, run from `codebase_path` with the absolute session path and absolute `output_dir`. Then write `sdlc-summary.md` with its exit and every reason and info line, `CONFIG_SOURCE` included, under `Gate check`. Exit 0 is a pass. Exit 1 is a halt; report it in the summary. Exit 2 is an open finding; report it in the summary. Exit 3 is a spent fix budget; report it in the summary. A `CAP_RAISED` exit 65 is a gate disagreement and sets `satisfied=false`. Exit 6 is a completed run with a skipped gate; report it in the summary. Exit 64 is a usage error; an `unexpected argument` naming `--root` records `verify-run unavailable: needs a build with --root`. Exit 65 is a session integrity failure, such as `PHASE_ORDER`; report it in the summary. `PHASE_ORDER` means an earlier phase is still `PENDING` while a later one has started. If this run never minted a session file, the summary records `verify-run: no session file`. If `konductor` is not found or reports an `unrecognized subcommand`, the summary records `verify-run unavailable`. Any exit other than 0 forces `satisfied=false` and adds the open item `verify-run disagrees with the Quality Gate (exit <n>)` unless every reason is already an open item.

**Expected Output:** `sdlc-summary.md` with a `Gate check` section.
