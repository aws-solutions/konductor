# T7 hand edits

Every change a Claude session made to a T7 task's prompt, fixture, key, checks or rubric after its recorded author
wrote it (owner rule, 2026-11-19). The editor is the T7 worker session (family claude, recorded as
`kirocrew-mate-worker`). Each task in the per-task table has `handEdited` set in its task file and is due a re-check by
a non-Claude reviewer from the checklist in the batch brief; the result goes in `review.recheck`.

## Batch-wide edits (all 13 tasks)

| What | Files | Why |
| --- | --- | --- |
| The grader gained `where` on `cites` and reads an object at a path as the list of its values; every task's hidden copy was refreshed from `lib/` | `hidden/<id>/hidden/plan-grade.cjs` | position-bound checks failed answers that ordered lists differently; plans keyed by sprint could not be read |
| The checks in each task file are written by `stage.js assemble`, not by the author: the hidden test, the output file exists, the main input is unchanged, the block is present (format) | `<id>.json` `checks` | one fixed check set for every T7 task |
| `pilot` and `lockedAt` left out of new task files (the schema then refused `null`) | `<id>.json` | schema |

## Per task

| Task | When | What changed | Why |
| --- | --- | --- | --- |
| t7-status-slip | 2026-11-19, after review | fix round 1 (author): planted ids moved into the ordinary sequence, analysis conventions removed from the README, chain head moved to another epic, positional assertions replaced by `cites` with `where`, date and sprint-count tolerance widened, capacity and velocity units made consistent; then by hand: risk precision `min` 0.75 to 0.6, scope-kind no longer needs all three tickets in one risk | planted tickets sat in a 9xx block; README described the method; `risks.1.kind` depended on list order |
| t7-dep-conflicts | 2026-11-19, after review | prompt: "the milestone that is shown as done but is not" became "any milestone whose status does not match its tickets"; unresolved launch date `tolDays` 0 to 1 | the prompt stated a trap; inclusive day counting |
| t7-ship-train | 2026-11-19, after review | removed the README rule that names the hackathon sprint as not comparable; dropped three `notes` assertions (two penalised a correct note, one was unstated); added `scope-kept` (unestimated scope tickets must not be excluded); expertKey written by the lead (owner rule, 2026-11-19) | the rule gave the trap away; notes content was never asked for |
| t7-freeze-forecast | 2026-11-19, after review | README generator emitted stray quote marks (fixed in `generate.py`, other fixture files restored from the reviewed copy); dropped the assertion that echoes the requested date; earliest date `tolDays` 2 to 5 | broken README; an echo checks nothing; day-level and sprint-level scheduling differ by a few days |
| t7-scope-cut | 2026-11-19, after review | prompt: one sentence saying leadership accepted product's additions | otherwise cutting the added work itself is an equally valid answer |
| t7-pm-launch-cut | 2026-11-19, after review | removed the README sentence that says dependencies of selected features join the window; `planned_points` accepts any total from the required set up to capacity; dropped `questions-are-focused` | the sentence stated a trap; extra small features within capacity are valid; question content was never asked for |
| t7-status-slip-twin | 2026-11-19, after review | dropped two assertions that could never fail (ticket ids looked up in maps keyed by name and epic); the reviewer's ceiling fail is kept on record: a twin is a near-miss control, scored, but expected to be easy | checks that could never fail add free credit |
| t7-sprint-capacity | 2026-11-19, after review | replaced exact per-sprint scope lists with one "planned in some sprint" check (the payment prerequisite left out, since its dependent does not fit); dropped an `order` check between tickets of one sprint, an `order` check of one id, a decoy that a valid answer may list as not fitting, and a precision check whose id list held the decoys; capacity tolerance 0.01 to 0.5; removed a policy sentence that described how to report the overload | several valid plans place tickets in different sprints; the removed checks could fail correct answers or never fail |
| t7-program-rollup | 2026-11-19, after review | dropped the three echo checks of each team's reported colour and an exact-sentence match on `milestone_at_risk`; forecast `tolDays` 0 to 14; prompt says `remaining_points` are open Relay points | echoes add free credit; a free-text field cannot be matched exactly; pooled and per-team capacity forecasts differ by up to a sprint |
| t7-risk-owners | 2026-11-19, after review | dropped the two top_three checks (risk ids are the agent's own), the key-person and scope owner checks, the null-trigger check, and the likelihood and impact values from two checks | which person owns a risk, how severe it is and what the agent calls its risks are judgement or naming, not facts in the data |
| t7-program-brief | 2026-11-19, after review | dropped checks that need the agent to use the author's exact workstream and milestone names, an exact phrase in `conflicts.about`, and the word "ownership" in open questions; added one check that a workstream depends on the shared identity ticket and one that the high-vote request is listed out of scope; conflict precision now reads `between` | names and phrasing are the agent's own (the reviewer's ambiguity fail) |

## Not hand-edited

- t7-release-gate: no edit beyond the batch-wide ones.
- t7-dev-breakdown: its one change was the author's own fix round (gpt-5.6-luna), from instructions the lead wrote.
- Targets (`targetSkills`, `targetSop`, `targetAgent`, `loadCheck`) come from the mapper; t7-dep-conflicts took minimax-m2.5's mapping after glm-5 mapped none (2026-11-19). That is mapping, not a task edit.
- Scored answers under `answers/` (lazy, alternative, padding probe) are script output for the dry run, not task content.

## Scorer change for D-86 (2026-11-20, all 13 tasks, version 1 to 2)

Editor: the T7 worker session (family claude, `kirocrew-mate-worker`). No prompt, fixture or key changed.

| What | Files | Why |
| --- | --- | --- |
| The checks were rebuilt by `stage.js` `checksFor`: a new substance `cmd` check of weight 4 (the answer's block must name at least 80% of the items the key requires in its `includes`, `cites` and `order` assertions); the output-exists check went from weight 3 to 1; the unchanged-input check stays at 1; the block-present check stays format. t7-status-slip-twin gets no evidence check (its key requires no list items). Every task's `version` went from 1 to 2 | `<id>.json` `checks`, `version` | the two cheap checks gave any answer, however shallow, the whole checks share: a free 28.6 points before any hidden test (D-86). Tying most of the checks share to the key's own required items keeps it code-checked (hidden tests plus checks stay 70% of the score) while a correct answer in other words still passes |
| `lazy-answer.js` now halves every list, not only lists of ticket ids | `answers/<id>/lazy/` | file paths, names and object lists were kept whole, so the shallow answer was the reference on those keys |

Result (free dry run, twice): reference 100, empty 4.8 (twin 14.3), alternative 100, same scores twice, on all 13.
Lazy 40 or less on 5 (t7-dev-breakdown 39.3, t7-freeze-forecast 28.6, t7-scope-cut 23.8, t7-sprint-capacity 23.8,
t7-status-slip 30.5); still over on 8, each with its reason in `pilot.scores.fixReason` and `pilot.decision` fix.

## D-86 second pass (2026-11-20, 6 tasks to version 3)

Editor: the T7 worker session (family claude, `kirocrew-mate-worker`). No prompt or fixture changed.

| Task | What changed | Why |
| --- | --- | --- |
| t7-dep-conflicts | key (`compute_key.py` and `key.json`): the three per-conflict "names the pair" checks became one `includes` check that all three late producers are named (14 to 12 assertions); evidence check as below | a list naming only the two obvious conflicts earned two of the three name checks |
| t7-risk-owners | key: the vendor owner and vendor date checks became one check on the vendor risk (ticket, kind, owner and trigger date); the unowned "names the ticket" check was dropped, as the unowned trigger-date check needs the same ticket (10 to 8 assertions); evidence check as below | half-right risk entries earned separate credit for owner and date |
| t7-dep-conflicts, t7-pm-launch-cut, t7-program-rollup, t7-risk-owners, t7-ship-train, t7-status-slip-twin | checks: the evidence check now needs ALL of the key's exact facts in the answer's block (the ids every all-items assertion needs, each date with no tolerance, each integer of two or more digits with no tolerance, each `equals` string of three or more characters), at weight 8; output exists and input unchanged at weight 1; `tests.min` follows the key | with the 80% rule and weight 4, a shallow answer still passed the evidence check or kept a third of the checks share; the hidden tests and checks together stay 70% of the score (rubric 30%), and a correct answer in other words names every exact fact, so it still passes |

`pilot.decision` of these six is set from the owner's gates on `pilot.dryRun` (reference 95 or more, empty 20 or less,
lazy 40 or less, alternative 80 or more, same twice). `record-dry.js` also applies the newer `shallow` gate of
`../t1/dry-run.js` (the reference's non-code files), which for a document task is the reference itself and marks every
T7 task fix; that gate fits code tasks only (DEBT row added).

Still fix, on the paid single-fix list (one key fix by the original writer, gpt-5.6-luna): t7-program-brief and
t7-release-gate. Their shallow answer meets most hidden items even with every non-test check failing (57.7 and 61.9),
because their keys check one-item lists that half a list still holds; reasons in `pilot.scores.fixReason`.
