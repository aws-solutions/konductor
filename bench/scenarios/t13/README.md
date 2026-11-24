# T13: documentation, triage and log analysis

Batch T13 holds the three types of work the pack had no task for after T1 to T12: technical documentation, issue and crash triage, and log analysis. Two tasks each, six in all, written from the briefs in `briefs/` (the full briefs with key tables, rubric and gates are in the owner workspace, `reports/new-task-briefs-2026-11-24/`). The phases `documentation`, `triage` and `log-analysis` were added to the taxonomy for this batch (`coverage.js` ADDED_PHASES); the LITE and STANDARD level rules read the plan's 15 core phases only, so their locked picks do not move.

Today the batch holds the briefs, the config and the prompt section only. No task has been written: the authoring step is paid and waits for the owner's cap (plan: `reports/new-task-briefs-2026-11-24.md`).

| Id | Phase | Role | What the agent does |
| --- | --- | --- | --- |
| t13-doc-api-reference-drift | documentation | developer | brings a library's README and API page in line with its code; every example must run |
| t13-doc-agents-onboarding | documentation | developer | writes AGENTS.md and refreshes CONTRIBUTING.md from how the repo really works |
| t13-triage-issue-queue | triage | developer | triages 24 issues: severity, owner, duplicates, action; one open security report |
| t13-triage-crash-reports | triage | developer | groups 300 crash reports into defects, names the hunk behind the worst, decides hotfix by policy |
| t13-log-auth-credential-stuffing | log-analysis | security | finds the attack window, sources and the exact compromised accounts in 5,000 auth log lines |
| t13-log-batch-slowdown | log-analysis | sre | finds the first slow night, the slow stage, the config change behind it and the night the deadline is missed |

## How it is built

T13 runs on T8's document pipeline: the same author prompts (`t8/prompts/`, read through this batch's config so the two cannot drift), the same block-kit key over a JSON block at the end of the document, the same stage steps (`audit`, `log-author`, `normalize`, `map`, `review`, `variants`, `assemble`) and the same free dry run. Two things are T13's own:

- Every task has a scripted user. The brief fixes three facts the folder does not hold (`scriptedUser.facts`: id, topics, answer); `prompts/scripted.md` tells the author to copy them into `task-draft.json`, give each a key item that accepts every word and number form, and write `solution/ASKS.json` with the reference's questions. `taskErrors` refuses a task whose reference asks do not unlock every fact, whose generic ask unlocks one, or whose request repeats an answer. The two-step and twin flows of T8 are not used here.
- The two triage tasks have no matching konductor skill by design, and the batch-slowdown task only a weak one. They measure what konductor costs where it has nothing to offer.

`prompts/answer.md` is the same text as T8's (the answerer's prompt for the lazy and alternative answers); keep the two in step.

## Layout

| Path | What |
| --- | --- |
| `briefs/<id>.json` | the brief: phase, role, models, stack, size, source licence, the JSON block fields, the key shape, the three facts, the prose brief |
| `prompts/scripted.md` | the scripted-user section added to T8's author prompt |
| `prompts/answer.md` | the answerer's prompt (same as T8's) |
| `scenario.config.js` | this batch's config: T8's with the scripted user, `T13_AUTH` and T13's own prompt lookup |
| `run.sh` | the stage's run script with the owner's spend check: every call counted at 15 or its real cost against `CAP` (300) in `$T13_AUTH/ledger.tsv`, refused when it would pass the cap, when the model is Claude, or when a paid owner job runs or the load is 4 or more; one `kiro-cli chat` in an isolated HOME |
| `<id>.json`, `fixtures/`, `hidden/`, `solutions/`, `answers/`, `authoring/`, `AUTHORING-LOG.md` | written by the authoring step (not yet) |

Tests: `bench/runner/test/scenarios-t13.test.js` (briefs, prompt, scripted checks, buildTask) and `scenarios-t13-run.test.js` (run.sh on a stub kiro-cli: ledger, cap refusal, Claude refusal). No model call.
