# T1 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported (sum of its `credits` usage). Plan estimate for the whole of T1: 440 credits; wave 1 (5 tasks) 80.

## Setup check (before the first author call, 2026-11-19)

The author, map and review calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) with a scratch HOME that holds only a copy of the Kiro login database (`~/.local/share/kiro-cli/data.sqlite3`) and the empty `~/.kiro/{agents,steering,skills,memories}` folders, in an empty working directory, with a cleared environment (PATH with a Python 3.12 first, LANG, TMPDIR, TERM; no other variable). Checked before the first call:

| Check | Result |
| --- | --- |
| steering files under the scratch home | 0 |
| rules files (AGENTS.md, CLAUDE.md, *.rules) under the scratch home or the working directory | 0 |
| user agents, skills | 0, 0 (kiro-cli writes one `agent_config.json.example` itself) |
| MCP servers (`kiro-cli mcp list`) | none configured (default agent and workspace help agent list empty) |
| settings files | 2, both created empty by kiro-cli itself |
| working directory | empty at the start of each author call |

The sandbox mount isolation the bench uses for runs (`unshare`) is not available where these calls ran, so the model could in principle read files outside its directory by absolute path. Each call's stream is scanned for paths outside the working directory and the scratch home; none were touched in the calls logged below.

## Incident: account memories reached the first calls (found 2026-11-19, fixed before the real run)

The first three author calls (and one smoke call) ran with a login copy that let kiro-cli sync the account's saved memories into the scratch home. The stream showed memory titles, summaries and one memory body attached to the model's context (4 memory attachments in the second call). Nothing was written to the repo from those calls. The calls were stopped or their output discarded, and the three tasks were authored again. Fix: the scratch home is rebuilt without the synced identity folder and sets `memory.mode disabled`, `memory.reflection false` and `chat.enableKnowledge false`. Re-checked with a probe call that asked the model to list any memory, steering or rules it could see: 0 memory attachments, 0 Memory tool calls, steering folder empty. Every call below is scanned the same way (`"memories":[{` count must be 0).

Credits of the discarded calls (not counted as tasks): t1-impl-rate-limit 2.88, t1-impl-env-expand 0.88 (stopped), t1-bug-cache-ttl 3.58 (stopped), two probe calls 0.93. Total 8.27.

## Hand edits after review

Notes on hand edits after review (no model call): `t1-bug-cache-ttl` was changed once by the worker: the dry run gave a stub score of 25.7 (two guard checks passed on the untouched fixture), so the no-dependency check became `format` and two substance weights went up (stub 19.0, reference 100); the author's limits of 90 and 180 seconds were raised to 600 and 1200. The reviewer wrote that its reference run failed 3 checks and passed 3 of 15 hidden tests; that was the plain fixture, not fixture plus solution (the dry run passes 15 of 15).

`t1-nfr-report-queries`: the author's limits of 25 and 50 seconds were raised to 900 and 1800. Python tasks now run their hidden suite with `python3 -c "import sys; assert sys.version_info[:2] == (3, 12)" && node --test ... hidden/py_bridge.test.js`: the bench pins Python 3.12 only for a task whose checks name python, and this also makes a wrong interpreter fail loudly. `dry-run.js` pins Python the same way (set `BENCH_PYTHON` to a 3.12 interpreter when the default one is a different build).

`limits`: an author guesses its own run time, and every guess was far too short (90 to 240 s), so `stage.js assemble` sets at least 600 s soft and twice the soft limit as hard; the plan sets final limits from the pilot (3x the longest pilot run).

Author families (2026-11-19, after five of six deepseek-3.2 drafts failed): the remaining deepseek briefs, and the re-author of a failed one, go to minimax-m2.5 and qwen3-coder-next in turn, with gpt-5.6-luna as their reviewer, so the batch keeps a second author family. Lazy and alternative answers (`answers/<id>/lazy`, `answers/<id>/alt`) are written by a family other than the author's (qwen3-coder-next for gpt tasks, gpt-5.6-luna otherwise), from the fixture and the request only; `dry-run.js` scores them and requires lazy 40 or less and alt 80 or more; `stage.js record` writes the four scores into `pilot.dryRun`.

Blindness audit (`audit.js`): every author, map and review stream is scanned for tool calls that read a konductor `skills/`, `agent-sops/`, `agents/` or `context/` path, for reads of another batch's scratch dir, and for attached account memories. The 42 streams up to 2026-11-19 22:30 UTC: none.

`t1-ref-schema-migrate`: the reviewer found the request did not say whether a whitespace-only address is blank, which a hidden test relies on; the worker added that sentence to the request (review verdict `fixed`).

Shallow answer check (free, 2026-11-20): `dry-run.js` also scores a shallow answer built without a model: the reference's docs, changelog, config and test files with none of its code changes. It must score 40 or less. All 15 tasks in the tree passed (15.2 to 38.1; highest t1-bug-cache-ttl 38.1, t1-ref-esm-migrate 37.8), so no scorer change was needed.

Lazy and alternative answers, first full pass (2026-11-20): qwen3-coder-next wrote lazy answers as complete as its alternatives (the first four tasks), so glm-5 now writes them for gpt-authored tasks; the lazy prompt was tightened (at most two code files, only the first, most obvious case). Of the 15 tasks, 3 pass every gate (reference 95+, stub 20-, lazy and shallow 40-, alternative 80+): t1-bug-http-retry, t1-nfr-report-queries, t1-ref-esm-migrate. The other 12 have `pilot.decision: fix`: in 9 the lazy answer passes most hidden tests (the hidden suite does not separate a shallow fix from a full one, so no check-weight change can bring it to 40 or less without tuning to that answer), and in 6 the alternative answer scores under 80. The scores are in each task's `pilot.dryRun`.

Recheck of the 4 hand-edited tasks (glm-5): three pass all four items. t1-nfr-report-queries got a fail on key-matches-fixture: the reviewer notes the hidden tests pass a `connection` argument that the fixture's `ReportDatabase` lacks. The request asks the agent to add exactly that argument, so the worker reads this as a false finding; it is left as recorded for the owner.

Scorer check for the lazy gate (free, 2026-11-20): for every task whose lazy answer scores over 40, the lazy answer's hidden-test share is 0.43 or more, and hidden tests carry 0.5 of 0.7 of the code score, so lowering or retying the non-test checks cannot bring it to 40 or less. The one case where checks lift the lazy score (t1-impl-job-retry, hidden 0.29, checks 0.73) also fails the alternative gate (20.8). No scorer was changed; these tasks stay `fix` and need harder hidden tests in a fix round.

Paid calls paused by the lead on 2026-11-20 (the owner's pilot wave 1 shares the host): `run-capped.sh` refuses every call while `work/PAUSE` exists. The call already running (t1-bug-csv-import, first step, minimax-m2.5) was stopped at its 60-tool-call cap; it wrote the repository files at the top of its folder instead of under `fixture/`, so the step failed. It gets its one fix attempt by its own family after the pause; it is not hand-fixed.

Abort limit (owner rule, 2026-11-19): every paid call from 2026-11-20 on has an abort limit of 15 credits, set before it starts. `run-capped.sh` stops a call at a tool-call count that stands for about 15 credits for its model, refuses a call when the logged spend plus 15 could pass the T1 stop of 880 credits, waits while the host's 1-minute load is 6 or more (the owner's pilot waves share it), and runs one call at a time. A call stopped before it reports is logged at 15.

Key prompt (2026-11-20): two second-family key calls (t1-bug-money-rounding, t1-nfr-bounded-fanout) wrote checks with `kind` in the place of `type`. The key prompt had named `kind` but not `type`, so part of that failure is the prompt's; it now states the full check shape with an example. Both tasks had already used their one fix attempt and stay dropped.

`t1-ref-package-split` (qwen3-coder-next, key step): the call wrote a scratch copy one folder above its working folder (still inside T1's own scratch area; no konductor or other-batch path was read, by `audit.js`), then stopped at its 150-tool-call cap without a key draft. The copy was removed; the task gets its one fix attempt by its own family.

## Dropped tasks

| task | author | why | what happened |
| --- | --- | --- | --- |
| t1-impl-env-expand | deepseek-3.2 | the reference did not run after one fix round (syntax error in the solution; the reviewer's floor verdict was fail twice) | author 50.99 credits, one fix round, dropped. Its public idea (variable expansion in settings files) is not covered by another task |
| t1-impl-cli-envvars | deepseek-3.2 | the reference scored 14.3: the hidden tests run `python3 -m foldersync` and neither the fixture nor the solution has a `__main__.py`; its existing tests failed on the solution too; the reviewer's ambiguity, hidden-answer, floor and reference verdicts were fail | author 15.48, review 18.57; no fix round (a deepseek fix round has not repaired a reference yet). Replaced by `t1-impl-cli-envprefix`, same idea, other author |
| t1-bug-csv-import | deepseek-3.2 | the author was stopped after 90 tool calls (the cap for a deepseek call) without writing `task-draft.json` | author 13.66; no task written. Not replaced yet |
| t1-refactor-esm | deepseek-3.2 | the dry run failed: the reference scored 87.4 (42 of 51 hidden tests) and the untouched fixture scored 69.1 (36 of 51 passed before any change); the reviewer's leak and floor verdicts were fail | author 35.52 credits; no fix round, because a deepseek fix round costs about 25 credits and the hidden tests tested the old code as much as the new. Replaced by `t1-ref-esm-migrate`, written by the other author with a smaller scope |
| t1-impl-cursor-paging | deepseek-3.2 | the reference scored 63.0 and the reviewer's leak, ambiguity, hidden-answer and floor verdicts were fail; no fix round (deepseek fix rounds have not repaired a reference) | see the calls table for credits |
| t1-nfr-latency-cache | minimax-m2.5 | second-family author stopped at the 90-tool-call cap without writing task-draft.json; dropped, not hand-fixed (owner rule) | see the calls table for credits |
| t1-impl-flag-rollout | minimax-m2.5 | second-family draft: the reference scored 0 (no hidden test ran) and the reviewer's leak, hidden-answer and ceiling verdicts were fail; dropped without a fix round, because the fix would keep a Python hidden suite and so a new per-task bridge copy, which the owner's no-copies rule forbids until the shared lib lands | see the calls table for credits |
| t1-ref-split-module | minimax-m2.5 | second-family draft stopped by the 45-minute watchdog before it finished; the reviewer saw a partial draft and failed all five checks; dropped, not hand-fixed | see the calls table for credits |
| t1-bug-csv-import | deepseek-3.2, then minimax-m2.5 | no usable draft after its one fix attempt by the second family: deepseek stopped at its cap; minimax wrote the repository outside fixture/ twice (moved, layout only) and its key call stopped at the 60-tool-call cap with no key-draft.json; dropped, not hand-fixed | see the calls table for credits |
| t1-bug-money-rounding | qwen3-coder-next | second-family (two-step) task: the first key used `kind` for the check type and the reviewer failed all five checks; after its one fix attempt by its own family the reference scored 28.6; dropped, not hand-fixed | see the calls table for credits |
| t1-ref-dataclasses | deepseek-3.2, then minimax-m2.5 | second-family (two-step) task: the key call stopped at its 60-tool-call cap twice (first try and its one fix attempt) without a key-draft.json; dropped, not hand-fixed | see the calls table for credits |
| t1-ref-dataclasses | deepseek-3.2, then minimax-m2.5 | second-family (two-step) task: the key call stopped at its 60-tool-call cap twice (first try and its one fix attempt) without a key-draft.json; dropped, not hand-fixed | see the calls table for credits |
| t1-nfr-bounded-fanout | qwen3-coder-next | second-family task: the single-step author stopped at its cap; in its one fix attempt (two-step) the key's checks used `kind` and the check name as the type, so no check could run; dropped, not hand-fixed | see the calls table for credits |
| t1-nfr-cache-bound | qwen3-coder-next | second-family (two-step) task: the first key call stopped at its cap; after its one fix attempt by its own family the untouched fixture scores 75 (stub gate 20 or less) and the alternative 78.6; dropped, not hand-fixed | see the calls table for credits |
| t1-ref-package-split | qwen3-coder-next | second-family (two-step) task: the first key call stopped at its 150-tool-call cap; after its one fix attempt by its own family the reference scored 28.6; dropped, not hand-fixed | see the calls table for credits |
| t1-refactor-permission-boundary (CV-F) | qwen3-coder-next | second-family (two-step) task: the first data call wrote repository files outside fixture/ and stopped at its 150-tool-call cap with failing fixture tests and no task-draft.json; its one fix attempt (data step again, with a fix note) wrote a draft whose policy signature `checkPermission(userId, userRole, action)` cannot express the owner rule the request lists; the key call then stopped at its 90-tool-call cap with no key-draft.json; dropped, not hand-fixed | see the CV-F calls table; drafts kept in scratch only |
| t1-refactor-permission-boundary (CV-F, second try) | gpt-5.6-luna | re-authored under the same id (never landed) after the qwen3-coder-next drop. After its one fix round the free gates gave reference 100, stub 0, lazy 100, alt 100: the fixture already keeps every rule in one `allowed()` function in `src/routes/documents.js`, so moving that function is the whole task and the lazy answer is complete. The brief asked for checks copied inline and written differently per handler. Not landed; DEBT row added | see the CV-F calls table |
| t1-refactor-logging-migration (CV-F) | gpt-5.6-luna | moved from minimax-m2.5 two-step to gpt-5.6-luna before any call, for wall time. After its one fix round: reference 100, stub 5.1, shallow 5.1, alt 100, lazy 79.6, and 74.5 with a second answer-writer run (the first lazy answer changed four code files, against its rules). Five of the 14 hidden tests check level filtering of one function, which any logger passes; redaction, event fields and the stdout/stderr split carry too little. Not landed; DEBT row added | see the CV-F calls table |

Drafts of dropped tasks are kept outside the repo (scratch), not in the tree.

## Calls

| task | step | model | credits |
| --- | --- | --- | --- |
| t1-impl-rate-limit | author | gpt-5.6-luna | n/a (call interrupted by a signal, no credits reported; its task was authored again) |
| t1-impl-env-expand | author | deepseek-3.2 | n/a (call interrupted by a signal, no credits reported; its task was authored again) |
| t1-bug-cache-ttl | author | gpt-5.6-luna | n/a (call interrupted by a signal, no credits reported; its task was authored again) |
| t1-impl-rate-limit | author | gpt-5.6-luna | 3.44 |
| t1-impl-rate-limit | map | glm-5 | 0.16 |
| t1-impl-rate-limit | review | glm-5 | 7.58 |
| t1-impl-env-expand | author | deepseek-3.2 | 50.99 |
| t1-impl-env-expand | map | glm-5 | 0.16 |
| t1-impl-env-expand | review | minimax-m2.5 | 3.58 |
| t1-bug-cache-ttl | author | gpt-5.6-luna | 3.03 |
| t1-bug-cache-ttl | map | glm-5 | 0.16 |
| t1-bug-cache-ttl | review | qwen3-coder-next | 0.53 |
| t1-refactor-esm | author | deepseek-3.2 | 35.52 |
| t1-refactor-esm | map | glm-5 | 0.16 |
| t1-refactor-esm | review | minimax-m2.5 | 5.31 |
| t1-nfr-report-queries | author | gpt-5.6-luna | 2.59 |
| t1-nfr-report-queries | map | glm-5 | 0.16 |
| t1-nfr-report-queries | review | glm-5 | 7.06 |
| t1-impl-env-expand | fix | deepseek-3.2 | n/a (call stopped at the 25 minute limit before it reported; about 80 tool calls, about 25 credits by the rate of the other deepseek calls) |
| t1-impl-env-expand | review | minimax-m2.5 | 3.02 |
| t1-impl-job-retry | author | gpt-5.6-luna | 3.31 |
| t1-impl-job-retry | map | glm-5 | 0.16 |
| t1-impl-job-retry | review | glm-5 | 4.75 |
| t1-impl-cli-envvars | author | deepseek-3.2 | 15.48 |
| t1-impl-cli-envvars | map | glm-5 | 0.17 |
| t1-impl-cli-envvars | review | minimax-m2.5 | 18.57 |
| t1-bug-date-range | author | gpt-5.6-luna | 2.13 |
| t1-bug-date-range | map | glm-5 | 0.16 |
| t1-bug-date-range | review | glm-5 | 3.77 |
| t1-bug-csv-import | author | deepseek-3.2 | 13.66 |
| t1-impl-webhook-verify | author | gpt-5.6-luna | 2.99 |
| t1-impl-webhook-verify | map | glm-5 | 0.16 |
| t1-impl-webhook-verify | review | glm-5 | 7.71 |
| t1-ref-callbacks | author | gpt-5.6-luna | 2.74 |
| t1-ref-callbacks | map | glm-5 | 0.16 |
| t1-ref-callbacks | review | glm-5 | 8.28 |
| t1-nfr-startup-lazy | author | gpt-5.6-luna | 2.57 |
| t1-nfr-startup-lazy | map | glm-5 | 0.17 |
| t1-nfr-startup-lazy | review | glm-5 | 5.43 |
| t1-impl-cursor-paging | author | deepseek-3.2 | 19.79 |
| t1-impl-cursor-paging | map | glm-5 | 0.16 |
| t1-impl-cursor-paging | review | minimax-m2.5 | 6.88 |
| t1-bug-http-retry | author | gpt-5.6-luna | 2.47 |
| t1-bug-http-retry | map | glm-5 | 0.16 |
| t1-bug-http-retry | review | glm-5 | 8.05 |
| t1-ref-dataclasses | author | deepseek-3.2 | 25.00 (estimate: stopped at the 90-tool-call cap before the call reported; deepseek calls cost about 0.3 credits a tool call) |
| t1-impl-money-split | author | gpt-5.6-luna | 2.21 |
| t1-impl-money-split | map | glm-5 | 0.16 |
| t1-impl-money-split | review | glm-5 | 7.95 |
| t1-nfr-bounded-fanout | author | qwen3-coder-next | 2.00 (estimate: stopped at the 90-tool-call cap before the call reported; qwen3-coder-next is billed at 0.05x) |
| t1-bug-event-listeners | author | gpt-5.6-luna | 2.88 |
| t1-bug-event-listeners | map | glm-5 | 0.16 |
| t1-bug-event-listeners | review | glm-5 | 8.64 |
| t1-ref-dep-upgrade | author | gpt-5.6-luna | 2.97 |
| t1-ref-dep-upgrade | map | glm-5 | 0.16 |
| t1-ref-dep-upgrade | review | glm-5 | 10.95 |
| t1-impl-flag-rollout | author | minimax-m2.5 | 17.55 |
| t1-impl-flag-rollout | map | glm-5 | 0.16 |
| t1-impl-flag-rollout | review | gpt-5.6-luna | 1.22 |
| t1-bug-money-rounding | author | qwen3-coder-next | 2.00 (estimate: stopped at the 90-tool-call cap before the call reported; qwen3-coder-next is billed at 0.05x) |
| t1-ref-schema-migrate | author | gpt-5.6-luna | 2.73 |
| t1-ref-schema-migrate | map | glm-5 | 0.16 |
| t1-ref-schema-migrate | review | glm-5 | 5.21 |
| t1-nfr-ndjson-stream | author | gpt-5.6-luna | 3.27 |
| t1-nfr-ndjson-stream | map | glm-5 | 0.17 |
| t1-nfr-ndjson-stream | review | glm-5 | 6.19 |
| t1-ref-split-module | author | minimax-m2.5 | 18.00 (estimate: stopped by the 45-minute watchdog before the call reported; the one finished minimax author call cost 17.55) |
| t1-ref-split-module | map | glm-5 | 0.16 |
| t1-ref-split-module | review | gpt-5.6-luna | 2.84 |
| t1-nfr-latency-cache | author | minimax-m2.5 | 18.00 (estimate: stopped at the 90-tool-call cap before the call reported) |
| t1-ref-esm-migrate | author | gpt-5.6-luna | 1.94 |
| t1-ref-esm-migrate | map | glm-5 | 0.17 |
| t1-ref-esm-migrate | review | glm-5 | 9.20 |
| t1-bug-cache-ttl | lazy+alt answers | qwen3-coder-next | 6.80 |
| t1-bug-date-range | lazy+alt answers | qwen3-coder-next | 1.82 |
| t1-bug-event-listeners | lazy+alt answers | qwen3-coder-next | 1.90 |
| t1-bug-http-retry | lazy+alt answers | qwen3-coder-next | 1.14 |
| t1-impl-job-retry | lazy+alt answers | qwen3-coder-next | 2.00 (estimate: stopped by the worker when the answer writer changed; the four finished qwen3-coder-next answer calls cost 1.14 to 6.80) |
| t1-bug-cache-ttl | lazy+alt answers | glm-5 | 4.65 |
| t1-bug-date-range | lazy+alt answers | glm-5 | 2.56 |
| t1-bug-event-listeners | lazy+alt answers | glm-5 | 3.53 |
| t1-bug-http-retry | lazy+alt answers | glm-5 | 4.29 |
| t1-impl-job-retry | lazy+alt answers | glm-5 | 5.97 |
| t1-impl-money-split | lazy+alt answers | glm-5 | 3.87 |
| t1-impl-rate-limit | lazy+alt answers | glm-5 | 12.23 |
| t1-impl-webhook-verify | lazy+alt answers | glm-5 | 4.53 |
| t1-nfr-ndjson-stream | lazy+alt answers | glm-5 | 12.86 |
| t1-nfr-report-queries | lazy+alt answers | glm-5 | 5.33 |
| t1-nfr-startup-lazy | lazy+alt answers | glm-5 | 3.21 |
| t1-ref-callbacks | lazy+alt answers | glm-5 | 3.53 |
| t1-ref-dep-upgrade | lazy+alt answers | glm-5 | 2.33 |
| t1-ref-esm-migrate | lazy+alt answers | glm-5 | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-ref-schema-migrate | lazy+alt answers | glm-5 | 6.59 |
| t1-bug-cache-ttl | recheck | glm-5 | 1.29 |
| t1-nfr-report-queries | recheck | glm-5 | 1.35 |
| t1-nfr-startup-lazy | recheck | glm-5 | 1.35 |
| t1-ref-schema-migrate | recheck | glm-5 | 1.57 |
| t1-impl-settings-expand | author | gpt-5.6-luna | 3.31 |
| t1-impl-settings-expand | map | glm-5 | 0.16 |
| t1-impl-settings-expand | review | qwen3-coder-next | 1.08 |
| t1-impl-settings-expand | lazy+alt answers | glm-5 | 5.24 |
| t1-bug-csv-import | author-data | minimax-m2.5 | 15.00 (estimate: stopped at the 60-tool-call cap before it reported; logged at the 15-credit abort limit) |
| t1-impl-cli-envprefix | author | gpt-5.6-luna | 2.64 |
| t1-impl-cli-envprefix | map | glm-5 | 0.16 |
| t1-impl-cli-envprefix | review | qwen3-coder-next | 3.25 |
| t1-impl-cli-envprefix | lazy+alt answers | glm-5 | 15.59 |
| t1-bug-csv-import | author-data | minimax-m2.5 | 7.16 |
| t1-bug-money-rounding | author-data | qwen3-coder-next | 2.26 |
| t1-bug-money-rounding | author-key | qwen3-coder-next | 10.36 |
| t1-bug-money-rounding | map | glm-5 | 0.17 |
| t1-bug-money-rounding | review | gpt-5.6-luna | 1.21 |
| t1-bug-money-rounding | lazy+alt answers | gpt-5.6-luna | 2.94 |
| t1-twin-webhook-routes | author | gpt-5.6-luna | 1.40 |
| t1-twin-webhook-routes | map | glm-5 | 0.16 |
| t1-twin-webhook-routes | review | qwen3-coder-next | 0.45 |
| t1-twin-webhook-routes | lazy+alt answers | glm-5 | 1.83 |
| t1-ref-dataclasses | author-data | minimax-m2.5 | 7.31 |
| t1-ref-dataclasses | author-key | minimax-m2.5 | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-bug-csv-import | author-key | minimax-m2.5 | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-bug-money-rounding | fix | qwen3-coder-next | 8.19 |
| t1-bug-money-rounding | review | gpt-5.6-luna | 1.04 |
| t1-bug-money-rounding | lazy+alt answers | gpt-5.6-luna | 1.17 |
| t1-ref-esm-migrate | recheck | glm-5 | 1.65 |
| t1-ref-dataclasses | author-key | minimax-m2.5 | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-neg-config-alias | author | gpt-5.6-luna | 1.22 |
| t1-neg-config-alias | map | glm-5 | 0.16 |
| t1-neg-config-alias | review | qwen3-coder-next | 0.43 |
| t1-neg-config-alias | lazy+alt answers | glm-5 | 1.99 |
| t1-nfr-bounded-fanout | author-data | qwen3-coder-next | 1.25 |
| t1-nfr-bounded-fanout | author-key | qwen3-coder-next | 10.17 |
| t1-nfr-bounded-fanout | map | glm-5 | 0.16 |
| t1-nfr-bounded-fanout | review | gpt-5.6-luna | 1.19 |
| t1-nfr-bounded-fanout | lazy+alt answers | gpt-5.6-luna | 3.10 |
| t1-twin-booking-export | author-data | minimax-m2.5 | 1.27 |
| t1-twin-booking-export | author-key | minimax-m2.5 | 6.88 |
| t1-twin-booking-export | map | glm-5 | 0.16 |
| t1-twin-booking-export | review | gpt-5.6-luna | 1.02 |
| t1-twin-booking-export | lazy+alt answers | gpt-5.6-luna | 1.13 |
| t1-nfr-cache-bound | author-data | qwen3-coder-next | 1.11 |
| t1-nfr-cache-bound | author-key | qwen3-coder-next | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-ref-package-split | author-data | qwen3-coder-next | 0.12 |
| t1-twin-booking-export | fix | minimax-m2.5 | 5.12 |
| t1-twin-booking-export | review | gpt-5.6-luna | 0.97 |
| t1-twin-booking-export | lazy+alt answers | gpt-5.6-luna | 1.24 |
| t1-ref-package-split | author-data | qwen3-coder-next | 2.93 |
| t1-ref-package-split | author-key | qwen3-coder-next | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-ref-package-split | author-key | qwen3-coder-next | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-nfr-cache-bound | author-key | qwen3-coder-next | 6.88 |
| t1-nfr-cache-bound | map | glm-5 | 0.17 |
| t1-nfr-cache-bound | review | gpt-5.6-luna | 2.28 |
| t1-nfr-cache-bound | lazy+alt answers | gpt-5.6-luna | 3.67 |
| t1-ref-package-split | author-key | qwen3-coder-next | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-ref-package-split | map | glm-5 | 0.17 |
| t1-ref-package-split | review | gpt-5.6-luna | 1.11 |
| t1-ref-package-split | lazy+alt answers | gpt-5.6-luna | 3.14 |

## CV-F calls

Coverage-review additions (owner-approved 2026-11-20): t1-nfr-stream-backpressure, t1-nfr-memory-bound, t1-refactor-permission-boundary, t1-refactor-logging-migration. CV-F stop: 185 credits (estimate 180). Before every call the run script adds 15 to the CV-F credits logged below and refuses the call if that passes 185; it waits while the 1-minute load is 6 or more, runs one call at a time, and stops a call at a per-model tool-call cap of about 15 credits. Same isolated setup as above (scratch HOME with only a login copy, memory and knowledge off, empty working dir, cleared env). SR-32 split (`bench/scenarios/split.js`): t1-nfr-stream-backpressure 1804074469 HELD-OUT, t1-nfr-memory-bound 2659386267 DEV, t1-refactor-permission-boundary 484116431 HELD-OUT, t1-refactor-logging-migration 2525062321 HELD-OUT.

Blindness audit (`stage.js audit`) of every CV-F stream: no read of a konductor `skills/`, `agent-sops/`, `agents/` or `context/` path and no read of another batch's scratch dir. The gpt-5.6-luna author and fix streams of the two NFR tasks wrote their own test logs to `/tmp/*.log` (outside their working dir, nothing else read there). Both NFR tasks used their one fix round by their own family (the fix prompt carried the dry run and worker notes: checks that named a file or constant the request never states, and hidden asserts the request did not state), and then got a small worker hand edit of their checks (HAND-EDITS.md) and a glm-5 recheck.

| task | step | model | credits |
| --- | --- | --- | --- |
| t1-nfr-stream-backpressure | author | gpt-5.6-luna | 3.64 |
| t1-nfr-stream-backpressure | map | glm-5 | 0.16 |
| t1-nfr-stream-backpressure | review | glm-5 | 4.69 |
| t1-nfr-stream-backpressure | lazy+alt answers | glm-5 | 3.47 |
| t1-nfr-stream-backpressure | fix | gpt-5.6-luna | 1.54 |
| t1-nfr-stream-backpressure | lazy+alt answers | glm-5 | 2.99 |
| t1-nfr-memory-bound | author | gpt-5.6-luna | 1.64 |
| t1-nfr-memory-bound | map | glm-5 | 0.16 |
| t1-nfr-memory-bound | review | qwen3-coder-next | 0.34 |
| t1-nfr-memory-bound | fix | gpt-5.6-luna | 0.79 |
| t1-nfr-memory-bound | lazy+alt answers | glm-5 | 4.38 |
| t1-nfr-stream-backpressure | recheck | glm-5 | 1.13 |
| t1-nfr-memory-bound | recheck | glm-5 | 1.33 |
| t1-refactor-permission-boundary | author-data | qwen3-coder-next | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-refactor-permission-boundary | author-data-fix | qwen3-coder-next | 1.17 |
| t1-refactor-permission-boundary | author-key | qwen3-coder-next | 15.00 (estimate: stopped before it reported; logged at the 15-credit abort limit) |
| t1-refactor-logging-migration | author | gpt-5.6-luna | 2.44 |
| t1-refactor-logging-migration | map | glm-5 | 0.16 |
| t1-refactor-logging-migration | review | glm-5 | 5.14 |
| t1-refactor-logging-migration | fix | gpt-5.6-luna | 1.09 |
| t1-refactor-logging-migration | lazy+alt answers | glm-5 | 4.91 |
| t1-refactor-logging-migration | lazy+alt answers | glm-5 | 5.29 |
| t1-refactor-permission-boundary | author | gpt-5.6-luna | 2.22 |
| t1-refactor-permission-boundary | map | glm-5 | 0.16 |
| t1-refactor-permission-boundary | review | qwen3-coder-next | 0.52 |
| t1-refactor-permission-boundary | fix | gpt-5.6-luna | 1.18 |
| t1-refactor-permission-boundary | lazy+alt answers | glm-5 | 2.70 |
