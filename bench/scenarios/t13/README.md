# T13: documentation, triage and log analysis

Batch T13 holds the three types of work the pack had no task for after T1 to T12: technical documentation, issue and crash triage, and log analysis. Two tasks each, six in all, written from the briefs in `briefs/` (the full briefs with key tables, rubric and gates are in the owner workspace, `reports/new-task-briefs-2026-11-24/`). The phases `documentation`, `triage` and `log-analysis` were added to the taxonomy for this batch (`coverage.js` ADDED_PHASES); the LITE and STANDARD level rules read the plan's 15 core phases only, so their locked picks do not move.

The six tasks were written on 2026-11-24 (owner approval: cap 300 counted credits; 18 calls, 270 counted, about 50 real, `AUTHORING-LOG.md`): author gpt-5.6-luna, map glm-5, review qwen3-coder-next or glm-5. Every draft was then edited by the worker (`HAND-EDITS.md`: wording-brittle and position-bound key items, one incident report glued onto a docs task), so every task carries `handEdited` and waits for its non-Claude recheck before lock (DEBT D-254). All six pass the free gates (reference 100, stub 0 to 6.2, lazy 9.3 to 37, alt 100) and `scenarios lint`. The mapper found a konductor skill for one task only (`agents-md-authoring`); the other five have no `targetSkills`, so every T13 task has `effectSubset: false` and is reported in its own row as a cost control. The pilot run and the study are not approved yet.

| Id | Phase | Role | What the agent does |
| --- | --- | --- | --- |
| t13-doc-api-reference-drift | documentation | developer | brings a library's README and API page in line with its code; every example must run |
| t13-doc-agents-onboarding | documentation | developer | writes AGENTS.md and refreshes CONTRIBUTING.md from how the repo really works |
| t13-triage-issue-queue | triage | developer | triages 24 issues: severity, owner, duplicates, action; one open security report |
| t13-triage-crash-reports | triage | developer | groups 300 crash reports into defects, names the hunk behind the worst, decides hotfix by policy |
| t13-log-auth-credential-stuffing | log-analysis | security | finds the attack window, sources and the exact compromised accounts in 5,000 auth log lines |
| t13-log-batch-slowdown | log-analysis | sre | finds the first slow night, the slow stage, the config change behind it and the night the deadline is missed |

## How it is built

T13 runs on T8's document pipeline: T8's author prompts (`t8/prompts/`, read through this batch's config so the two cannot drift), the same block-kit key over a JSON block at the end of the document, the same stage steps (`audit`, `log-author`, `normalize`, `map`, `review`, `variants`, `assemble`) and the same free dry run. Three things are T13's own:

- Its own `prompts/kind-doc.md` (added 2026-11-24, D-255, after the first batch was written): document-shaped key examples in place of T8's incident items, a line against gluing an incident report onto a document, and the key audit rules every first-batch key broke once (fields the request does not name, matches over an element's JSON text, exact strings beside a tolerance, unstated length caps, narrow wording). The config also swaps T8's "operations and reliability work" intro for T13's. The six tasks here were written with T8's file.

- Every task has a scripted user. The brief fixes three facts the folder does not hold (`scriptedUser.facts`: id, topics, answer); `prompts/scripted.md` tells the author to copy them into `task-draft.json`, give each a key item that accepts every word and number form, and write `solution/ASKS.json` with the reference's questions. `taskErrors` refuses a task whose reference asks do not unlock every fact, whose generic ask unlocks one, or whose request repeats an answer. The two-step and twin flows of T8 are not used here.
- The two triage tasks have no matching konductor skill by design, and the batch-slowdown task only a weak one. They measure what konductor costs where it has nothing to offer.

`prompts/answer.md` is the same text as T8's (the answerer's prompt for the lazy and alternative answers); keep the two in step.

## Layout

| Path | What |
| --- | --- |
| `briefs/<id>.json` | the brief: phase, role, models, stack, size, source licence, the JSON block fields, the key shape, the three facts, the prose brief |
| `prompts/scripted.md` | the scripted-user section added to T8's author prompt |
| `prompts/answer.md`, `prompts/review.md` | the answerer's and the reviewer's prompts: T8's text, the review one with a scripted-user leak check added (`stage.js review` reads it from the batch directory) |
| `scenario.config.js` | this batch's config: T8's with the scripted user, `T13_AUTH` and T13's own prompt lookup |
| `run.sh` | the stage's run script with the owner's spend check: every call counted at 15 or its real cost against `CAP` (300) in `$T13_AUTH/ledger.tsv`, refused when it would pass the cap, when the model is Claude, or when a paid owner job runs or the load is 4 or more; one `kiro-cli chat` in an isolated HOME |
| `<id>.json`, `fixtures/`, `hidden/`, `solutions/`, `answers/`, `authoring/`, `AUTHORING-LOG.md` | written by the authoring step (not yet) |

Tests: `bench/runner/test/scenarios-t13.test.js` (briefs, prompt, scripted checks, buildTask) and `scenarios-t13-run.test.js` (run.sh on a stub kiro-cli: ledger, cap refusal, Claude refusal). No model call.
