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
