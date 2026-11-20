# T7 authoring log

Every model call of batch T7 (TPM), in order. Credits are read from the call's own stream (`stage.js`). Calls ran through Kiro CLI 3.5.0 in a scratch home with only a copy of the login: no steering, rules, MCP config or skills (checked before the first call).

Estimate (plan section 9, T7 row, recorded before the first call): wave 1 (5 tasks) 80 credits, stop at 160; the rest (8 tasks) 130 credits, stop at 260.

| Task | Step | Model | Seconds | Credits |
| --- | --- | --- | --- | --- |
| t7-status-slip | author | gpt-5.6-luna | 187 | 3.77 |
| t7-status-slip | map | glm-5 | 7 | 0.16 |
| t7-status-slip | review | glm-5 | 225 | 7.10 |
| t7-status-slip | fix | gpt-5.6-luna | 236 | 3.55 |
| t7-march-date | author | deepseek-3.2 | 1113 | 12.94 |
| t7-march-date | map | glm-5 | 13 | 0.16 |
| t7-status-slip | review | glm-5 | 222 | 9.45 |
| t7-march-date | review | minimax-m2.5 | 450 | 5.61 |
| t7-dep-conflicts | author | gpt-5.6-luna | 180 | 3.60 |
| t7-dep-conflicts | map | glm-5 | 8 | 0.16 |
| t7-dep-conflicts | review | glm-5 | 183 | 9.27 |
| t7-ship-train | author | gpt-5.6-luna | 179 | 2.97 |
| t7-ship-train | map | glm-5 | 11 | 0.16 |
| t7-ship-train | review | glm-5 | 135 | 5.89 |
| t7-march-date | fix | deepseek-3.2 | 897 | 12.73 |
| t7-freeze-forecast | author | gpt-5.6-luna | 172 | 3.12 |
| t7-freeze-forecast | map | glm-5 | 6 | 0.16 |
| t7-sprint-plan | author | deepseek-3.2 | 1518 | 20.88 |
| t7-sprint-plan | map | glm-5 | 5 | 0.16 |
| t7-freeze-forecast | review | glm-5 | 227 | 11.47 |
| t7-scope-cut | author | gpt-5.6-luna | 151 | 2.73 |
| t7-scope-cut | map | glm-5 | 7 | 0.16 |
| t7-scope-cut | review | glm-5 | 189 | 7.15 |
| t7-pm-launch-cut | author | gpt-5.6-luna | 190 | 2.95 |
| t7-pm-launch-cut | map | glm-5 | 9 | 0.16 |
| t7-sprint-plan | review | minimax-m2.5 | 782 | 8.37 |
| t7-pm-launch-cut | review | glm-5 | 123 | 4.40 |
| t7-release-gate | author | gpt-5.6-luna | 121 | 1.87 |
| t7-release-gate | map | glm-5 | 26 | 0.16 |
| t7-release-gate | review | glm-5 | 96 | 3.91 |
| t7-status-slip-twin | author | gpt-5.6-luna | 80 | 1.60 |
| t7-sprint-plan | fix | deepseek-3.2 | 843 | 14.78 |
| t7-status-slip-twin | review | glm-5 | 177 | 13.06 |
| t7-sprint-plan | review | minimax-m2.5 | 279 | 4.55 |
| t7-sprint-capacity | author | gpt-5.6-luna | 255 | 5.15 |
| t7-sprint-capacity | map | glm-5 | 13 | 0.16 |
| t7-sprint-capacity | review | glm-5 | 202 | 6.88 |
| t7-risk-register | author | deepseek-3.2 | 1582 | 18.46 |
| t7-risk-register | map | glm-5 | 8 | 0.16 |
| t7-program-framing | author | deepseek-3.2 | 734 | 8.17 |
| t7-program-framing | map | glm-5 | 12 | 0.16 |
| t7-risk-register | review | minimax-m2.5 | 488 | 4.37 |
| t7-program-rollup | author | gpt-5.6-luna | 178 | 3.31 |
| t7-program-rollup | map | glm-5 | 8 | 0.16 |
| t7-program-rollup | review | glm-5 | 206 | 7.27 |
| t7-program-framing | review | minimax-m2.5 | 764 | 4.45 |
| t7-dev-breakdown | author | gpt-5.6-luna | 207 | 4.53 |
| t7-dev-breakdown | map | glm-5 | 8 | 0.16 |
| t7-risk-owners | author | gpt-5.6-luna | 154 | 2.99 |
| t7-risk-owners | map | glm-5 | 9 | 0.16 |
| t7-dev-breakdown | review | glm-5 | 122 | 6.27 |
| t7-risk-owners | review | glm-5 | 206 | 11.59 |
| t7-program-brief | author | gpt-5.6-luna | 204 | 4.15 |
| t7-program-brief | map | glm-5 | 16 | 0.16 |
| t7-program-brief | review | glm-5 | 175 | 6.98 |
| t7-dev-breakdown | fix | gpt-5.6-luna | 130 | 2.98 |
| t7-dev-breakdown | map | glm-5 | 7 | 0.16 |
| t7-dev-breakdown | review | glm-5 | 120 | 7.11 |

## Spend by wave

| Wave | Tasks | Estimate | Stop at | Spent |
| --- | --- | --- | --- | --- |
| 1 | t7-status-slip, t7-march-date, t7-dep-conflicts, t7-sprint-plan, t7-ship-train | 80 | 160 | 126.26 |
| 2 | t7-freeze-forecast, t7-scope-cut, t7-pm-launch-cut, t7-release-gate, t7-status-slip-twin, t7-sprint-capacity, t7-risk-register, t7-program-rollup, t7-dev-breakdown, t7-program-framing, t7-risk-owners, t7-program-brief | 130 | 260 | 158.84 |
| All | | 210 | | 285.10 |

The worker session's own driving cost is not in this table. No wave passed its stop line. Wave 1 ran over its estimate
mostly on two deepseek-3.2 drafts and their fix rounds (t7-march-date, t7-sprint-plan), both dropped.

## Author family

All four deepseek-3.2 drafts (t7-march-date, t7-sprint-plan, t7-risk-register, t7-program-framing) were unusable and
were dropped; each was replaced by a gpt-5.6-luna draft under a new id, and the two deepseek tasks not yet started
(t7-program-rollup, t7-dev-breakdown) were switched to gpt-5.6-luna (`authorChange` in their briefs). Every landed T7
task therefore has an openai author; reviewers (glm-5) and the mapper (glm-5) are zhipu. See `bench/DEBT.md`.

## Isolation check

Before the first call the scratch home was listed: no steering, skills, MCP config or agents (only the shipped
`agent_config.json.example`), `memory.mode` disabled, knowledge off; sessions and logs copied from T1's home removed.

## Lead edits after review (no model call)

The reviewers passed every check on every task, so the lead also read each task and ran the hidden test on the
reference. Edits made by hand, each followed by a rerun of `compute_key.py` and the dry run:

| Task | Edit | Why |
| --- | --- | --- |
| t7-status-slip | fix round 1 (author): planted ids moved into the ordinary sequence, analysis conventions removed from the README, chain head moved to another epic, positional assertions replaced by `cites` with `where`, date and sprint-count tolerance widened, capacity and velocity units made consistent; then by hand: risk precision `min` 0.75 to 0.6, scope-kind no longer needs all three tickets in one risk | planted tickets sat in a 9xx block; README described the method; `risks.1.kind` depended on list order |
| t7-dep-conflicts | prompt: "the milestone that is shown as done but is not" became "any milestone whose status does not match its tickets"; unresolved launch date `tolDays` 0 to 1 | the prompt stated a trap; inclusive day counting |
| t7-ship-train | removed the README rule that names the hackathon sprint as not comparable; dropped three `notes` assertions (two penalised a correct note, one was unstated); added `scope-kept` (unestimated scope tickets must not be excluded); expertKey written by the lead (owner rule, 2026-11-19) | the rule gave the trap away; notes content was never asked for |
| t7-march-date | dropped after its one fix round | planted tickets still recognisable, sprint dates on Sundays, the same date asserted three times |
| t7-freeze-forecast | README generator emitted stray quote marks (fixed in `generate.py`, other fixture files restored from the reviewed copy); dropped the assertion that echoes the requested date; earliest date `tolDays` 2 to 5 | broken README; an echo checks nothing; day-level and sprint-level scheduling differ by a few days |
| t7-scope-cut | prompt: one sentence saying leadership accepted product's additions | otherwise cutting the added work itself is an equally valid answer |
| t7-pm-launch-cut | removed the README sentence that says dependencies of selected features join the window; `planned_points` accepts any total from the required set up to capacity; dropped `questions-are-focused` | the sentence stated a trap; extra small features within capacity are valid; question content was never asked for |
| t7-sprint-plan | dropped after its one fix round; replaced by t7-sprint-capacity (gpt-5.6-luna) | duplicate ticket ids, a must-have counted as planned while its own dependencies were unestimated, tickets both pulled in and listed as not fitting |
| t7-release-gate | none | |
| t7-status-slip-twin | dropped two assertions that could never fail (ticket ids looked up in maps keyed by name and epic); the reviewer's ceiling fail is kept on record: a twin is a near-miss control, scored, but expected to be easy | |
| t7-sprint-capacity | replaced exact per-sprint scope lists with one "planned in some sprint" check (the payment prerequisite left out, since its dependent does not fit); dropped an `order` check between tickets of one sprint, an `order` check of one id, a decoy that a valid answer may list as not fitting, and a precision check whose id list held the decoys; capacity tolerance 0.01 to 0.5; removed a policy sentence that described how to report the overload | several valid plans place tickets in different sprints; the removed checks could fail correct answers or never fail |
| t7-risk-register | dropped without a fix round; replaced by t7-risk-owners (gpt-5.6-luna) | first draft unusable: most assertions only checked that a kind value appears, several matched ordinary words as ids, three competing key scripts |
| t7-program-rollup | dropped the three echo checks of each team's reported colour and an exact-sentence match on `milestone_at_risk`; forecast `tolDays` 0 to 14; prompt says `remaining_points` are open Relay points | echoes add free credit; a free-text field cannot be matched exactly; pooled and per-team capacity forecasts differ by up to a sprint |
| t7-program-framing | dropped without a fix round; replaced by t7-program-brief (gpt-5.6-luna) | date assertions used fields the grader does not have, most assertions matched ordinary words, the request listed the expected sections |
| t7-risk-owners | dropped the two top_three checks (risk ids are the agent's own), the key-person and scope owner checks, the null-trigger check, and the likelihood and impact values from two checks | which person owns a risk, how severe it is and what the agent calls its risks are judgement or naming, not facts in the data |
| t7-dev-breakdown | fix round 1 (author): the work-item export no longer holds the finished breakdown, ticket ids are the agent's own, `order` became `change_order` over file paths, `risks` left the block, a file-list precision check was added | a lazy answer passed 16 of 16: the export already listed one ticket per change with comments naming each trap |
| t7-program-brief | dropped checks that need the agent to use the author's exact workstream and milestone names, an exact phrase in `conflicts.about`, and the word "ownership" in open questions; added one check that a workstream depends on the shared identity ticket and one that the high-vote request is listed out of scope; conflict precision now reads `between` | names and phrasing are the agent's own (the reviewer's ambiguity fail) |

## Version 2: second author family (2026-11-19)

Estimate (plan section 9, T7+T8 rewrite): 150 credits, stop at 300; T7 share 5 tasks. Scratch home checked again before the first call (no steering, skills, MCP config or agents; memory and knowledge off). Every call stream is audited for reads of konductor `skills/`, `agent-sops/`, `agents/`, `context/` and of other batch scratch dirs.

| Task | Step | Model | Seconds | Credits |
| --- | --- | --- | --- | --- |
| t7-dep-conflicts | author | qwen3-coder-next | 1576 | 14.31 |
| t7-dep-conflicts | map | glm-5 | 11 | 0.16 |
| t7-dep-conflicts | review | glm-5 | 150 | 6.67 |
| t7-ship-train | author | minimax-m2.5 | 2127 | 18.01 |
| t7-ship-train | map | glm-5 | 7 | 0.16 |
| t7-ship-train | review | gpt-5.6-luna | 69 | 1.33 |
| t7-release-gate | author | qwen3-coder-next | 642 | 7.76 |
| t7-release-gate | map | glm-5 | 5 | 0.16 |
| t7-release-gate | review | glm-5 | 182 | 10.71 |
| t7-scope-cut | author | minimax-m2.5 | 1780 | 9.12 |
| t7-scope-cut | map | glm-5 | 7 | 0.16 |
| t7-scope-cut | review | gpt-5.6-luna | 80 | 1.57 |
| t7-program-rollup | author | qwen3-coder-next | 1507 | 16.91 |
| t7-ship-train | fix | minimax-m2.5 | 532 | 14.92 |
| t7-ship-train | review | gpt-5.6-luna | 70 | 1.44 |
| t7-dep-conflicts | fix | qwen3-coder-next | 593 | 8.96 |
| t7-release-gate | fix | qwen3-coder-next | 541 | 7.04 |
| t7-dep-conflicts | map | glm-5 | 11 | 0.16 |
| t7-ship-train | map | glm-5 | 9 | 0.16 |
| t7-release-gate | map | glm-5 | 9 | 0.16 |
| t7-dep-conflicts | map | minimax-m2.5 | 35 | 0.08 |
| t7-ship-train | map | minimax-m2.5 | 44 | 0.08 |
| t7-release-gate | map | minimax-m2.5 | 48 | 0.08 |
| t7-scope-cut | fix | minimax-m2.5 | 1607 | 12.38 |

### Version 2 outcome

No task was replaced: every second-family draft failed its review or the lead's read-through twice (or once, for
t7-program-rollup, which got no second attempt), so each keeps version 1 (rule: keep the old version only if the new
one fails twice). The reasons are in each brief's `rewriteAttempts`. The spend stop for this T7 share was 150 credits
(2 x 75); 132.49 were spent, and a further author call (about 17) would have reached it.

| Task | Author (family) | Reviewer (family) | Result |
| --- | --- | --- | --- |
| t7-dep-conflicts | qwen3-coder-next (alibaba) | glm-5 (zhipu) | failed twice, v1 kept |
| t7-release-gate | qwen3-coder-next (alibaba) | glm-5 (zhipu) | failed twice, v1 kept |
| t7-program-rollup | qwen3-coder-next (alibaba) | not reached | no draft, v1 kept |
| t7-ship-train | minimax-m2.5 (minimax) | gpt-5.6-luna (openai) | failed twice, v1 kept |
| t7-scope-cut | minimax-m2.5 (minimax) | gpt-5.6-luna (openai) | failed twice, v1 kept |

Blindness audit: every author, fix, map and review stream of version 2 was grepped for reads of konductor
`skills/`, `agent-sops/`, `agents/` or `context/` paths and of other batch scratch dirs: all clean. The version 1
streams were grepped the same way after the fact: no unit body was read; their only scratch paths are their own.

Mapping of the three tasks that had no targets: glm-5 mapped none of them a second time; minimax-m2.5 (a third family
for these openai-authored, zhipu-reviewed tasks) mapped t7-dep-conflicts to program-planning and progress-tracking
with the SOP k-codebase-analysis, and none for t7-ship-train and t7-release-gate. The mapping is recorded as given.

Dry run of all 13 (record-dry.js, 3 repeats, recorded in each task's `pilot.scores.dryRun`): reference 100, stub 7.1,
alternative answer 100, deterministic. The alternative answers are mechanical variants of the reference
(alt-answer.js: other list order, own ids, wording and prose); no reviewer-written alternative fits a version 1
fixture. No task has a gated lazy answer: the version 1 authors checked theirs in scratch and did not keep them.
A padding probe (pad-answer.js: the reference's numbers and dates, every list filled with every ticket id in the
fixture) passes these shares of hidden tests: dep-conflicts 6/14, dev-breakdown 12/12 and pm-launch-cut 14/14 and
status-slip-twin 14/14 (ids or paths it cannot pad), freeze-forecast 10/15, program-brief 7/11, program-rollup 11/15,
release-gate 10/14, risk-owners 0/10, scope-cut 9/15, ship-train 8/9, sprint-capacity 9/10, status-slip 10/17.
