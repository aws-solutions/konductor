# T6 authoring log

Every model call: task, step, model, credits. Credits come from the call's stream (`credits` metering event); a call
the host cut off has no metering event, so its credits come from the session file (the last cumulative
`creditSplit`, main + delegated + auxiliary). All calls ran Kiro CLI 3.5.0 in an empty scratch directory with a
login-only HOME: no steering, skills, memories, MCP config or agent files, settings `{}` (checked before the first call
and for each new home). At most two calls ran at once. Mapping read only the finished task and a file of unit names and
one-line descriptions, extracted from frontmatter by a script; no skill, SOP or agent body was read.

Estimate (plan section 9): wave 1 = 5 tasks, 90 credits (stop at 180); wave 2 = 13 tasks, 240 credits (stop at 480).

## Calls

| Task | Step | Model | Credits | Wave | Note |
| --- | --- | --- | --- | --- | --- |
| t6-idea-arch-search | author | deepseek-3.2 | 16.50 | 2 |  |
| t6-idea-arch-search | fix1 | deepseek-3.2 | 5.36 | 2 | review fix round (resumed session) |
| t6-idea-arch-search | map | glm-5 | 1.01 | 2 |  |
| t6-idea-arch-search | review | minimax-m2.5 | 3.98 | 2 |  |
| t6-idea-churn-signal | author | gpt-5.6-luna | 0.93 | 1 | cut off by the host; credits from the session file |
| t6-idea-churn-signal | fix1 | gpt-5.6-luna | 0.63 | 1 | review fix round (resumed session) |
| t6-idea-churn-signal | map | glm-5 | 0.97 | 1 |  |
| t6-idea-churn-signal | resume1 | gpt-5.6-luna | 1.68 | 1 | resumed the cut-off session |
| t6-idea-churn-signal | review | glm-5 | 3.46 | 1 |  |
| t6-idea-feature-bets | author | deepseek-3.2 | 15.26 | 2 |  |
| t6-idea-feature-bets | fix1 | deepseek-3.2 | 8.85 | 2 | review fix round (resumed session) |
| t6-idea-feature-bets | map | glm-5 | 0.97 | 2 |  |
| t6-idea-feature-bets | review | minimax-m2.5 | 2.65 | 2 |  |
| t6-idea-onboarding-dropoff | author | gpt-5.6-luna | 2.74 | 2 |  |
| t6-idea-onboarding-dropoff | map | glm-5 | 0.97 | 2 |  |
| t6-idea-onboarding-dropoff | review | glm-5 | 2.06 | 2 |  |
| t6-idea-pricing-test | author | gpt-5.6-luna | 3.19 | 2 |  |
| t6-idea-pricing-test | fix1 | gpt-5.6-luna | 2.54 | 2 | review fix round (resumed session) |
| t6-idea-pricing-test | map | glm-5 | 0.97 | 2 |  |
| t6-idea-pricing-test | review | glm-5 | 2.66 | 2 |  |
| t6-neg-glossary-rename | author | gpt-5.6-luna | 1.08 | 1 | cut off by the host; credits from the session file |
| t6-neg-glossary-rename | fix1 | gpt-5.6-luna | 0.98 | 1 | review fix round (resumed session) |
| t6-neg-glossary-rename | map | glm-5 | 0.96 | 1 |  |
| t6-neg-glossary-rename | resume1 | gpt-5.6-luna | 2.63 | 1 | resumed the cut-off session |
| t6-neg-glossary-rename | review | glm-5 | 1.74 | 1 |  |
| t6-neg-release-notes-csv | author | deepseek-3.2 | 5.06 | 2 |  |
| t6-neg-release-notes-csv | fix1 | deepseek-3.2 | 4.94 | 2 | review fix round (resumed session) |
| t6-neg-release-notes-csv | review | minimax-m2.5 | 1.65 | 2 |  |
| t6-plan-mvp-cut | author | deepseek-3.2 | 1.25 | 1 | cut off by the host; credits from the session file |
| t6-plan-mvp-cut | fix1 | deepseek-3.2 | 3.94 | 1 | review fix round (resumed session) |
| t6-plan-mvp-cut | map | glm-5 | 0.96 | 1 |  |
| t6-plan-mvp-cut | resume1 | deepseek-3.2 | 14.59 | 1 | resumed the cut-off session |
| t6-plan-mvp-cut | review | minimax-m2.5 | 2.13 | 1 |  |
| t6-req-arch-webhooks | author | gpt-5.6-luna | 2.15 | 2 |  |
| t6-req-arch-webhooks | map | glm-5 | 1.02 | 2 |  |
| t6-req-arch-webhooks | review | glm-5 | 3.36 | 2 |  |
| t6-req-clinic-reminders | author | gpt-5.6-luna | 1.29 | 1 | cut off by the host; credits from the session file |
| t6-req-clinic-reminders | map | glm-5 | 0.97 | 1 |  |
| t6-req-clinic-reminders | resume1 | gpt-5.6-luna | 0.82 | 1 | resumed the cut-off session |
| t6-req-clinic-reminders | review | glm-5 | 2.54 | 1 |  |
| t6-req-data-export | author | gpt-5.6-luna | 2.57 | 2 |  |
| t6-req-data-export | map | glm-5 | 0.96 | 2 |  |
| t6-req-data-export | review | glm-5 | 1.85 | 2 |  |
| t6-req-expense-approvals | author | deepseek-3.2 | 1.22 | 1 | cut off by the host; credits from the session file |
| t6-req-expense-approvals | fix1 | deepseek-3.2 | 3.62 | 1 | review fix round (resumed session) |
| t6-req-expense-approvals | map | glm-5 | 0.96 | 1 |  |
| t6-req-expense-approvals | resume1 | deepseek-3.2 | 10.56 | 1 | resumed the cut-off session |
| t6-req-expense-approvals | review | minimax-m2.5 | 3.51 | 1 |  |
| t6-req-fe-address-form | author | gpt-5.6-luna | 4.12 | 2 |  |
| t6-req-fe-address-form | dsauthor | deepseek-3.2 | 1.23 | 2 |  |
| t6-req-fe-address-form | dsresume1 | deepseek-3.2 | 0.00 | 2 |  |
| t6-req-fe-address-form | dsresume2 | deepseek-3.2 | 10.37 | 2 |  |
| t6-req-fe-address-form | map | glm-5 | 0.96 | 2 |  |
| t6-req-fe-address-form | review | glm-5 | 2.65 | 2 |  |
| t6-req-field-inspections | author | gpt-5.6-luna | 2.92 | 2 |  |
| t6-req-field-inspections | map | glm-5 | 0.70 | 2 |  |
| t6-req-field-inspections | review | glm-5 | 2.28 | 2 |  |
| t6-req-library-holds | author | deepseek-3.2 | 10.15 | 2 |  |
| t6-req-library-holds | fix1 | deepseek-3.2 | 4.82 | 2 | review fix round (resumed session) |
| t6-req-library-holds | map | glm-5 | 0.97 | 2 |  |
| t6-req-library-holds | review | minimax-m2.5 | 3.53 | 2 |  |
| t6-req-tpm-cutover | author | deepseek-3.2 | 20.88 | 2 |  |
| t6-req-tpm-cutover | fix1 | deepseek-3.2 | 7.46 | 2 | review fix round (resumed session) |
| t6-req-tpm-cutover | map | glm-5 | 0.95 | 2 |  |
| t6-req-tpm-cutover | review | minimax-m2.5 | 4.25 | 2 |  |
| t6-req-volunteer-shifts | author | deepseek-3.2 | 25.52 | 2 |  |
| t6-req-volunteer-shifts | fix1 | deepseek-3.2 | 12.46 | 2 | review fix round (resumed session) |
| t6-req-volunteer-shifts | map | glm-5 | 0.97 | 2 |  |
| t6-req-volunteer-shifts | review | gpt-5.6-luna | 3.41 | 2 |  |
| t6-req-volunteer-shifts | review2 | gpt-5.6-luna | 0.89 | 2 |  |
| t6-twin-clinic-costs | author | gpt-5.6-luna | 1.68 | 2 |  |
| t6-twin-clinic-costs | review | glm-5 | 1.73 | 2 |  |

Wave 1: 63.4 credits. Wave 2: 218.2 credits.

The five first wave-1 author calls were cut off by the host (memory pause) and then resumed in the same session. Credits of a running call are added when it finishes.

### Changes after review

Cross-family reviewers passed every leak check. The lead's own read found more, fixed in one author fix round each:

| Task | Found by | Change |
| --- | --- | --- |
| t6-idea-churn-signal | lead | removed the last prompt sentence, which named the distinctions to keep |
| t6-req-expense-approvals | lead | removed a sentence listing the areas to probe and a copied authoring rule; widened topics (fix round), then the lead removed overbroad topics (second, self, paid, cover, away and others) and added "is away", "on leave" |
| t6-plan-mvp-cut | lead | removed the trap list from the prompt and a stray scripted user with no answers; `fixture_unchanged` on the whole folder with additions allowed; tests `min` set to the real count (14) |
| t6-neg-glossary-rename | reviewer (ambiguity) and lead | scope stated (glossary entry with its prose, PRD metrics table only); words "fixture" and "checks" removed from the prompt |
| t6-neg-glossary-rename | lead | negative control: no target units; `mustNotLoad` from the mapper |
| t6-req-library-holds | lead, reviewer | removed "Ask me if anything's unclear"; trimmed overbroad topics; fix round tightened wrong-value patterns that flagged correct statements |
| t6-req-arch-webhooks | lead | removed "regional" and the list of constraint areas from the prompt; trimmed topics (eu, location, burst) |
| t6-req-field-inspections | lead | trimmed overbroad topics (complete, edits, how long); added sign-off topics |
| t6-req-expense-approvals | lead | the grant caps in fact F4 were already in the fixture; F4 now holds renewed caps (60, 95, 35) and the fixture marks the old caps as under renegotiation |
| t6-idea-arch-search | lead | fix round made the reference and 6 tests agree; lead removed two prompt sentences that pointed at the trap |
| t6-idea-feature-bets | lead, reviewer (ambiguity) | fix round removed "watch for duplicates and double counting" and the field name deduplicated_customers; recommendation and rounding tolerance loosened |
| t6-idea-pricing-test | lead | fix round replaced JSON field names that named the traps (campaign days, net paid, corrected range) with neutral ones |
| t6-twin-clinic-costs | lead | twin of t6-req-clinic-reminders on the same fixture (no copy); no target units, `mustNotLoad` from the real task's `mustLoad` |
| t6-req-tpm-cutover | lead | trimmed overbroad topics; fix round anchored the wrong-value patterns and checks the input files by name |
| t6-req-fe-address-form | lead | the deepseek-3.2 draft (steps ds*, three calls) had overbroad topics (for example "de", "which", "must") and a reference at 82; re-authored from the same brief by gpt-5.6-luna, reviewed by glm-5 |
| t6-req-volunteer-shifts | reviewers, lead | minimax-m2.5 found every fact in the fixture; fix round 1 removed most; a second review (gpt-5.6-luna) found the coordinator data list and "MT" in templates; the lead removed them, relaxed the F1 and F6 patterns, fixed the JSON check quoting and set tests `min` to 13 |
| t6-neg-release-notes-csv | lead | fix round removed "make sure dates are consistent and handle any special characters"; reference and the CSV quoting test made to agree |

## Blindness audit (2026-11-19)

All 72 call streams were scanned for paths outside each call's own scratch folder and HOME. None touched a skill, SOP
or agent file or the konductor tree; the only outside paths were `/var/tmp` (the kiro-cli binary) and the call's own
HOME `tmp/`. No prompt or fixture names an internal tool, host path or the owner.

## FX fix round (2026-11-20)

Paid calls of the FX job (owner-approved, hard cap 90 credits for all batches, abort limit 10 credits per call, spend checked before each call). A plan line is written before each call and a result line after it.

- plan: t6-idea-arch-search fix by deepseek-3.2, abort limit 10 credits, spend so far 29.0 of 90
- result: t6-idea-arch-search fix deepseek-3.2 credits=5.103 secs=401
- plan: t6-idea-arch-search recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 34.1 of 90
- result: t6-idea-arch-search recheck gpt-5.6-luna credits=0.596 secs=30
- plan: t6-idea-feature-bets fix by deepseek-3.2, abort limit 10 credits, spend so far 34.7 of 90
- result: t6-idea-feature-bets fix deepseek-3.2 credits=10.000 secs=551
- plan: t6-idea-feature-bets recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 44.7 of 90
- result: t6-idea-feature-bets recheck gpt-5.6-luna credits=0.556 secs=30
- plan: t6-plan-mvp-cut fix by deepseek-3.2, abort limit 10 credits, spend so far 45.3 of 90
- plan: t6-neg-glossary-rename recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 45.3 of 90
- result: t6-neg-glossary-rename recheck gpt-5.6-luna credits=0.253 secs=20
- plan: t6-neg-release-notes-csv recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 45.5 of 90
- result: t6-neg-release-notes-csv recheck gpt-5.6-luna credits=0.254 secs=20
- result: t6-plan-mvp-cut fix deepseek-3.2 credits=7.508 secs=521
- plan: t6-plan-mvp-cut recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 55.5 of 90
- result: t6-plan-mvp-cut recheck gpt-5.6-luna credits=0.997 secs=60
- plan: t6-req-volunteer-shifts fix by deepseek-3.2, abort limit 10 credits, spend so far 56.5 of 90
- result: t6-req-volunteer-shifts fix deepseek-3.2 credits=5.893 secs=471
- plan: t6-req-volunteer-shifts recheck by gpt-5.6-luna, abort limit 10 credits, spend so far 62.4 of 90
- result: t6-req-volunteer-shifts recheck gpt-5.6-luna credits=0.600 secs=50

Outcomes:

- t6-idea-feature-bets: deepseek-3.2 changed the export to 15 unique customers and $6,785, matching the hidden tests. Recheck pass. Version 3; reference 100, empty 10.2, lazy 13.6, alternative 100.
- t6-req-volunteer-shifts: deepseek-3.2 changed the hidden grounded test (no site cap numbers, which the fixture does not give) and the reference R9. Recheck pass. Version 2; reference 100, empty 5.5, lazy 5.5, alternative 100.
- t6-idea-arch-search: DROPPED. deepseek-3.2 rewrote four fixture files and one key item; the recheck still failed fixture-lists-no-answer because docs/quick_notes_random.md and docs/slack_chat_search_discussion.md state the decision. Task files are not kept in the tree.
- t6-plan-mvp-cut: DROPPED. deepseek-3.2 turned the answers in the email thread into hints and blanked the TEN-123 estimate; the recheck failed key-matches-fixture (the reference totalPoints, 209, is not the sum of the chosen items plus the open estimate). Task files are not kept in the tree.
- t6-neg-glossary-rename, t6-neg-release-notes-csv: first non-Claude recheck of the scorer fixes, both pass; no change to the tasks.

## CV-D calls

Coverage-review wave (2026-11-20), batch CV-D (t6-research-backed-framing, t6-architect-idea-spike, t6-developer-feasibility-spike): estimate 135 credits, hard stop 140. The run script counts every row below plus 15 for the next call and refuses a call that could pass 140. Same isolation as the earlier T6 calls (scratch HOME with the login database only, memory and knowledge off, empty working directory outside every git worktree). A tool-call cap of 70 stops a runaway call.

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t6-research-backed-framing | data | gpt-5.6-luna | 1.71 |  |
| t6-research-backed-framing | key | gpt-5.6-luna | 2.42 |  |
| t6-architect-idea-spike | author | claude-sonnet-5.5 | 8.41 |  |
| t6-developer-feasibility-spike | author | claude-sonnet-5.5 | 10.08 |  |
| cv-d-three | map | glm-5 | 0.19 | one call, three tasks |
| t6-research-backed-framing | review | glm-5 | 1.46 |  |
| t6-architect-idea-spike | review | glm-5 | 2.38 |  |
| t6-developer-feasibility-spike | review | gpt-5.6-luna | 0.77 |  |
| t6-developer-feasibility-spike | fix | claude-sonnet-5.5 | 1.07 | review fix round |
| t6-research-backed-framing | fix | gpt-5.6-luna | 2.25 | gate fix: lazy 86.6, alt 68.8 |
| t6-architect-idea-spike | fix | claude-sonnet-5.5 | 4.23 | gate fix: lazy 94.9 |
| t6-research-backed-framing | key2 | deepseek-3.2 | 15.64 | second key writer after the gpt fix left lazy at 56.3 |
| t6-research-backed-framing | key2-fix | deepseek-3.2 | 16.19 | fix failed: reference 93, 19 of 21; task dropped |
| t6-developer-feasibility-spike | review2 | gpt-5.6-luna | 0.32 | re-review after the author's fix |

## CV-D2 calls

CV-D2 (2026-11-20): the non-Claude checklist recheck of the two hand-edited spike tasks (HAND-EDITS.md, "CV-D2 fixes"). Stop 30 counted credits; the run script counts every call flat at 15 before it starts and refuses one past 30. Isolation as above (scratch HOME with the login database only, empty working directory outside every git worktree).

| task | step | model | counted | real | note |
| --- | --- | --- | --- | --- | --- |
| t6-architect-idea-spike, t6-developer-feasibility-spike | recheck r1 | deepseek-3.2 | 15 | 0.000 | void: the run script passed a relative prompt path after changing directory, so the model got an empty prompt and did nothing |
| t6-architect-idea-spike, t6-developer-feasibility-spike | recheck r2 | deepseek-3.2 | 15 | 2.876 | one call, both tasks; stream read only files of its work dir |

Total: 30 counted of 30 (2.9 real).

RC (2026-11-20, owner-approved recheck, stop 60 counted at 15 per call):

| task | step | model | credits | note |
| --- | --- | --- | --- | --- |
| t6-architect-idea-spike | recheck | minimax-m2.5 | 1.23 | 4 of 4 pass |

- Earlier recheck by deepseek-3.2 failed no-method-or-decoy (the 1.1 s average was said to be in the prompt); it was overruled because the figure is only in the judge rubric and fixture/pitch/pitch-note.md. minimax-m2.5 (minimax) found the same: the decoy is in the fixture, not the request. Both are in `review.recheck` notes. No task edit.
