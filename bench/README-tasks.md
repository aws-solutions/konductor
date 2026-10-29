# Benchmark tasks

This document covers the task suite: tasks, fixtures, checks, rubrics, answer keys and the judge panel. The runner is documented in `bench/README.md`.

## How the pieces fit

- `tasks/<id>.json`: one task. A prompt, the fixture it runs on, deterministic checks and a judge rubric.
- `fixtures/<name>/`: a small synthetic project. The runner copies it into a scratch directory, and the agent works there.
- `suites/lite.json`, `suites/full.json`, `suites/hard.json`: which tasks run, on which arms, with how many replicates, and which judges.
- `tasks/solutions/<id>/`: a reference solution, as files overlaid on the fixture. Only the validator and unit tests use it.
- `tasks/stubs/<id>/`: a keyword-only imitation of the report, overlaid on the solution (see Mutation proof).
- `tasks/validate-tasks.js`: offline validator. Run `node bench/tasks/validate-tasks.js`.

The same prompt goes to every arm, so it must make sense without any add-on. Prompts never name a procedure, skill or agent. The `target` field says what the task exercises and is informational only.

## Task file

```json
{"id": "...", "class": "simple|sop|orchestration|review|design|hard", "target": "... or null",
 "prompt": "...", "fixture": "textkit", "timeoutSec": 300,
 "hidden": "<dir under tasks/hidden/, hard tasks only>",
 "checks": [{"type": "file_exists|contains|not_contains|min_matches|labelled_findings|fixture_unchanged|cmd|tests", "path": "", "pattern": "", "min": 1, "cmd": "", "expectExit": 0}],
 "rubric": [{"id": "...", "criterion": "...", "weight": 1}],
 "tiers": ["lite", "full" or "hard"]}
```

## Prompts

Every prompt ends with the same sentence, which the validator enforces: "Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work." Runs are unattended, so a question ends the turn with nothing written. Without the sentence, arms that ask before acting would be scored on the questions and not on the work. When a report needs a verdict, the prompt names the exact line, for example `Verdict: NEEDS FIXES`.

## Checks

Checks run in the scratch directory after the run. They need no model.

- `file_exists`: `path` is a file.
- `contains` / `not_contains`: `pattern` is a JavaScript regular expression with flags `im` (case-insensitive, `^` matches at each line start). A missing file fails both. Write patterns that accept any phrasing and Title Case.
- `min_matches`: `pattern` must match at least `min` times in the file (counts occurrences, not distinct strings).
- `labelled_findings`: `path` must hold at least `min` distinct severity-labelled findings (optional `labels`, default critical, high, important, major, medium, moderate, minor, low). Severity may sit in a section heading, a `Severity: X` line, a table cell or an inline label; the same finding listed in a table and a heading counts once. Use it instead of counting severity words.
- `tests`: hidden acceptance tests, see Hard tasks.
- `fixture_unchanged`: the file or directory at `path` is byte-identical to the pristine fixture. Used wherever the prompt says not to change tests or source.
- `cmd`: run with `sh -c`, passes when the exit code equals `expectExit` (default 0). Only `node`, `sh` and POSIX tools (`grep`, `awk`, `sort`, `wc`).

Substance checks for reports use `cmd` where counting needs more than a regex:

- Distinct `file:line` references that resolve to a real file and line, and cite at least N seeded defect locations (within 2 lines). Also accepts `file.js, line N` and `file.js#LN`.
- At least N of M defect families mentioned (`anyOf`), N headings out of M topics, and at least N items inside a named section (`awk`).

Verdict checks match a verdict line, `^[\s>*_#-]*(final\s+)?verdict[\s*_]*:[\s*_]*(needs fixes)` (plus optional backticks), so a report that only lists both options fails. The validator rejects any verdict pattern that matches a bare list of verdict words.

Some checks are regression guards that pass on the untouched fixture. The validator requires that at least one check per task fails there, so doing nothing cannot pass.

## Tolerant checks and negatives

A check must accept every reasonable phrasing (`retry`, `retries`; `5 days`, `five days`, `after 5`, `5 in REQ-6`) and still reject wrong answers. `tasks/negatives/<id>.json` lists documents laid over the reference solution and whether one check must pass or fail on them. Each check named in `loosened` needs at least two failing cases and one passing case. The validator and `node --test` both run them.

## Mutation proof

Reference solutions are realistic documents derived from the answer keys, and every check must pass on them. For each `sop`, `review` and `design` task (and the orchestration tasks that write a report) `tasks/stubs/<id>/` holds a keyword stub: the right headings and keywords, no substance. The validator lays it over the solution and requires at least one `min_matches` or `cmd` check to fail. Tasks of those classes need at least one `min_matches` check. A prompt that forbids edits needs a `fixture_unchanged` check.

## Rubrics

Each task has 3 to 6 criteria, weights 1 to 3, for the LLM judge. A criterion is checkable from the agent's output and files and is tied to a seeded defect or a required section. The judge also receives the fixture's answer key.

## Answer keys and rotation

Each fixture has `.bench-answer-key.md` listing the seeded defects, expected outputs and line references. Runners exclude it from the scratch copy and pass it to the judge. The keys, reference solutions and stubs sit in a public repository, so a later model or a web-enabled agent can read them. Rotate tasks over time: change fixtures and seeded defects between benchmark generations, and do not compare scores across generations.

## Fixtures

- `textkit`: a tiny Node module. 15 tests, 2 fail on a seeded `slugify` bug. Also has CSV defects found only by review.
- `inventory-api`: a small multi-module Node service with seeded security and logic defects. 8 tests pass.
- `product-spec`: requirements, user stories and a design stub for a library hold feature, with seeded conflicts and gaps. No code.

Fixtures have at most 15 files (40 for fixtures used only by `hard` tasks, at least 15), need no install or network, and contain no real secrets.

## Tiers and suites

`suites/full.json` lists every task except the `hard` ones. `suites/lite.json` lists exactly the 5 tasks tagged `lite`, each with `timeoutSec` at most 600, `"parallel": 1`, at least 3 fixtures and at least 4 classes, and no two on the same fix: `simple-fix-failing-test` and `simple-explain-file` (textkit), `orch-input-validation` and `review-inventory-security` (inventory-api), `design-hold-service` (product-spec). Tasks that cannot finish in 600 s (for example `sop-spec-workflow`) stay full only.

## Judge panel

Both suites list `"judges": ["gpt-5.6-luna", "deepseek-3.2", "glm-5"]`: three model families, none Claude, none the subject's family. The validator uses the runner's `checkPanel` and `checkJudgeModel` and fails on fewer than 3 judges or two of one family. `qwen3-coder-next` and `minimax-m2.5` are alternates; swap one in with `--judges` on the `judge` command.

## Add a task

1. Pick or add a fixture with a `.bench-answer-key.md`.
2. Write `tasks/<id>.json`. State inputs and output paths in the prompt and end it with the sentence above.
3. Add checks, at least one failing on the untouched fixture, plus substance checks for reports.
4. Add 3 to 6 rubric criteria tied to the answer key.
5. Add `tasks/solutions/<id>/` that passes every check, and `tasks/stubs/<id>/` for reports.
6. Add the id to `suites/full.json` (and `lite.json` if tagged `lite`), then run the validator.

## Hard tasks

Class `hard`, tiers `["hard"]`, `timeoutSec` 900 to 1500, suite `suites/hard.json` (also `--suite hard`). Each combines a
short spec spread over several files, interacting defects, a trap a second look would catch, constraints (public API,
no dependencies, existing tests untouched, docs kept consistent) and distractors. The prompt gives the contract and
never names hidden tests, grading, agents, skills or reviewers.

- Hidden tests: `hidden: "<name>"` points to `tasks/hidden/<name>/`. At check time the runner copies the run's workspace
  into a scratch directory, replaces the paths the overlay holds, overlays it and runs the command there. The agent's
  directory never holds the files; the directory is masked in the namespace like fixtures and solutions. Tests must
  assert behavior stated in the prompt or the docs, not private names, and be deterministic, offline, under 60 s.
- Check `{"type":"tests","cmd":"node --test hidden/*.test.js","min":N}`: `min` is the known number of hidden tests.
  It passes only if all pass. Every run records `checks[].tests` and `hiddenTests` `{passed,total,unparsed}`. A crash,
  a timeout or unreadable output scores 0 of `min` and sets `unparsed`; tests that never ran count as failed.
  `recheck` re-scores it. The judge bundle shows counts only. The report adds "hidden tests passed" beside "pass":
  the mean pass fraction and how many runs pass all.
- Partial solutions: `tasks/partials/<id>/<name>/`, overlays on the fixture that fix part of the task. The validator
  needs at least two that score strictly between 0 and 100 percent with counts that differ from each other and from
  the fixture, so the scoring is proven to discriminate. It also needs the reference to pass all hidden tests twice
  with equal counts in under 60 s, and the untouched fixture to fail at least 30 percent.
- Add one: write the fixture (answer key included), `tasks/<id>.json` with a `tests` check, a `fixture_unchanged` check
  per existing test file and 3 process-quality rubric criteria, `hidden/<id>/hidden/*.test.js`, `solutions/<id>/`, two
  partials, then list the id in `suites/hard.json` and run the validator.

## Real tasks

Class `real`, tiers `["real"]` (the `full` suite does not include them), `timeoutSec` 900 to 1500, suite `suites/real.json`.
No fixture: `real` names an entry in `real/manifest.json` (pinned base and merge commits of a public repository, the test
command, FAIL_TO_PASS in full, PASS_TO_PASS as a count, a hash and `real/p2p/<id>.txt.gz`).
- Setup: `node bench/real/fetch.js` fetches the pinned commits (read-only https, the only networked step) into
  `/tmp/konductor-bench/realrepos` (`$BENCH_REAL_CACHE` or `--real-cache`), outside the repo. A run writes the base tree
  (no `.git`) from the cache into its cwd, checks the hash against the manifest and records the hashes in run-config.
- Check `{"type":"tests","manifest":true}`: the PR's test files (`tasks/hidden/<id>/overlay/`, unchanged, with LICENSE and
  NOTICE) are laid over a scratch copy and the manifest command runs without a network in the run's namespace.
  `hiddenTests` is FAIL_TO_PASS, `regressionTests` PASS_TO_PASS; the check passes only when both are complete.
  `fixture_unchanged` with `"allowAdditions": true` on the test directory allows new test files, not edits to old ones.
- Prompts come from the issue, name no PR, issue or link, give no fix, and end with the sentence above. 3 process rubric criteria.
- Masked per run: host copies of the project (site-packages), `~/.cache/uv`, `~/.cache/pip`, the cache and `bench/real`.
- After the run: `externalFetch` (clone, fetch, curl, wget, gh, pip or npm install, or an upstream URL in a command) and
  `fixRecall` (80+ characters of the upstream patch repeated) go to `flags`, `contamination` and the report.
- Add one: pin a PR in the manifest, then `fetch.js`, `discover.js --write`, `validate-real.js --write`, the task file, the suite.

## Autonomy tasks

Class `autonomy`, tiers `["autonomy"]` (not in `full`), `timeoutSec` 600 to 900, suite `suites/autonomy.json`. The prompt
leaves a decision open and does **not** end with the no-questions sentence (the validator requires it to be absent), says
nothing about whether anyone can answer, and never mentions clarifications, hidden tests, grading, agents, skills or benchmarks.
- `autonomy`: `{"clarifications":[{"id","topic","keywords":["regex",...],"answer"}], "maxInterjections":4,
  "defaultAnswer":"Use your best judgment and continue.", "noQuestionNeeded":false}`. At most 4 clarifications. Keywords are
  case-insensitive regexes; any one matching the agent's question selects the clarification, once. `noQuestionNeeded` tasks have none.
- `exampleQuestions`: realistic questions an agent would ask. Every clarification must match one, every example must match
  a clarification, so a keyword typo or an over-narrow pattern fails the validator.
- Hidden tests live in `tasks/hidden/<id>/intended/*.test.js` (follow the scripted answers, the primary score) and
  `invariants/*.test.js` (hold under any reasonable reading: old behavior kept, no crash, no data lost). Two `tests` checks
  with `"group": "intended"` and `"group": "invariant"`; results record `intendedTests` and `invariantTests`, and `recheck` refreshes both.
- Rubric: the three process criteria `asks-only-needed`, `states-assumptions`, `no-destructive-before-answer`, plus one on the work.
  The judge bundle gets a "Conversation" block (each question and the reply, redacted, no arm names).
- Proof the validator demands: the reference passes every intended and invariant test, twice with equal counts and in
  under 60 s; the untouched fixture fails an intended test; at least two partials under `tasks/partials/<id>/<name>/`
  (each a different wrong reading) fail an intended test and pass every invariant, so a wrong guess is measurable.
- Fixtures are new, 15 to 30 files, Node stdlib only, `node --test` offline, with an answer key that lists the decisions,
  the scripted answers and what each wrong guess breaks. Tests assert behavior, not implementation, and avoid ties the
  prompt leaves open (rounding midpoints, equal timestamps).
- Add one: fixture, `tasks/<id>.json`, `hidden/<id>/{intended,invariants}`, `solutions/<id>/`, two partials, list it in
  `suites/autonomy.json`, run `node bench/tasks/validate-tasks.js`.
