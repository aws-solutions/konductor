# T11 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported. Plan estimate for
T11 (plan section 9): 140 credits, stop at 280. Every call has an abort limit of 15 credits, written to the scratch call
log before the call starts, and a tool-call cap (glm-5 80, minimax-m2.5 70, others 150). Before every call the spend
check runs: logged spend plus this call's abort limit must stay at or under 280, with no other call in flight (one paid
call at a time). Before every call the 1-minute load is read; at 5 or more the call waits (120 s steps, up to 30 min).

## Setup check (2026-11-20)

Author, map and review calls run `kiro-cli chat --no-interactive --trust-all-tools --model <id>` (3.5.0) in a scratch
HOME (own copy of T1's, login database only), in a working directory outside every git worktree, with a cleared
environment. Checked before the first call: the HOME has no steering files, rules files, skills, MCP servers, memories
or user agents (only the shipped example); old sessions, session indexes and logs of the copy were removed;
`memory.mode disabled`, `memory.reflection false` and `chat.enableKnowledge false` are set.

## Calls

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t11-resume-csv-export | author | gpt-5.6-luna | 5.33 |  |
| t11-resume-csv-export | map | glm-5 | 0.15 |  |
| t11-resume-csv-export | review | glm-5 | 5.39 |  |
| t11-resume-csv-export | fix | gpt-5.6-luna | 0.79 |  |
| t11-merge-pricing-branches | author | gpt-5.6-luna | 6.41 |  |
| t11-merge-pricing-branches | map | glm-5 | 0.15 |  |
| t11-merge-pricing-branches | review | qwen3-coder-next | 0.85 |  |
| t11-merge-pricing-branches | fix | gpt-5.6-luna | 0.34 |  |
