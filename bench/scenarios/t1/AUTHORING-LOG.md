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

## Dropped tasks

| task | author | why | what happened |
| --- | --- | --- | --- |
| t1-impl-env-expand | deepseek-3.2 | the reference did not run after one fix round (syntax error in the solution; the reviewer's floor verdict was fail twice) | author 50.99 credits, one fix round, dropped. Its public idea (variable expansion in settings files) is not covered by another task |
| t1-impl-cli-envvars | deepseek-3.2 | the reference scored 14.3: the hidden tests run `python3 -m foldersync` and neither the fixture nor the solution has a `__main__.py`; its existing tests failed on the solution too; the reviewer's ambiguity, hidden-answer, floor and reference verdicts were fail | author 15.48, review 18.57; no fix round (a deepseek fix round has not repaired a reference yet). Replaced by `t1-impl-cli-envprefix`, same idea, other author |
| t1-bug-csv-import | deepseek-3.2 | the author was stopped after 90 tool calls (the cap for a deepseek call) without writing `task-draft.json` | author 13.66; no task written. Not replaced yet |
| t1-refactor-esm | deepseek-3.2 | the dry run failed: the reference scored 87.4 (42 of 51 hidden tests) and the untouched fixture scored 69.1 (36 of 51 passed before any change); the reviewer's leak and floor verdicts were fail | author 35.52 credits; no fix round, because a deepseek fix round costs about 25 credits and the hidden tests tested the old code as much as the new. Replaced by `t1-ref-esm-migrate`, written by the other author with a smaller scope |

Drafts of both are kept outside the repo (scratch), not in the tree.

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
