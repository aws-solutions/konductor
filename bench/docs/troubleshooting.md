<!-- SPDX-License-Identifier: Apache-2.0 -->
# Troubleshooting

[← bench home](../README.md) · [glossary](glossary.md) · [safety and caps](safety-and-caps.md) · [reference](reference.md)

bench stops early, before it spends, and says why. Find the message (or its start) below.

## A run will not start

| You see | Why | What to do |
| --- | --- | --- |
| `unshare failed: Operation not permitted`, or tests that skip with "user namespaces are blocked" | the host, or the agent shell you are in, blocks user namespaces, which `--isolate unshare` needs | run from your own terminal on a host that allows them; for a free try, `--isolate none --allow-unisolated` runs NOT COUNTED. To run the tests that skip here, use `bash bench/scripts/host-bound-tests.sh` on a host that allows them: it stops at once on one that does not, and fails if any sandbox test still skips |
| `refused: ... TMPDIR ... is under the real HOME` or "a scratch dir under HOME" | bench keeps scratch, out dirs and plant paths outside your home | `TMPDIR=/tmp`, and an out dir under `/tmp` or `/var/tmp` |
| `the plant Python ... does not run`, `BENCH_ARM_PYTHON ... does not run`, or `ENOENT` for a venv's `bin/python` | the Python the venv was built on was removed (a Kiro Crew update did this once to a venv built on the Crew's own Python) | run the command the message prints, `bash bench/ops/workspace/rebuild-arm-venv.sh --venv <venv>` (`--check` first changes nothing). It builds the venv again on a Python 3.12 outside the Crew runtime, installs the pins and keeps the old one as `<venv>.broken` |
| `the plant Python ... cannot import cedarpy` (or `mujoco`, `numpy`) | the gateway's Python lacks the policy engine or the arm physics | `pip install` the line the message prints into a Python 3.12 venv, then `--plant-python <venv>/bin/python` |
| `No matching distribution found for cedarpy==4.12.2`, or the walkthrough's `older than Python 3.10` | the venv's Python is 3.9 or older, and cedarpy 4.12.2 has no wheel for it | make the venv with a newer Python: `python3.12 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2` |
| `the plant Python ... has other wheels than the release pins` | an arm release pins exact wheels and your venv has others | install the pinned versions it prints (the list is `bench/physical/gateway-wheels.json`) |
| `--plant-python ... is Python 3.10, not 3.12` | plant tasks need the pinned Python | point `--plant-python` at a 3.12 interpreter (not a version-manager shim) |
| `plant arms need --plant-release DIR` or `the release lacks ...` | plant runs need an unpacked, signed release | use the toy walkthrough first; a real release is the owner's, outside the repo |
| `kiro-cli is not signed in` | the agent CLI has no login | `kiro-cli login`, then the same command |
| `unknown flag --x (did you mean --y?)` | a typo never falls back to a default | fix the flag; `node bench/runner/bench.js --help` lists them |

## A run ran, but the result is not what you expect

| You see | Why | What to do |
| --- | --- | --- |
| **NOT COUNTED** in the report header | the run had no sandbox, or the host had listeners the release does not allow, or (Strands) the release pins no `strands-agents` version | that run never feeds a verdict; [run levels](run-levels.md) and the plant docs say what a counted run needs |
| **NO DATA** | too few tasks scored, a stale baseline, a failed control, or too few judge families | the record names the reason first; [scoring](scoring.md#when-bench-says-no-data) lists them |
| `FLAG: only N of M tasks counted ... judge replies could not be read` | judge replies were unreadable even after one re-ask | a judge problem, not a reading of the unit; look at the saved `.bad-*.json` replies |
| `a control did not pass ... the unit was not run` | a paid keep-or-prune run stopped before the unit, so it spent nothing on a NO DATA result | read which control failed in the record's `controls` block |
| `budget_skipped` results | a budget stopped a run before it started | `--fill-skipped` fills them before the command ends ([paired fill](paired-fill.md)) |
| A plant trial with `launch_failure` three times | the gateway could not start (often its Python) | the gateway's `stderr` is in the trial's `plant/` folder |
| Settle harm on the policy arm | the agent left something running after its last call | [reading the plant report](physical-ai-report.md#harm-after-a-denied-move) |

## A paid step stopped

| You see | Why | What to do |
| --- | --- | --- |
| `gate 4, this step fits its cap: FAIL` on a resume of `run-pilot-rerun.sh` after a kill | a killed call kept its 15-credit reservation and must run again, so it is counted twice | with the owner's approval, raise the cap by 15 per killed call: `UNIT_CAP=<cap + 15> bash scripts/run-pilot-rerun.sh --unit --dry-run`, then the same without `--dry-run` (owner only: run from the owner workspace's `scripts/` launchers; the script is `bench/ops/workspace/run-pilot-rerun.sh`; see [paid steps](paid-steps.md)) |
| `refused before calling ...: spent X + worst 15 would pass the cap Y` | the ledger check before a paid call | the work so far is saved; rerun the same command with a larger approved cap to resume |
| `... gave no finished reply ...; counted 15 credits` | the call ran but returned nothing usable (timeout, service error, expired sign-in) | rerun the same command; finished calls are read back free |
| `the reply of ... could not be read` | a model replied without the JSON it was asked for | it was moved aside as `.bad-N.json`; a rerun asks again and counts again |

## An owner script runs old code

The owner's scripts in `<workspace>/scripts/` are launchers. They run the copy in the ops checkout
(`<workspace>/worktrees/ops`), not the branch head ([bench/ops/README.md](../ops/README.md)).

| You see | Why | What to do |
| --- | --- | --- |
| A fix that landed on `feat/bench-pilot-nk` does not show in an owner script | the ops checkout is still on an older commit | move it: `git -C <workspace>/worktrees/ops fetch origin feat/bench-pilot-nk`, then `git -C <workspace>/worktrees/ops checkout --detach FETCH_HEAD` |
| `No such file` for a script that is new on the branch | it has no launcher yet | after moving the checkout, `bash <workspace>/worktrees/ops/bench/ops/make-launchers.sh <workspace> --replace`, then the same with `--check` (exit 0 means every owner script is a launcher). `--replace` overwrites a plain workspace copy, so back that copy up first |
| `set KONDUCTOR_WS to the owner workspace` | a versioned script was run directly, not through its launcher | run the launcher in `<workspace>/scripts/`, or set `KONDUCTOR_WS` |
