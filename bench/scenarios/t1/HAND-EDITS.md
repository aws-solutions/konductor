# T1 hand edits

Every change to a T1 task's prompt, fixture, key, checks or rubric made by anyone other than its recorded author. The editor of every row below is the T1 worker, a Claude session (family `claude`, editor `t1-worker`). Each listed task carries `handEdited` and gets a non-Claude checklist re-review (`review.recheck`: no method or decoy in the prompt, the fixture lists no answer, the key matches the fixture, the task is solvable from the fixture alone) before lock.

| task | date | what changed | why |
| --- | --- | --- | --- |
| t1-bug-cache-ttl | 2026-11-19 | checks: the no-dependency `cmd` check became `kind: format`; the regression-test check weight 2 to 3; the changelog check weight 1 to 2 | the untouched fixture scored 25.7 (two guard checks passed on it); after the change the stub scores 19.0 and the reference 100 |
| t1-nfr-report-queries | 2026-11-19 | checks: the `tests` command gained a prefix that asserts Python 3.12 (`python3 -c "import sys; assert sys.version_info[:2] == (3, 12)" && ...`); expertKey: five items and five weak answers written by the worker, each citing a public source | the bench pins Python only for checks that name python, and a wrong interpreter must fail loudly; the expert-key rule arrived after the author call |
| t1-nfr-startup-lazy | 2026-11-19 | checks: the `not_contains "dependencies"` check on package.json became `kind: format`; rubric: `weight: 1` added to both items (the author left it out) | the check passes on the untouched fixture (stub 21.4 before, 18.4 after); the schema requires a rubric weight |
| t1-ref-schema-migrate | 2026-11-19 | prompt: added "(a value that is NULL, empty or only whitespace counts as blank)" after "nonblank address" | the reviewer found a hidden test relies on whitespace-only addresses being blank, which the request did not say |

Mechanical changes made by `stage.js assemble` to every task, not counted as hand edits: `limits` raised to at least 600 s soft and twice that hard; a missing rubric `weight` set to 1; a `source` added to each expert-key item from the task's own `authorship.source` when the author gave none.
