# T6 authoring log

Every model call: task, step, model, credits (read from the call's stream by spend.js). Scratch homes A to E are
copies of one login-only home; checked before the first call (no steering, skills, memories, MCP config or agent
files; settings `{}`), check kept in the batch's scratch `check-home.txt`.

| Date | Task | Step | Model | Home | Credits | State |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-19 | t6-req-clinic-reminders | author | gpt-5.6-luna | A | pending | running at pause |
| 2026-11-19 | t6-req-expense-approvals | author | deepseek-3.2 | B | pending | running at pause |
| 2026-11-19 | t6-idea-churn-signal | author | gpt-5.6-luna | C | pending | running at pause |
| 2026-11-19 | t6-plan-mvp-cut | author | deepseek-3.2 | D | pending | running at pause |
| 2026-11-19 | t6-neg-glossary-rename | author | gpt-5.6-luna | E | pending | running at pause |

Paused 2026-11-19 on the lead's order (host memory critical). The five wave-1 author calls were left running (not
killed mid-write); `drafts/` holds a snapshot of their folders at the pause. No mapping, review or wave-2 call started.
