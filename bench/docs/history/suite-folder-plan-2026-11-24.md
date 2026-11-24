# Plan: give the konductor run levels (LITE, STANDARD, FULL) their own folder

2026-11-24, v2. Plan only. No file has moved. The owner decides before any move.
v2: the target is now the owner's choice, `bench/scenarios/konductor/{lite,standard,full}/`, which replaces v1's
`bench/levels/`. A new section lists, for each suite file the owner named, whether it needs an import change.

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

Make one folder, `bench/scenarios/konductor/`, for everything that defines a konductor run level:

```
bench/scenarios/konductor/
  levels.js          LITE / STANDARD / FULL task selection (moved from bench/scenarios/levels.js)
  lite/README.md     what LITE is, its entry command, where its rules live (levels.js)
  standard/          the STANDARD paid kit (moved from bench/kit/standard/, all 7 files) plus README.md
  full/README.md     what FULL is, its entry command, the prereg rule (levels.js, `scenarios prereg freeze`)
```

`levels.js` sits one level up because all three levels share it: one function picks the tasks for each level.
LITE and FULL have no level-only code today. Both run through `bench.js run --suite pack --level lite|full`. Their
folders hold only a README until a level gets its own kit.

Why this place is safe for the scenario tools (checked in the code):

- `files.js` (`taskFilesOf`) reads `bench/scenarios/` and one level of folders below it. A `.json` file directly in
  `bench/scenarios/konductor/` would be parsed. So keep no JSON file there. The `lite/`, `standard/` and `full/`
  folders are two levels down and are never read as tasks.
- `pack-suite.js` lists only folders that hold tasks. `konductor/` holds none, so `suites/pack.json` does not change.
- `ready.js`, `pilot-table.js` and `spot-review.js` walk only folders named `t<number>`. They skip `konductor/`.

What stays where it is, and why:

| File | Stays | Why |
|---|---|---|
| `bench/suites/pack.json` | yes | It is the task pool for every level and a normal `--suite pack` file; `tasks.js` finds suites in `bench/suites/`. |
| `bench/scenarios/pack-suite.js` | yes | It writes `pack.json` from the scenario tasks; it knows nothing about levels. |
| `bench/suites/lite.json`, `full.json`, the suite defaults in `bench/runner/lib/tasks.js` | yes | The older generic suites. Renaming them is a separate change; see Risks. |
| host wrappers in `bench/ops/workspace/` (`run-standard-*.sh`, `standard-kit-env.sh`, `run-lite-*.sh`, `lite-*.js`, `standard-recheck/`) | yes | They carry this host's paths. The workspace launchers (`make-launchers.sh`) point at `bench/ops/workspace/<file>`; moving them breaks every launcher. |
| tests in `bench/runner/test/` | yes | `bench/scripts/test.sh` runs `bench/runner/test/*.test.js`; tests elsewhere would not run. |

## The files the owner named: import change or not

| File | Moves | Import or path change | Why |
|---|---|---|---|
| `bench/runner/lib/profiles.js` | no | none | It reads `bench/profiles/quick.json` and `detailed.json`. It never loads a level. Its `full` is the report detail. |
| `bench/kit/standard/` (7 files) | yes, to `bench/scenarios/konductor/standard/` | `helper.js`: 2 `need()` paths. Scripts: header comments only. | The scripts find their own folder at run time. |
| `bench/cap/plan.js` | no | none | It uses the older `--suite` tiers (`lite`, `hard`, `real`) and the tier list in `tasks.js`. |
| `bench/runner/lib/pr-plan.js` | no | none | The older `--suite lite` (default `suite = 'lite'` and its credit table). |
| `bench/report/factorial.js` | no | yes, 1 require | It loads `levelHeader` from `levels.js`. |
| other report generators (`generate.js`, `build.js`, `prunedoc.js`, `contrastdoc.js`, `quotedoc.js`, `render.js`) | no | none | Their `full` is `--detail full`. None loads a level. |
| `bench/runner/lib/cli-flags.js` | no | none | It only names the `level` and `level-since` flags. |
| `bench/runner/lib/run-cmd.js` | no | yes, 1 require | It loads `planLevel` from `levels.js`. |
| `bench/ops/workspace/standard-kit-env.sh` | no | yes, archive path and strip count | It exports the kit from origin by path. |

## The moves (one commit, `git mv` so history follows)

| From | To |
|---|---|
| `bench/scenarios/levels.js` | `bench/scenarios/konductor/levels.js` |
| `bench/kit/standard/helper.js` | `bench/scenarios/konductor/standard/helper.js` |
| `bench/kit/standard/run-standard.sh` | `bench/scenarios/konductor/standard/run-standard.sh` |
| `bench/kit/standard/judge-standard.sh` | `bench/scenarios/konductor/standard/judge-standard.sh` |
| `bench/kit/standard/claude-standard.sh` | `bench/scenarios/konductor/standard/claude-standard.sh` |
| `bench/kit/standard/test-run-standard.sh` | `bench/scenarios/konductor/standard/test-run-standard.sh` |
| `bench/kit/standard/test-judge-standard.sh` | `bench/scenarios/konductor/standard/test-judge-standard.sh` |
| `bench/kit/standard/test-claude-standard.sh` | `bench/scenarios/konductor/standard/test-claude-standard.sh` |

New files: `lite/README.md`, `standard/README.md` (the three STANDARD rows from `bench/kit/README.md`) and
`full/README.md`.

Plus one shim, kept until STANDARD v1 is judged:
`bench/scenarios/levels.js` becomes `module.exports = require('./konductor/levels.js');` with a `shortcut:` comment
naming its removal (see the paid-run risk below). Record its removal as a DEBT row.

## Path and import changes

Code:

| File | Change |
|---|---|
| `bench/scenarios/konductor/levels.js` | its three requires `./files.js`, `./split.js`, `./coverage.js` become `../files.js`, `../split.js`, `../coverage.js` |
| `bench/runner/lib/run-cmd.js` | `require('../../scenarios/levels.js')` to `require('../../scenarios/konductor/levels.js')` |
| `bench/report/factorial.js` | `require('../scenarios/levels.js')` to `require('../scenarios/konductor/levels.js')` |
| `bench/scenarios/konductor/standard/helper.js` | `need('bench/scenarios/levels.js')` (2 places) to `need('bench/scenarios/konductor/levels.js')`; the usage line's `standard-helper.js` name fixed to `helper.js` |
| `bench/runner/test/kit-standard.test.js` | `KIT = path.join(__dirname, '..', '..', 'kit', 'standard')` to `path.join(__dirname, '..', '..', 'scenarios', 'konductor', 'standard')` |
| `bench/runner/test/scenarios-levels.test.js`, `pack-suite.test.js` | `require('../../scenarios/levels.js')` to `require('../../scenarios/konductor/levels.js')` |
| `bench/ops/workspace/standard-kit-env.sh` | `git archive ... bench/kit/standard` to `bench/scenarios/konductor/standard`, and `--strip-components=3` to `--strip-components=4` (bench, scenarios, konductor, standard) |

The kit scripts find their own folder (`KIT=$(cd "$(dirname ...)" && pwd)`), and the three `test-*.sh` copy their own
folder, so their bodies do not change. Only their header comments name the old path.

Docs and comments (text only): `bench/kit/README.md` (the STANDARD rows become a pointer to the new folder),
`bench/docs/run-levels.md` (3 places), `bench/docs/konductor-bench.md`, `bench/docs/reference.md`,
`bench/docs/safety-and-caps.md`, `bench/docs/paid-steps.md`, `bench/ops/README.md`, the header comments of
`run-standard-v1.sh`, `run-standard-judge.sh`, `run-standard-claude.sh`, and the open `bench/DEBT.md` rows that name
`bench/kit/standard/`. Closed DEBT rows and dated results keep the old path: they record what was true then.

Checks before the push: `node bench/scenarios/pack-suite.js --check` (must report no change), the scenario lint and
`content-lock` checks, the three kit stub tests, `kit-standard.test.js`, `scenarios-levels.test.js`,
`pack-suite.test.js`, `bench-docs.test.js`, `host-paths.test.js`, then `run-standard-v1.sh --prepare-only` (free)
against the pushed head, then the full suite twice with `TMPDIR=/tmp`.

## Risks

1. **The paid STANDARD path (must not break).** `run-standard-v1.sh` sources `standard-kit-env.sh`, which exports
   the kit from `origin/feat/bench-pilot-nk` at the path `bench/kit/standard`, stripping 3 path parts. After the
   move, the old path is empty, so the export makes an empty kit, and the run stops at `bash "$KIT/run-standard.sh"`.
   The new path has 4 parts. If the strip count stays at 3, the files land in a `standard/` subfolder and the run
   stops the same way. Both edits must land in the same commit as the move. The wrapper runs from the `ops`
   worktree, and the kit comes from origin, so both change together once `ops` is fast-forwarded.
2. **`helper.js` reads levels from the bench worktree R, not from its own folder.** `need()` loads `levels.js` from
   `R`. A kit frozen before the move (`$S/kit`) paired with an `R` taken after it would fail. Today no kit is frozen
   (`/var/tmp/konductor-standard-v1/` has `kit-src`, `prepare` and `claude`, no `kit`). The shim keeps an old frozen
   kit working against a new R. A new kit against an old R cannot happen: both come from the same origin head.
   Safest: move before the first paid STANDARD start, or after STANDARD v1 is judged, never in between.
3. **A JSON file in `bench/scenarios/konductor/`** would be read as a candidate task by `files.js`. Keep JSON
   files only inside `lite/`, `standard/` or `full/`. The kit has none today.
4. **The workspace launcher for `standard-kit-env.sh`.** It is a sourced lib, and it does not move.
   `make-launchers.sh --check` confirms nothing changed.
5. **Frozen LITE and forced worktrees** (bench commit 69149846) read their own old tree. Not affected.
6. **The name clash stays.** `--suite lite` and `--level lite` both still exist. A later change could rename the
   older suites. That touches `tasks.js`, `cap/plan.js`, `pr-plan.js`, `refactor-regression/study.js` and the docs,
   so it is a separate decision.
7. **Parallel sessions.** Other sessions edit `bench/kit/standard/`, `bench/scenarios/` and
   `bench/docs/run-levels.md` often. A move while they hold edits makes their rebase hard. Do it in a quiet hour,
   fetch first, and push the move alone.

## Appendix A. Every file that names lite, standard or full as a suite or level

Suite-defining, run level (7):

| File | What it defines | After the move |
|---|---|---|
| `bench/scenarios/levels.js` | `LEVELS = ['lite','standard','full']`, the LITE phase picks, the STANDARD gate list, FULL = every task with a prereg | `konductor/levels.js` |
| `bench/kit/standard/helper.js` | the STANDARD task plan, arms, cost model, stage checks | `konductor/standard/` |
| `bench/kit/standard/run-standard.sh` | the STANDARD paid run: caps, stages, locks, freeze | `konductor/standard/` |
| `bench/kit/standard/judge-standard.sh` | the STANDARD judge pass | `konductor/standard/` |
| `bench/kit/standard/claude-standard.sh` | the STANDARD Claude Code arms | `konductor/standard/` |
| `bench/suites/pack.json` | the task pool every level picks from | stays |
| `bench/scenarios/pack-suite.js` | writes `pack.json` | stays |

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
