# T6 authoring log

Every model call: task, step, model, credits. Credits come from the call's stream (`credits` metering event); a call
the host cut off has no metering event, so its credits come from the session file (the last cumulative
`creditSplit`, main + delegated + auxiliary). All calls ran Kiro CLI 3.5.0 in an empty scratch directory with a
login-only HOME: no steering, skills, memories, MCP config or agent files, settings `{}` (checked before the first call
and for each new home). At most two calls ran at once. Mapping read only the finished task and a file of unit names and
one-line descriptions, extracted from frontmatter by a script; no skill, SOP or agent body was read.

Estimate (plan section 9): wave 1 = 5 tasks, 90 credits (stop at 180); wave 2 = 13 tasks, 240 credits (stop at 480).

## Wave 1

| Task | Step | Model | Credits | Wave | Note |
| --- | --- | --- | --- | --- | --- |
| t6-idea-churn-signal | author | gpt-5.6-luna | 0.93 | 1 | cut off by the host; credits from the session file |
| t6-idea-churn-signal | fix1 | gpt-5.6-luna | 0.63 | 1 | review fix round (resumed session) |
| t6-idea-churn-signal | map | glm-5 | 0.97 | 1 |  |
| t6-idea-churn-signal | resume1 | gpt-5.6-luna | 1.68 | 1 | resumed the cut-off session |
| t6-idea-churn-signal | review | glm-5 | 3.46 | 1 |  |
| t6-neg-glossary-rename | author | gpt-5.6-luna | 1.08 | 1 | cut off by the host; credits from the session file |
| t6-neg-glossary-rename | fix1 | gpt-5.6-luna | 0.98 | 1 | review fix round (resumed session) |
| t6-neg-glossary-rename | map | glm-5 | 0.96 | 1 |  |
| t6-neg-glossary-rename | resume1 | gpt-5.6-luna | 2.63 | 1 | resumed the cut-off session |
| t6-neg-glossary-rename | review | glm-5 | 1.74 | 1 |  |
| t6-plan-mvp-cut | author | deepseek-3.2 | 1.25 | 1 | cut off by the host; credits from the session file |
| t6-plan-mvp-cut | fix1 | deepseek-3.2 | 3.94 | 1 | review fix round (resumed session) |
| t6-plan-mvp-cut | map | glm-5 | 0.96 | 1 |  |
| t6-plan-mvp-cut | resume1 | deepseek-3.2 | 14.59 | 1 | resumed the cut-off session |
| t6-plan-mvp-cut | review | minimax-m2.5 | 2.13 | 1 |  |
| t6-req-clinic-reminders | author | gpt-5.6-luna | 1.29 | 1 | cut off by the host; credits from the session file |
| t6-req-clinic-reminders | map | glm-5 | 0.97 | 1 |  |
| t6-req-clinic-reminders | resume1 | gpt-5.6-luna | 0.82 | 1 | resumed the cut-off session |
| t6-req-clinic-reminders | review | glm-5 | 2.54 | 1 |  |
| t6-req-expense-approvals | author | deepseek-3.2 | 1.22 | 1 | cut off by the host; credits from the session file |
| t6-req-expense-approvals | fix1 | deepseek-3.2 | 3.62 | 1 | review fix round (resumed session) |
| t6-req-expense-approvals | map | glm-5 | 0.96 | 1 |  |
| t6-req-expense-approvals | resume1 | deepseek-3.2 | 10.56 | 1 | resumed the cut-off session |
| t6-req-expense-approvals | review | minimax-m2.5 | 3.51 | 1 |  |

Wave 1: 63.4 credits.

The five first author calls were cut off by the host (memory pause) and then resumed in the same session.

### Changes after review

Cross-family reviewers passed every leak check. The lead's own read found more, fixed in one author fix round each:

| Task | Found by | Change |
| --- | --- | --- |
| t6-idea-churn-signal | lead | removed the last prompt sentence, which named the distinctions to keep |
| t6-req-expense-approvals | lead | removed a sentence listing the areas to probe and a copied authoring rule; widened topics (fix round), then the lead removed overbroad topics (second, self, paid, cover, away and others) and added "is away", "on leave" |
| t6-plan-mvp-cut | lead | removed the trap list from the prompt and a stray scripted user with no answers; `fixture_unchanged` on the whole folder with additions allowed; tests `min` set to the real count (14) |
| t6-neg-glossary-rename | reviewer (ambiguity) and lead | scope stated (glossary entry with its prose, PRD metrics table only); words "fixture" and "checks" removed from the prompt |
| t6-neg-glossary-rename | lead | negative control: no target units; `mustNotLoad` from the mapper |
