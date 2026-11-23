<!-- SPDX-License-Identifier: Apache-2.0 -->
# Safety and caps

[← bench home](../README.md) · [glossary](glossary.md) · [troubleshooting](troubleshooting.md) · [reference](reference.md#isolation-environment-safety)

**The problem.** A benchmark starts agents that can write files and run commands, and every run spends money. A run
must not touch your real home, leak a private test set, or spend more than you approved. This page lists the walls
and the limits, and which ones stop a run on their own.

## The walls around a run

| Wall | What it does | Where |
| --- | --- | --- |
| Sandbox | each run gets its own home and scratch dir; your real home, other runs and the answer keys are hidden or read-only (`--isolate unshare` on Linux, `sandbox-exec` on macOS) | `bench/runner/lib/isolate.js` |
| No sandbox, by request | `--isolate none --allow-unisolated` runs anyway, but every result is marked NOT COUNTED and never feeds a verdict | the run config and the report header |
| Hidden checks | hidden tests, answer keys and judge rubrics never reach the agent's work dir | the task loader |
| Private plant releases | a counted plant release lives outside the repo, signed; the runner checks the signature and every file hash on a private copy, and CI refuses release files in git history | [the plant docs](physical-ai.md#the-release-stays-private) |
| Your credentials | bench passes only the named profile's keys to a run that needs them, and scrubs them from logs. Before the agent starts, core drops any credential-like variable the harness did not list in its `credentialEnv`, and flags the run `envDropped` | the harnesses, then `agentEnv` in `bench/runner/lib/env.js` |
| One heavy job at a time | owner scripts that run many agents take the host's heavy lock (`/var/tmp/konductor-heavy.lock`), so two never overlap | the scripts |

## The limits on spend

| Limit | What it stops | Flag or rule |
| --- | --- | --- |
| Command budget | new runs stop at 90% of the budget; a run already started finishes | `--budget-credits N`, `--budget-usd N` |
| Per-run limit | one run's credits (Kiro CLI) or dollars (Claude Code) | `--run-credit-limit N`, `--run-budget-usd N` |
| Judge budget | judging stops before a call that could pass it | `judge --budget-usd N` |
| Strands spend cap | before every model call, bench reserves the call's worst case and refuses it if the cap could pass | `--budget-usd N` on `st-` arms |
| Counted credits | the owner's rule for paid keep-or-prune calls: each call counts as at least 15 credits; the ledger reserves 15 before the call and settles after; a call that could pass the cap is refused | `--cap N` on `cap unit-author` and `cap unit-stage --provider kiro` |
| Approval first | no paid run starts without the owner's approval and a cap | every owner script prints its cap and has a free `--dry-run`, `--plan` or `--prepare-only` |

A cap can be passed by at most one call's excess over its reservation. One-turn calls with no tools rarely come
close.

## Free first, always

Every paid script and command has a free first step. Run it, read the call count and the worst case, then decide.

| Paid step | Free first step |
| --- | --- |
| `bench run` | `--prepare-only` (builds and installs every arm, starts no agent) |
| `bench judge` | `judge --plan` |
| `cap unit-author`, `cap unit-stage --provider kiro` | `--dry-run` |
| the STANDARD kit | `run-standard.sh --prepare-only`, `judge-standard.sh --plan` |
| the plant | the toy walkthrough and the control suites, which use scripted agents |
