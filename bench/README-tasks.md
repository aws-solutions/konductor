# Benchmark tasks

This document covers the task suite: tasks, fixtures, checks, rubrics, answer keys and the judge panel. The runner is documented in `bench/README.md`.

## How the pieces fit

- `tasks/<id>.json`: one task. A prompt, the fixture it runs on, deterministic checks and a judge rubric.
- `fixtures/<name>/`: a small synthetic project. The runner copies it into a scratch directory, and the agent works there.
- `suites/lite.json`, `suites/full.json`, `suites/hard.json`, `suites/complex.json`, `suites/requirements.json`: which tasks run, on which arms, with how many replicates, and which judges.
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

A task keeps its own tier and may also carry `"pilot"` (for example `["lite", "full", "pilot"]`). `suites/pilot.json` lists the pilot tasks, and the validator requires the file and the tag to agree.

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

### Revised checks of `design-hold-service`

Four checks measured wording and layout, not content, and failed designs that had the content. Across the pilot (3 of 4 arms) and a 5-arm lite run (7 of 15 runs) they failed designs that had every required part.

- Notification failure (check 4): the failure term had to come before the "does not block" phrase, and only "bounce", "no email" and a few address phrases counted. It now accepts either order within 400 characters, more failure terms (bad, invalid or rejected address, relay outage, permanent rejection, retries exhausted, dead letter) and any stated consequence for the hold or queue (never blocks or releases, stays reserved, queue keeps moving, goes straight to failed, copy released, next member, retry). A design that names bounces but states no consequence still fails.
- Assumptions (check 10): the word "assum" had to appear twice. A design with an Assumptions heading and eight listed items had it once. It now passes with two uses of the word, or with an assumptions heading or an Assumption column followed by two list items or table rows.
- Section topics (check 12): topics had to be standalone headings. It now also reads bold lead-ins ("**API.**") and the first row of a table ("| Component | Responsibility |"), and counts "table" for the data model. Six of eight topics are still needed.
- Weekly report (check 13): a line was flagged unless it said "out of scope", "deferred" and similar. A line that keeps retention "for the later weekly report" was flagged. Lines saying later, future or follow-up are now allowed; a line that designs the report still fails.

Results of this task scored before this change are stale for these four checks. The judge revision (prompt, rubric, answer key) is unchanged, so judgments stay valid. `bench.js recheck --run DIR` applies the new checks to saved runs and keeps the first results under `checksOriginal`; the new checks hash is the `checksRevision` it records.

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
- `req-inventory`: the inventory service plus a short stakeholder request (`docs/stakeholder-request.md`) with nine seeded items: three vague terms, two conflicts, one impossible constraint, one missing non-functional requirement and two unstated assumptions.
- `plan-inventory`: the inventory service plus a reservation feature request (`docs/feature-request.md`) with five required parts, three dependency edges, one part that can run in parallel, a migration-order trap and a concurrency requirement.

Fixtures have at most 15 files (40 for fixtures used only by `hard` tasks, at least 15), need no install or network, and contain no real secrets.

## Tiers and suites

`suites/full.json` lists every task except the `hard` ones. `suites/lite.json` lists exactly the 5 tasks tagged `lite`, each with `timeoutSec` at most 600, `"parallel": 1`, at least 3 fixtures and at least 4 classes, and no two on the same fix: `simple-fix-failing-test` and `simple-explain-file` (textkit), `orch-input-validation` and `review-inventory-security` (inventory-api), `design-hold-service` (product-spec). Tasks that cannot finish in 600 s (for example `sop-spec-workflow`) stay full only.

## Judge panel

Both suites list `"judges": ["gpt-5.6-luna", "deepseek-3.2", "glm-5"]`: three model families, none Claude, none the subject's family. The validator uses the runner's `checkPanel` and `checkJudgeModel` and fails on fewer than 3 judges or two of one family. `qwen3-coder-next` and `minimax-m2.5` are alternates; swap one in with `--judges` on the `judge` command.

## Variants

`variants/` holds optional copies of a task with one change. No suite lists it and no suite file names it in `extraTasks`, so no saved run, judgment or report changes. Pass `--extra-tasks bench/variants` to run or judge one. Validate with `node bench/tasks/validate-tasks.js --only-extra --extra-tasks bench/variants`. The directory is laid out like `rootcause/`: task files beside `solutions/` and `stubs/`, with fixtures taken from `bench/fixtures`.

`design-hold-service-diagrams` is `design-hold-service` with a request for three fenced mermaid diagrams: a sequence diagram of a returned copy and the next member being notified, a component diagram and a data model diagram. It differs from the original in four ways:

- The prompt gains one request for the diagrams, asks for labeled arrows and asks for the same names in the diagrams and the text.
- Two checks are added: at least 3 diagram fences, and a sequence diagram marker.
- The line limit is 260 instead of 200, and the timeout is 900 s instead of 600 s.
- The rubric gains a `diagrams` item. `limit` and `scope` are merged into `limit-and-scope` because a task holds at most 6 rubric items.

Why a copy and not an edit: a judgment is keyed to the task revision, which hashes the prompt, the rubric and the answer key. Editing `design-hold-service` would turn every saved judgment of it stale and would put runs made with the old wording under the new one. The variant has its own id, so its results never mix with the original's. The quality pack's diagram criteria apply to both tasks, because both declare a design.

## Add a task

1. Pick or add a fixture with a `.bench-answer-key.md`.
2. Write `tasks/<id>.json`. State inputs and output paths in the prompt and end it with the sentence above.
3. Add checks, at least one failing on the untouched fixture, plus substance checks for reports.
4. Add 3 to 6 rubric criteria tied to the answer key.
5. Add `tasks/solutions/<id>/` that passes every check, and `tasks/stubs/<id>/` for reports.
6. Add the id to `suites/full.json` (and `lite.json` if tagged `lite`; a task tagged `requirements` goes to `suites/requirements.json` only), then run the validator.

## Requirements tasks

Tier `requirements`, suite `suites/requirements.json` (the `full` suite does not include them), `timeoutSec` 600. Two tasks whose output is a document, not code:
- `req-vague-request` (class `design`): turn a vague stakeholder request into `docs/requirements.md`. The fixture's answer key lists nine seeded items with ids (R-A1 to R-U2).
- `plan-multipart-feature` (class `sop`): write a work breakdown at `docs/plan.md` for a multipart feature and implement nothing. The key lists five parts (PT1 to PT5), three dependency edges (DE1 to DE3), the parallel part (PA1), the trap (TR1) and the concurrency requirement (NF1).
- Each seeded id is checked by a `cmd` check that finds the topic and a word that marks it as unclear or needing a decision within 400 characters, and is named in a rubric item. A test keeps that mapping complete: an id in an answer key that no check or rubric item names fails it.
- The checks accept a document that names an item. The rubric and the quality pack (`requirements`, `plan` artifact types) judge how well it was handled. `tasks/negatives/` holds near misses that each keyword check must reject.
- Checks revised after the 2x2 requirements pilot, because they tested layout and wording more than content. `plan-multipart-feature`: the task id count may be 5 to 25 (was 5 to 12); the done-criteria check also counts a table column named Done when, Acceptance or Verification (every task row needs a filled cell); the risk check also accepts a risk table with a filled Mitigation or Response column. `req-vague-request`: the length cap is 500 non-blank lines (was 250); the numbered-requirement check now asks that at least 80% of the numbered requirements carry an acceptance check, written as AC, Acceptance, Check or a table column of that name (it used to need list lines with the word "shall"); the conditional-statement check accepts plain outcome verbs as well as "shall" and "must"; the issues heading may be any heading about assumptions, questions, conflicts, gaps or ambiguities. Runs of these two tasks made before the change are stale for those checks. Re-apply the current checks to their saved workspaces with `bench.js recheck --run DIR` (it keeps the first results in `checksOriginal`), then report again; `--scoring bench/profiles/scoring-fractional.json` shows the same runs with partial credit for checks.
- Both tasks declare their artifact type in `criteria/quality-pack.json` (`taskArtifacts`), so the pack scores them without inference.

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

## Complex tasks

Class `complex`, tier `full` (they are not in the `full` suite), `timeoutSec` 1800, suite `suites/complex.json` (also `--suite complex`; 3 arms, 1 replicate, `--parallel 1`, the usual judge panel). The suite file declares the extra directory `bench/complex/`, which holds `cx-*.json` beside `fixtures/`, `solutions/`, `stubs/`, `partials/` and `hidden/`, and the agent never sees it (it is masked like the other bench directories). Where a hard task is one contract with hidden defects, a complex task asks for several steps in order, so one run shows whether the work holds together: a design and then the code that follows it, a refactor across many files, a feature through every layer plus its docs, a review and then only the fixes it justifies.

The rules are those of hard tasks, checked by the same validator: hidden tests (a `tests` check with `min`), a `fixture_unchanged` check on the existing tests, a reference solution that passes every check, at least two partial solutions that score strictly between 0 and 100 percent with counts that differ, an untouched fixture that fails at least 30 percent of the hidden tests, and a stub that fails a `cmd` or `min_matches` check. Differences: the timeout may go up to 1800 s, a fixture needs no minimum size (at most 15 files, answer key excluded), the tasks must live in an extra directory, and a task has 3 to 6 rubric items as usual. Validate with `node bench/tasks/validate-tasks.js --only-extra --extra-tasks bench/complex` (about 10 s, no model call, no runner). `bench/runner/test/complex-suite.test.js` checks suite membership and the shape of each task.

| task | fixture (visible files) | asks for | hidden tests | checks | rubric |
| --- | --- | --- | --- | --- | --- |
| `cx-design-then-implement` | `cx-holds` (11) | `docs/design.md` (problem, architecture, details, data model, API, alternatives with decision and consequences, a mermaid diagram), then the stock hold service in `src/` | 12, two on concurrency | 12: design sections, mermaid fence, alternatives with a decision, design endpoints and data model fields found in `src/`, existing tests unchanged | design and code agree, alternatives and consequences, diagram fit, concurrency, verification |
| `cx-multifile-refactor` | `cx-shipping` (11) | copied helpers moved to `src/util.js` and `calcBase` renamed to `baseRate` across code and docs, public API and quotes unchanged | 15: nine lock behaviour (they pass on the untouched fixture), six check the new shape | 11: no leftover name, one copy of each helper, exact public exports, changelog entry | diff minimality, complete rename, changelog and docs, evidence, API and tests untouched |
| `cx-feature-across-layers` | `cx-notes` (10) | tags through storage (file version 2 with upgrade of old files), service, validation and CLI, plus a README Tags section | 15, through the command line and the JSON file | 12: error codes 2 and 3, an old-format file, the README examples run against `./src` and their output compared | README accuracy, plain language, test quality, layering, verification |
| `cx-review-then-fix` | `cx-ledger` (11) | `review.md` (severity, file and line, fix), then fixes for the real defects only | 14: six fail before the fixes, eight guard nearby behaviour and the two decoys | 13: labelled findings, file and line references near the three seeded defects, the decoy files byte for byte unchanged | review quality, not over-fixing, root-cause fixes, regression tests |

Notes for each fixture are in its `.bench-answer-key.md`. The reference solutions and stubs are in `bench/complex/solutions/` and `bench/complex/stubs/`. A stub keeps the right headings or docs and leaves the code unfixed, so only a content check catches it.

Cost: not measured. Observed credits for one pass (table in `README.md`) are 3.3 per hard task for vanilla (hard-A, 6 tasks, 20.06) and about 3.4 times that for a skill-loading arm on the lite suite (6.78 against 23.31 and 31.01). These tasks have several steps and a longer transcript, so plan on roughly 7 to 10 credits per task for vanilla and 20 to 35 for v1.2.0 and main, about 110 to 190 for the four tasks on three arms with one replicate, plus judging. Run one task first with `--tasks` and `--budget-credits` to get a real figure before the suite.

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

## Rootcause suite: skills reached through the agents that own them

A bench run of the earlier tasks never loaded 68 of the 82 skills. Four causes show in the earlier investigation: no counted task covers frontend, infrastructure and IAM, DynamoDB, Smithy, cost, QA, requirements, planning, program management or onboarding work; the specialist agents that own those skills were entered in 3 runs or fewer; a sibling skill wins when two cover the same ground (the backend review skill loaded 56 times while the adversarial review and the pull request review skills loaded 0); and every earlier prompt ends with "Do not ask me questions", which rules out the skills that exist to ask them. The rootcause suite answers the first three with tasks that are run through the owning agent, and the fourth with one task that answers clarifying questions from a fixed list. It does not prove a skill helps. It shows whether a skill loads when its owner does the work, and which skill loads instead when it does not.

### Where the files are

- `suites/rootcause.json` lists 20 tasks: 9 that already exist and 11 new ones. `suites/rootcause.manifest.json` holds what the task schema cannot: the entry agent of each task, the skills it should load (`expectedSkills`) and may load (`possibleSkills`), seeded items, check and rubric counts, a credit estimate, the run commands per entry agent and a coverage map of all 82 skills.
- The 11 new tasks live in `rootcause/` (an extra tasks directory), with `rootcause/fixtures`, `solutions`, `stubs`, `negatives`, `hidden` and `partials` laid out like `tasks/`. They are not in `tasks/` because the task schema is closed and the validator makes every task in `tasks/` a member of the `full` suite. `--suite rootcause` adds the directory by itself (`extraTasks` in `suites/rootcause.json`); `--extra-tasks bench/rootcause` gives the same result and may also be passed.
- `rootcause/scenarios/` holds draft trigger sets (see Competition scenarios below).

Validate the new tasks alone in seconds with `node bench/tasks/validate-tasks.js --extra-tasks bench/rootcause --only-extra`, or with the rest of the bench by dropping `--only-extra`. A plain `node bench/tasks/validate-tasks.js` also checks `bench/rootcause`, because the suite file names it. The suite is registered in `SUITE_DEFAULTS` (`runner/lib/tasks.js`): 3 arms, 2 replicates, `--parallel 1`. Pass `--tasks` to run one entry agent's share.

### Tasks, entry agents and expected skills

Credits are for one run of a konductor arm and are estimates except where noted (see Cost plan).

| Task | Source | Entry agent | Expected skills | Seeded items | Checks | Rubric items | Credits per run |
|------|--------|-------------|-----------------|--------------|--------|--------------|-----------------|
| `req-vague-request` | existing | k-product-manager | requirements-extraction, user-story-writing | 9 | 24 | 6 | 7.7 (5.5 to 10.5) |
| `plan-multipart-feature` | existing | k-tpm | program-planning, risk-management, task-decomposition | 11 | 21 | 6 | 5.4 (4 to 8) |
| `sop-plan` | existing (weak) | k-tpm | program-planning, risk-management | 9 | 14 | 6 | 5 (3 to 9) |
| `sop-test-coverage-review` | existing | k-quality-assurance | test-coverage-analysis, e2e-test-strategy, security-test-generation | 5 | 23 | 5 | 9 (5 to 16) |
| `sop-code-cleanup` | existing | k-developer | (legacy-prefix)-code-simplifier | 9 | 20 | 5 | 7 (4 to 12) |
| `simple-refactor` | existing | k-developer | (legacy-prefix)-code-simplifier | 1 | 4 | 4 | 2.5 (1.5 to 4) |
| `orch-patch-release` | existing | k-developer | git-workflow | 1 | 10 | 5 | 3.5 (2 to 6) |
| `sop-spec-workflow` | existing | konductor | kiro-requirements-generation, kiro-design-generation, kiro-task-generation | 9 | 19 | 5 | 11 (6 to 20) |
| `rc-frontend-review` | new | k-developer | frontend-review | 10 | 20 | 5 | 4 (2.5 to 6) |
| `rc-infra-iam-review` | new | k-developer | infra-validation | 10 | 25 | 5 | 4.5 (3 to 7) |
|  |  | k-architect | iam-policy-design, policy-validation |  |  |  | 4.5 (3 to 7) |
| `rc-dynamodb-design` | new | k-architect | dynamodb-design, dynamodb-validation | 8 | 19 | 5 | 5 (3 to 7) |
| `rc-smithy-api` | new | k-architect | smithy-modeling, smithy-validation | 9 | 31 | 5 | 5 (3 to 7) |
| `rc-tpm-status` | new | k-tpm | status-reporting, risk-management | 9 | 21 | 5 | 5 (3 to 7) |
| `rc-agents-md` | new | k-developer | agents-md-authoring | 7 | 20 | 5 | 2.5 (1.5 to 4) |
|  |  | konductor | agents-md-authoring |  |  |  | 2.5 (1.5 to 4) |
| `rc-threat-model` | new | k-architect | threat-modeling | 9 | 20 | 5 | 5 (3 to 7) |
| `rc-queue-decision` | new | k-architect | socratic-elicitation, deliberation-panel | 5 | 6 | 4 | 5.5 (3 to 8) |
| `rc-plan-review` | new | k-tpm | plan-review | 10 | 22 | 5 | 4 (2.5 to 6) |
| `rc-legacy-estimate` | new | k-tpm | legacy-to-agentic-estimate | 10 | 19 | 5 | 4 (2.5 to 6) |
| `rc-req-to-design` | new | k-architect | requirements-extraction, system-design-patterns | 10 | 21 | 5 | 5.5 (3 to 8) |
| `orch-search-hardening` | existing | k-developer | security-remediation, backend-development | 7 | 12 | 4 | 6 (3 to 10) |

The existing tasks and what they unlock: `req-vague-request` (requirements extraction and user stories), `plan-multipart-feature` (program planning, risk management, task decomposition), `sop-test-coverage-review` (test coverage analysis, end to end strategy, security test generation), `sop-code-cleanup` and `simple-refactor` (the code simplifier), `orch-patch-release` (git workflow), `orch-search-hardening` (a security fix with tests and a risk list, reached through the developer agent), `sop-spec-workflow` (the three spec generation skills, reached through delegation from the orchestrator). `sop-plan` is a weak extra: it only suggests program planning and risk management. Two of the skills carry a legacy prefix; their exact names are in the manifest as escaped JSON strings.

The new tasks are seeded the same way as the earlier ones: each fixture has an answer key with ids, each task has deterministic checks that look for content (a topic near the right file, a count with generous bounds, a structure check on a Smithy model or a policy JSON) and a graded rubric with one item per seeded group plus a no-false-claims item. Near misses and reference solutions are under `rootcause/negatives` and `rootcause/solutions`. `rc-plan-review` reviews a work plan against its background (ten seeded problems, a rating and a verdict). `rc-legacy-estimate` converts a table of all-human estimates into agentic ranges; its reference numbers come from the conversion script of the skill, one row has a text estimate and one has no description, and a flat discount fails. `rc-req-to-design` hands product documents to the architect (design inputs under `design/` and a system design); its checks read every file under `design/`, so the agent may name the input files freely. `rc-queue-decision` is an autonomy task: its prompt leaves ordering, retention and who runs the system open, four clarifications answer the questions an agent should ask (including consent to a deeper multi-perspective analysis), and hidden tests score the document against the intended reading.

### Run it per entry agent

An entry agent is chosen per arm with `--arm-agent`, so each entry agent is one run directory. Each run has vanilla (no agent) plus three konductor arms, so every entry agent gets its own baseline. The arms are `v1.2.0`, the main commit and the stack head; `--arm-agent` names every konductor arm. The commands are in the manifest (`commands.perEntryAgent`); this is the shape:

```sh
OUT=/var/tmp/rootcause-run
node bench/runner/bench.js run --suite rootcause \
  --tasks plan-multipart-feature,sop-plan,rc-tpm-status \
  --arms vanilla,v1.2.0,mainsha=<main-sha>,stack149=<stack-sha> \
  --arm-agent v1.2.0=k-tpm,mainsha=k-tpm,stack149=k-tpm \
  --replicates 2 --parallel 1 --budget-credits 162 --out "$OUT/k-tpm"
```

Repeat for k-product-manager, k-quality-assurance, k-developer, k-architect and konductor with the task lists in the manifest. Two tasks run through two agents (`rc-infra-iam-review`, `rc-agents-md`), so their vanilla cell is run twice. Every agent must be installed by every konductor arm; the run stops at once if an arm lacks it.

### Reading the expected-versus-actual load matrix

Each finished run keeps `<run>/<arm>/<task>/<replicate>/result.json` with `skillsLoaded` (name and count). `bench.js skills --run DIR` prints the per-run detail and `cap prune-report --runs-glob 'OUT/*'` pools loads per skill. To build the matrix, take `expectedPairs` from the manifest (task, entry agent, skill) and count, for each pair and arm, the replicates whose `skillsLoaded` names the skill.

- A cell with loads in at least half of the replicates is a hit. Loads in some replicates are partial. Zero is a miss.
- A miss with a passing task says the model did the work without the skill; the skill may still help the score, which only the per-skill study can show. A miss where a sibling loaded (the `possibleSkills`, or the group in the competition files) says the sibling won.
- A miss with no skill loaded at all says the description did not match the prompt, or the skill is not listed by the entry agent. Check the agent spec before blaming the description: the runner records `installed-agent.json` from the orchestrator spec for every entry agent, so its exposure figures can be wrong for the others.
- `possibleSkills` are never counted as misses. Report loads per arm and per model; do not pool.

### Competition scenarios

`rootcause/scenarios/` holds drafts for a later `cap trigger` run. All are marked `draft-unreviewed`: a person edits or deletes them before use and assigns splits.

- `skill-*.trigger.json`: for eight skills in two sibling groups (code review: backend review, adversarial review, pull request review, frontend review; design: design doc guidelines, system design patterns, trade-off evaluator, DynamoDB design). Each has 7 prompts that only that skill should match and 6 to 9 near misses, which are the exclusive prompts of its siblings. They pass the `cap import` text rules and load with `cap trigger --queries FILE`.
- `competition-code-review.json`, `competition-design.json`: the same exclusive prompts by skill plus four ambiguous prompts per group where two or three siblings could load. The ambiguous prompts are not in the per-skill files because they have no single right answer; run them and record which sibling loads.
- `seeds/uncovered-skills.seed.json`: 123 seed prompts (two should-load and one near miss) for 41 skills that no task reaches, each with its entry agent. They are inputs for `cap scenarios --mode trigger --seed-queries`, not finished sets.

### Coverage of the 82 skills

31 skills are expected by a task (the first column of the table), 5 more by a scenario set, 37 more by seed prompts only: 73 of 82 have at least one task or scenario that should load them. The three tasks added later and the registration of `orch-search-hardening` moved five skills up to task level: plan-review, legacy-to-agentic-estimate, system-design-patterns, security-remediation and backend-development (the total of 73 does not change, because each already had a scenario set or seed prompts). Seed-only skills have no runnable test yet. Still without any: adversarial-code-review-pass-integrity (loaded by adversarial-code-review); adversarial-code-review-pass-schema (loaded by adversarial-code-review); adversarial-code-review-pass-security (loaded by adversarial-code-review); argumentation-reference (loaded by adversarial-design-review); claude-teams-behavior (Claude Code only; no Kiro agent lists it); cmux-dispatch (needs a cmux session around the agent; the bench has none); constraints (preloaded as core rules and excluded from the Kiro skill index, so a prompt cannot load it); historical-issues-registry (only an adversarial review coordinator with a platform delta layer loads it; not run standalone); mux-dispatch (needs a tmux or zellij session around the agent; the bench has none).

### Cost plan

Per run, in credits, for a konductor arm: the two observed tasks cost 7.7 and 5.4; the new tasks are estimated at 2 to 6 (4 to 5.5 for the three plan, estimate and handoff tasks); the larger existing tasks (coverage review, spec workflow, cleanup) are guesses of 7 to 11. Vanilla is taken as 0.45 of a konductor run (earlier runs: 1.75 credits for vanilla against 4.4 for the main arm). Judge credits are not included. One pass of all entry runs (vanilla plus three konductor arms) is about 394.6 credits (237.7 to 621.4).

| Replicates | Runs | Credits (mid) | Cap (1.5x) |
|------------|------|---------------|------------|
| 2 | 176 | 789.2 | 1184 |
| 3 | 264 | 1183.8 | 1776 |

| Entry agent | Tasks | Runs at 2 | Runs at 3 | Credits at 2 | Credits at 3 |
|-------------|-------|-----------|-----------|--------------|--------------|
| k-product-manager | 1 | 8 | 12 | 53.2 | 79.8 |
| k-tpm | 5 | 40 | 60 | 163.4 | 245.1 |
| k-quality-assurance | 1 | 8 | 12 | 62 | 93 |
| k-developer | 7 | 56 | 84 | 207.2 | 310.8 |
| k-architect | 6 | 48 | 72 | 210.2 | 315.3 |
| konductor | 2 | 16 | 24 | 93.2 | 139.8 |

`pr-plan` prints one added arm, so it cannot print the four arm table; it also has no observed figures for this suite and needs `--budget-credits`. The table above comes from the manifest.

### Limits

- Single-shot tasks: one prompt, one run. A task shows that a skill loads for that prompt, not that it loads in a longer session.
- Only `rc-queue-decision` answers questions, from a fixed list. An agent that asks something the list does not cover gets the default answer. Skills that depend on a back and forth are covered by one task.
- Credit figures are estimates for all but two tasks. Replace them with the figures of the first run before raising the replicates.
- Checks test content with generous bounds and several small checks, so a correct document in an unusual form can still miss one. Rubric scores need the judge panel.
- The scenario files and seed prompts are drafts, written by hand from the skill descriptions. They need a person to review them; none has been run.
- The quality pack infers artifact types from the task class and prompt. `rc-queue-decision` (class autonomy) would be read as a code task, and `rc-tpm-status` and `rc-agents-md` have no inferred type. Declaring them in `criteria/quality-pack.json` needs a change to the test that requires every declared task to be in `tasks/`. The fragment is in the hand-off note.
