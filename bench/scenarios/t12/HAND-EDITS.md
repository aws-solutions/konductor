# T12 hand edits

Owner rule (2026-11-19): every change that someone other than the recorded author made to a task's prompt, fixture,
key, checks or rubric is listed here, and the task carries `handEdited`.

All four tasks were written by hand on 2026-11-20 by the mate task-fix worker (claude), owner-approved, with no author
or reviewer model call. So the whole task is a Claude hand edit: `authorship.family` is claude, `handEdited` names
the worker, and every task is on the non-Claude recheck list (bench/DEBT.md D-108). The design review was a careful
self-review: the sub-agent tool of that session could not pick a model, so the requested second-family reviewer did
not run.

Self-review checklist, per task: the prompt names deliverables and constraints, not a method or the traps; every key
item can be derived from the fixture; a correct answer worded or ordered differently passes (the alternative answers
score 100); the shallow fake scores 0 to 22 and the half answer 0 to 36.4.

| Task | Edits during authoring |
| --- | --- |
| t12-spec-rate-limits | key: open questions folded into the requirements section, task items for the remaining-requests header and store failure added (the half answer scored 50 with three sections); the alternative keeps task order (the prompt says order matters) |
| t12-handoff-export-dates | key: legacy-not-affected fact, both-zones check before the pull request, and pull-request evidence added (the half answer scored 66.7); prompt: "without asking anyone" replaced (scenarios lint no-ask rule) |
| t12-parallel-backlog | reference: A2 moved to the second wave (waves list items by start, an item that waits goes later); prompt: a sentence that pointed at the code overlaps removed (it hinted at the trap); hand-written alternative plan |
| t12-sdlc-contact-import | hidden tests regrouped from 12 cases to 5 rules (all cases of a rule in one test); a hand-written half-done importer replaced the mechanical lazy answer, which kept the full code |
