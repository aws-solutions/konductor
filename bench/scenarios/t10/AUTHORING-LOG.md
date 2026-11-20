# T10 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported. Plan estimate for T10 (plan section 9): 250 credits, stop at 500. Wave 1 is 3 tasks.

## Setup check (2026-11-20)

Author, map and review calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) in a scratch HOME copied from T1's (login database only; T1's session transcripts, logs, pip cache and memories removed from the copy), with a working directory outside every git worktree and a cleared environment. Checked before the first call (`t10auth/check-home.txt`): no steering files, no rules files, no skills, no user agents (only the shipped example), no MCP config and no memories in the scratch home. After every call, `stage.js audit` lists the paths named in tool calls outside the authoring dir and flags any read of a `skills/`, `agent-sops/`, `agents/` or `context/` path or of another batch's scratch dir.

Spend check: before every call `spend-ok.sh` adds the credits logged in this file, the abort limit (20) of every call in flight and this call's own limit, and refuses the call when the total passes the batch stop (500). Every call has an abort limit of 20 credits, written in a `planned` row before it starts. The stream reports credits only at the end (DEBT D-67), so the limit is enforced by a 1700 s wall clock and a tool-call cap per model (deepseek-3.2 70, minimax-m2.5 100, glm-5 80, gpt-5.6-luna 220, others 150). At most one paid call at a time; before each call and each heavy step the 1-minute load is read from /proc/loadavg and the step waits (sleep 120, up to 30 minutes in all) while it is 5 or more.

Second family: tasks authored by qwen3-coder-next and minimax-m2.5 use the two-step method (step A: repository, request and PLANTED.md; step B: hidden tests, keys and reference), as in T2. One fix round, then the task is dropped, never hand-fixed.

Scoring of every task: three `tests` checks (the feature's behaviour tests; the design note's key over its closing JSON block; the rollout plan's key over its), other checks, and an expert key for the judges. The two document keys use the shared block grader; `block.test.js` reads its key from `$BLOCK_KIT/key.json` (default `block-kit`), a one-line change to the shared helper so a task can grade two documents.

## Calls

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t10-pm-plan-limits | author (planned) | gpt-5.6-luna | - | abort limit 20 credits (1700 s, 220 tool calls); batch spend before: 0.00 of 500 |
