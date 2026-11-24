# Plan: give the konductor run levels (LITE, STANDARD, FULL) their own folder

2026-11-24, v1. Plan only. No file has moved. The owner decides before any move.

## The problem

The bench mixes two kinds of code. Some is generic: the runner, judge, scorer, report and plant work for any agent.
Some exists only to study konductor: the three run levels LITE, STANDARD and FULL. Today the run-level code is spread
over `bench/scenarios/`, `bench/kit/standard/` and `bench/suites/`, next to generic tools. A reader cannot tell which
files define the konductor study.

Two facts change the shape of the fix.

1. The words lite, standard and full mean three different things in the bench:
   - the run level (`run --level lite|standard|full`), the konductor study. This is what the owner means.
   - the older suite files `bench/suites/lite.json` and `full.json` (`run --suite lite|full`), five and all tasks of
     the first task set. The docs already warn that `--suite lite` is not the LITE level.
   - the report detail (`--detail quick|full`) and `profiles.js` (`quick`, `detailed`). These do not pick tasks.
2. `bench/runner/lib/profiles.js`, `bench/report/*` and `bench/runner/lib/cli-flags.js` do not define a suite.
   `profiles.js` sets replicates and judge modes; its `full` is the report detail. `cap/plan.js` and `pr-plan.js` use
   the older `--suite lite`, not the run level.

So the run levels are defined in 7 files. The older suites are defined in 3 more.

## What we do

Make one folder, `bench/levels/`, for everything that defines a konductor run level. Call it levels, not suites:
the code, the flag (`--level`) and the docs already call these run levels, and `bench/suites/` already holds the
generic suite files (`lite.json`, `pack.json`, `real.json` and more). A `bench/suites/lite/` folder beside
`bench/suites/lite.json` would mix the two meanings in one place.

Target:

```
bench/levels/
  README.md          one page: what each level is, its entry command, where its code lives
  levels.js          LITE / STANDARD / FULL task selection (moved from bench/scenarios/levels.js)
  standard/          the STANDARD paid kit (moved from bench/kit/standard/, all 7 files)
```

No `lite/` or `full/` folder yet. LITE and FULL have no level-only code today: both run through
`bench.js run --suite pack --level lite|full`, and their selection rules are in `levels.js`. Empty folders would be
code for later. The README names where each level starts. Add `lite/` or `full/` when a level gets its own kit.

What stays where it is, and why:

| File | Stays | Why |
|---|---|---|
| `bench/suites/pack.json` | yes | It is the task pool for every level and a normal `--suite pack` file; `tasks.js` finds suites in `bench/suites/`. |
| `bench/scenarios/pack-suite.js` | yes | It writes `pack.json` from the scenario tasks; it knows nothing about levels. |
| `bench/suites/lite.json`, `full.json`, the suite defaults in `bench/runner/lib/tasks.js` | yes | The older generic suites. Renaming them (for example to `first-lite`) is a separate change; see Risks. |
| host wrappers in `bench/ops/workspace/` (`run-standard-*.sh`, `standard-kit-env.sh`, `run-lite-*.sh`, `lite-*.js`, `standard-recheck/`) | yes | They carry this host's paths. The workspace launchers (`make-launchers.sh`) point at `bench/ops/workspace/<file>`; moving them breaks every launcher. |
| tests in `bench/runner/test/` | yes | `bench/scripts/test.sh` runs `bench/runner/test/*.test.js`; tests elsewhere would not run. |

## The moves (one commit, `git mv` so history follows)

| From | To |
|---|---|
| `bench/scenarios/levels.js` | `bench/levels/levels.js` |
| `bench/kit/standard/helper.js` | `bench/levels/standard/helper.js` |
| `bench/kit/standard/run-standard.sh` | `bench/levels/standard/run-standard.sh` |
| `bench/kit/standard/judge-standard.sh` | `bench/levels/standard/judge-standard.sh` |
| `bench/kit/standard/claude-standard.sh` | `bench/levels/standard/claude-standard.sh` |
| `bench/kit/standard/test-run-standard.sh` | `bench/levels/standard/test-run-standard.sh` |
| `bench/kit/standard/test-judge-standard.sh` | `bench/levels/standard/test-judge-standard.sh` |
| `bench/kit/standard/test-claude-standard.sh` | `bench/levels/standard/test-claude-standard.sh` |

Plus one shim, kept until STANDARD v1 is judged:
`bench/scenarios/levels.js` becomes `module.exports = require('../levels/levels.js');` with a
`shortcut:` comment naming its removal (see the paid-run risk below). Record its removal as a DEBT row.

## Path and import changes

Code:

| File | Change |
|---|---|
| `bench/levels/levels.js` | its three requires `./files.js`, `./split.js`, `./coverage.js` become `../scenarios/...` |
| `bench/runner/lib/run-cmd.js` | `require('../../scenarios/levels.js')` to `require('../../levels/levels.js')` |
| `bench/report/factorial.js` | `require('../scenarios/levels.js')` to `require('../levels/levels.js')` |
| `bench/levels/standard/helper.js` | `need('bench/scenarios/levels.js')` (2 places) to `need('bench/levels/levels.js')`; the usage line's `standard-helper.js` name fixed to `helper.js` |
| `bench/runner/test/kit-standard.test.js` | `KIT = path.join(__dirname, '..', '..', 'kit', 'standard')` to `'levels', 'standard'` |
| `bench/runner/test/scenarios-levels.test.js`, `pack-suite.test.js` | `require('../../scenarios/levels.js')` to `require('../../levels/levels.js')` |
| `bench/ops/workspace/standard-kit-env.sh` | `git archive ... bench/kit/standard` to `bench/levels/standard`. `--strip-components=3` stays 3 (bench, levels, standard). |

The kit scripts find their own folder (`KIT=$(cd "$(dirname ...)" && pwd)`), and the three `test-*.sh` copy their own
folder, so their bodies do not change. Only their header comments name the old path.

Docs and comments (text only): `bench/kit/README.md` (the three STANDARD rows move to `bench/levels/README.md`),
`bench/docs/run-levels.md` (3 places), `bench/docs/konductor-bench.md`, `bench/docs/reference.md`,
`bench/docs/safety-and-caps.md`, `bench/docs/paid-steps.md`, `bench/ops/README.md`, the header comments of
`run-standard-v1.sh`, `run-standard-judge.sh`, `run-standard-claude.sh`, and the open `bench/DEBT.md` rows that name
`bench/kit/standard/`. Closed DEBT rows and dated results keep the old path: they record what was true then.

Checks before the push: `node bench/scenarios/pack-suite.js --check`, the three kit stub tests, `kit-standard.test.js`,
`scenarios-levels.test.js`, `pack-suite.test.js`, `bench-docs.test.js`, `host-paths.test.js`, then
`run-standard-v1.sh --prepare-only` (free) against the pushed head, then the full suite twice with `TMPDIR=/tmp`.

## Risks

1. **The paid STANDARD path (must not break).** `run-standard-v1.sh` sources `standard-kit-env.sh`, which exports
   the kit from `origin/feat/bench-pilot-nk` at the path `bench/kit/standard`. After the move that path is empty, so
   the export makes an empty kit and the run stops at `bash "$KIT/run-standard.sh"`. The env-file edit must land in
   the same commit as the move. It does: the wrapper is run from the `ops` worktree, and the kit from origin, so both
   change at once when `ops` is fast-forwarded.
2. **`helper.js` reads levels from the bench worktree R, not from its own folder.** `need()` loads
   `bench/scenarios/levels.js` from `R`. A kit frozen before the move (`$S/kit`) with an `R` after it, or the other
   way round, would fail. Today no kit is frozen (`/var/tmp/konductor-standard-v1/` has `kit-src`, `prepare` and
   `claude`, no `kit`). The shim keeps an old frozen kit working against a new R. A new kit against an old R cannot
   happen: both come from the same origin head. Safest: move before the first paid STANDARD start, or after
   STANDARD v1 is judged, never in between.
3. **The workspace launcher for `standard-kit-env.sh`.** It is a sourced lib, so `make-launchers.sh` treats it
   apart. The file does not move, so nothing changes; `make-launchers.sh --check` confirms it.
4. **Frozen LITE and forced worktrees** (bench commit 69149846) read their own old tree. Not affected.
5. **The name clash stays.** `--suite lite` and `--level lite` still both exist. This plan does not fix it. A later
   change could rename the older suites; that touches `tasks.js`, `cap/plan.js`, `pr-plan.js` (default
   `suite = 'lite'` and its credit table), `refactor-regression/study.js` and the docs, so it is its own decision.
6. **Parallel sessions.** Other sessions edit `bench/kit/standard/` and `bench/docs/run-levels.md` often. A move
   while they hold edits makes their rebase hard. Do it in a quiet hour, fetch first, and push the move alone.

## Appendix A. Every file that names lite, standard or full as a suite or level

Suite-defining, run level (7):

| File | What it defines |
|---|---|
| `bench/scenarios/levels.js` | `LEVELS = ['lite','standard','full']`, the LITE phase picks, the STANDARD gate list, FULL = every task with a prereg |
| `bench/kit/standard/helper.js` | the STANDARD task plan, arms, cost model, stage checks |
| `bench/kit/standard/run-standard.sh` | the STANDARD paid run: caps, stages, locks, freeze |
| `bench/kit/standard/judge-standard.sh` | the STANDARD judge pass |
| `bench/kit/standard/claude-standard.sh` | the STANDARD Claude Code arms |
| `bench/suites/pack.json` | the task pool every level picks from (stays) |
| `bench/scenarios/pack-suite.js` | writes `pack.json` (stays) |

Suite-defining, older `--suite` (3, all stay): `bench/suites/lite.json`, `bench/suites/full.json`, the suite
defaults table in `bench/runner/lib/tasks.js`.

Suite-using, code: `bench/runner/lib/run-cmd.js`, `bench/runner/bench.js` (help text), `bench/runner/lib/cli-flags.js`
(the `level` and `level-since` flag names only), `bench/report/factorial.js`, `bench/scenarios/cli.js` (pack check),
`bench/cap/plan.js` and `bench/runner/lib/pr-plan.js` (older `--suite lite`), `bench/ops/refactor-regression/study.js`
(writes a test `suites/lite.json`).

Suite-using, tests: `bench/kit/standard/test-run-standard.sh`, `test-judge-standard.sh`, `test-claude-standard.sh`,
`bench/runner/test/kit-standard.test.js`, `scenarios-levels.test.js`, `pack-suite.test.js`.

Suite-using, host scripts in `bench/ops/` (no move): `workspace/run-standard-v1.sh`, `run-standard-judge.sh`,
`run-standard-claude.sh`, `standard-kit-env.sh`, `standard-recheck/run.sh`, `run-lite-konductor.sh`,
`run-lite-konductor-v2.sh`, `run-lite-judge.sh`, `run-lite-rejudge.sh`, `lite-helper.js`, `lite-fill.js`,
`lite-rejudge-estimate.js`, `lite-rejudge-gap.js`, `test-lite-helper-skipped.sh`, `test-lite-v2-fill.sh`,
`kp-pilot-lib.sh`, `run-tonight.sh`, and the LITE-based scripts in `next-experiment-2026-11-22/` (forced, nudge,
model-swap, cc-compare, aa-pack and their judges and stub tests).

Suite-using, docs: `bench/README.md`, `bench/DEBT.md`, `bench/kit/README.md`, `bench/ops/README.md`, and in
`bench/docs/`: `run-levels.md`, `repeat.md`, `konductor-bench.md`, `glossary.md`, `quickstart.md`, `paid-steps.md`,
`safety-and-caps.md`, `reference.md`, `tasks.md`, `repeat-it-yourself.md`, `keep-prune-stages.md`, `paired-fill.md`;
and the scenario `HAND-EDITS.md` files, which name LITE as a past run.

Unrelated (the word means something else):

| File | Meaning |
|---|---|
| `bench/runner/lib/profiles.js` | profiles `quick` and `detailed`; `full` is the report detail |
| `bench/report/generate.js`, `build.js`, `prunedoc.js`, `contrastdoc.js`, `quotedoc.js`, `quotes.js` | `--detail full` or a full table |
| `bench/report/stats.js`, `sdlc.js`, `orchpass.js` | standard deviation |
| `bench/runner/lib/cli-flags.js` (`full` flag) | the `trace --full` switch |
| `bench/ops/workspace/run-full-suite-twice*.sh` and tests | the full unit test suite, for KR k485 |
| `bench/cap/stubprovider.js`, `bench/cap/unitstage.js`, `bench/cap/nudge.js`, `bench/judge/prompts.js` | `LITERAL`, or LITE named only as the source of a measured number |
| `bench/complex/**/carriers/standard.js`, `agent-sops/k-full-sdlc.sop.md` and its test fixtures | task content and an SOP name |
