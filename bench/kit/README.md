# bench kit: run kits and helpers

The scripts that drove the konductor 2x2 study (Kiro CLI and Claude Code, each without and with konductor) and the
PR #312 skill-access probe. They live here so that any run can be repeated later. The steps, in order, are in
[docs/repeat.md](../docs/repeat.md). This page says what each file is and what it needs.

Run every kit script from your own terminal, never from an agent shell. The paid stages need the sandbox (`unshare`),
which an agent shell blocks, and they spend credits or dollars.

## What is here

| Path | What it is | Cost |
| --- | --- | --- |
| `2x2/run-2x2.sh` | The kit of the first study: four cells (Kiro and Claude Code, vanilla and konductor), a DEV set (stage 1) and a HELD-OUT set (stage 2), judging, reports, gates. | free steps and paid stages, each with its own cap |
| `2x2/run-2x2-kiro.sh` | The Kiro-only rerun on a new frozen build: 17 HELD-OUT tasks, three replicates, one 1800 s limit, soft caps. Same helpers and refusals as `run-2x2.sh`. | free steps and paid stages |
| `2x2/overnight.sh`, `2x2/overnight-kiro.sh` | Run the rest of a study with nobody at the keyboard: one marker per finished step, no retry of a paid step, a stop file on the first failure. | paid, through the kit |
| `2x2/prep.sh` | Builds and trial-installs every arm with `--prepare-only`, before a study is frozen. | free |
| `2x2/listing-check.js` | Static estimate of the skill listing Claude Code would send for a konductor commit. Exit 1 when a konductor skill would be name-only. | free |
| `2x2/rescore-by-limit.js` | Re-scores a finished run as if the time limit had been 600, 1200 or 1800 s. Read only. | free |
| `2x2/timeline.py` | For every run over a limit, writes a timeline of why it ran long. Read only, standard library. | free |
| `standard/run-standard.sh` | The STANDARD run: every DEV task that passes the lock and recheck gate, three arms (vanilla, konductor, konductor-noskills), two stages of one replicate each. `--prepare-only` builds and trial-installs all three arms. The first paid start freezes the plan and the kit in the study dir. | free prepare; paid stages, 800 real credits cap per stage |
| `standard/judge-standard.sh` | The three-family judge pass over the finished STANDARD units, then the three-arm report. `--plan` makes no model call. | paid, USD 15 cap |
| `standard/claude-standard.sh` | Claude Code on 15 STANDARD tasks, plain and with konductor, one run each. `--prepare-only` makes no model call. | paid, USD 1 per run, USD 30 cap |
| `standard/helper.js`, `standard/test-*.sh` | The free helper (task gate, spend, stage check, tables) and the paid-path tests on stubs, run by `runner/test/kit-standard.test.js`. | free |
| `probes/pr312-skill-access/` | A 12-prompt probe: does Kiro with konductor load the skill each prompt needs, without being told its name. Its own README has the details. | paid (Kiro credits) |

## Needs

| Variable | Meaning |
| --- | --- |
| `S` or `KIT_DIR` | The study directory. One study lives in one directory. It holds `freeze.env`, the run directories, the reports and the logs. The kit refuses to start without it. |
| `R` | A dedicated konductor git worktree. `freeze` checks out the frozen bench commit in it, so it must not be your own checkout, and the kit must run from a copy outside it. The kit refuses both mistakes. |
| `AWSP` | The **name** of your least-privilege AWS profile for Bedrock (judges and Claude Code). Never a key. Refresh the profile in your terminal; the kit reads it through the AWS CLI. |
| `KBIN`, `CBIN` | The pinned `kiro-cli` and `claude` binaries. Default: `$SHARED/bin/kiro-cli-3.5.0/kiro-cli` and `$SHARED/bin/claude-code/2.1.327.1766/claude`, where `SHARED` defaults to `S`. The kit checks their sha256. |
| `LISTING_JS`, `LOCK` | The listing check (default: beside the kit) and the host lock (default `/var/tmp/konductor-heavy.lock`). |
| `REFRESH_CMD` | Optional. A command that refreshes `AWSP` when it runs short. |

The kit keeps `TMPDIR` under `/var/tmp` and refuses any other place. A Claude Code run loads every `.claude/skills`
directory above its working directory, so a temp dir under your home could add skills to a run. If `S` is not under
`/var/tmp`, the kit stops at `quiet` and says so.

## What the kits refuse

These checks are the point of the kit. Do not weaken them to get a run through.

| Refusal | Where |
| --- | --- |
| A kiro-cli or claude binary whose sha256 is not the pinned one, or whose version is not 3.5.0 or 2.1.327 | `pins` |
| A split of tasks into DEV and HELD-OUT that does not match the recorded hash rule (SR-32) | `split-check`, and before every stage |
| A konductor commit whose Claude Code skill listing leaves a konductor skill name-only | `freeze` |
| A worktree that moved, has changes, or holds runs of another konductor commit | `load_frozen` |
| `origin/main` moving during a study (unless `ALLOW_MAIN_MOVED=1`) | `load_frozen` |
| A Claude Code stage before the smoke run passed and `ACK_CC_VERSION=1` is set | `ack_cc` |
| Another heavy job on the host, load at half the cores or more, less than 8 GB memory or 15 GB disk free, no working sandbox | `quiet` |
| Fewer than three judge families that differ from the agent's, or a quality pack other than the frozen one | `families`, `pack_same` |
| A stage that would pass its cap | `kiro_batch`, `cc_batch`, `judge_dir` |
| `--isolate none`, `--allow-small-panel`: the kit never passes them | all |

## How the kit relates to the rest of bench

- `bench/scripts/pilot-2x2.sh` is the small, self-contained 2x2 pilot (five lite tasks, one run each). The kit here is the
  larger, frozen study with a DEV and HELD-OUT split, caps and gates. Both end in `bench.js report-2x2`.
- `2x2/listing-check.js` estimates the listing from the git tree. `bench/runner/lib/harness/claude-listing.js` measures it
  from a real install and records it per arm. Keep the estimate for the free pre-freeze check; the measurement is what a
  run records (debt rows D-33 and D-34).
- `2x2/rescore-by-limit.js` changes only which runs count as timeouts. It is not `bench.js recheck` (which scores a saved
  workspace again) and not `judge --rescore-quotes` (which matches evidence quotes again).
- `2x2/run-2x2-kiro.sh` repeats most of `run-2x2.sh` (debt row D-46).

## Tests

`bench/runner/test/kit-2x2.test.js` and `bench/runner/test/kit-tools.test.js` check syntax, the free commands, the
refusals that fire before anything is spent, `gate` on fake results, and the helpers on small fixtures. They start no
model, no cloud call and no sandbox. Run them as in [docs/repeat.md](../docs/repeat.md#test-the-kit).
