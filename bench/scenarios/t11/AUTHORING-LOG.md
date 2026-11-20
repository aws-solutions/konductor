# T11 authoring log

Public repo: no internal names, host paths or secrets. Credits are what each kiro-cli call reported. Plan estimate for
T11 (plan section 9): 140 credits, stop at 280. Every call has an abort limit of 15 credits, written to the scratch call
log before the call starts, and a tool-call cap (glm-5 80, others 150). Before every call the spend
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
| t11-media-returns-whiteboard | author | gpt-5.6-luna | 6.22 |  |
| t11-media-returns-whiteboard | map | glm-5 | 0.15 |  |
| t11-media-returns-whiteboard | review | glm-5 | 1.78 |  |
| t11-media-returns-whiteboard | fix | gpt-5.6-luna | 2.30 |  |
| t11-media-returns-whiteboard | recheck | qwen3-coder-next | 0.31 |  |
| t11-twin-pricing-validation | author | gpt-5.6-luna | 2.71 |  |
| t11-twin-pricing-validation | map | glm-5 | 0.15 |  |
| t11-twin-pricing-validation | review | glm-5 | 6.22 |  |
| t11-wide-settings-migration | step1 | qwen3-coder-next | 12.33 |  |
| t11-wide-settings-migration | fix | qwen3-coder-next | 4.04 |  |
| t11-resume-csv-export | recheck | qwen3-coder-next | 0.21 |  |
| t11-merge-pricing-branches | recheck | qwen3-coder-next | 0.23 |  |
| t11-media-returns-whiteboard | recheck | qwen3-coder-next | 0.19 |  |
| t11-wide-settings-migration | step2 | qwen3-coder-next | 0.00 |  |
| t11-wide-settings-migration | step2 cut at the tool cap (152 tools); the stream reported no credits, so it is counted at its abort limit | qwen3-coder-next | 15.00 |  |
| t11-wide-settings-migration | step1 | minimax-m2.5 | 0.22 |  |
| t11-wide-settings-migration | step1 | qwen3-coder-next | 4.05 |  |
| t11-wide-settings-migration | fix | qwen3-coder-next | 5.37 |  |
| t11-wide-settings-migration | step2 | qwen3-coder-next | 0.00 |  |
| t11-wide-settings-migration | step2 (second try) cut at the tool cap (151 tools); no credits reported, counted at its abort limit | qwen3-coder-next | 15.00 | dropped |
| t11-docx-room-booking-reqs | step1 | qwen3-coder-next | 3.18 |  |
| t11-docx-room-booking-reqs | fix | qwen3-coder-next | 2.44 |  |
| t11-guide-contributing | author | gpt-5.6-luna | 3.84 |  |
| t11-guide-contributing | fix | gpt-5.6-luna | 0.53 |  |
| t11-guide-contributing | map | glm-5 | 0.15 |  |
| t11-guide-contributing | review | qwen3-coder-next | 0.33 |  |
