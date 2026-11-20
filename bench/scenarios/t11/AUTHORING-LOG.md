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
| t11-docx-room-booking-reqs | author | gpt-5.6-luna | 4.19 |  |
| t11-docx-room-booking-reqs | map | glm-5 | 0.15 |  |
| t11-docx-room-booking-reqs | review | glm-5 | 3.56 |  |
| t11-docx-room-booking-reqs | fix | gpt-5.6-luna | 1.99 |  |
| t11-twin-pricing-validation | recheck | qwen3-coder-next | 0.15 |  |

## CV-C calls (2026-11-20)

Worker CV-C: `t11-fresh-session-memory` (written by hand, Claude) and `t11-wide-settings-refactor` (gpt-5.6-luna, two steps).
Spend rule: every paid call is counted at 15 credits before it starts, one call at a time; estimate 90, stop 180.
Calls run through a spend-checked wrapper in a scratch HOME holding only the Kiro login (settings: memory off,
reflection off, knowledge off; no steering, skills, MCP or agents), from a working directory outside every git worktree,
with a cleared environment, a tool-call cap of 150 (glm-5 80) and an abort at 15 credits. The credits column is what
the call reported.

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t11-wide-settings-refactor | step1 | gpt-5.6-luna | 4.77 |  |
| t11-wide-settings-refactor | step2 | gpt-5.6-luna | 4.79 |  |
| t11-wide-settings-refactor | map | glm-5 | 0.16 | proposed backend-development, code-review, verification; the task keeps the targets of the approved coverage review (agents-md-authoring, workspace-skills, SOP k-codebase-analysis) |
| t11-fresh-session-memory | map | glm-5 | 0.16 | proposed no target; the task keeps the targets of the approved coverage review (persistent-memory, sop-state-management, workspace-skills) |
| t11-wide-settings-refactor | review | qwen3-coder-next | 0.40 |  |
| t11-fresh-session-memory | review | qwen3-coder-next | 0.60 |  |
| t11-wide-settings-refactor | fix | gpt-5.6-luna | 1.07 |  |
| t11-wide-settings-refactor | recheck (after the rubric hand edit) | qwen3-coder-next | 0.20 | 4 of 4 pass |

CV-C blindness audit (`stage.js audit`, every stream of both tasks): 0 reads of a konductor skills/, agent-sops/, agents/ or
context/ path. The only paths outside the authoring dir are this batch's own `t11/lib/selfcheck.js` (through
`kit/selfcheck.js`) and the authoring dir's own root, which the audit lists as "other batch" only because the authoring
dir is not named `<worktree>auth`. Total for CV-C: 8 calls, 12.15 credits reported, 120 counted against the stop of 180.
