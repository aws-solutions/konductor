# T1 hand edits

Every change to a T1 task's prompt, fixture, key, checks or rubric made by anyone other than its recorded author. The editor of every row below is the T1 worker, a Claude session (family `claude`, editor `t1-worker`). Each listed task carries `handEdited` and gets a non-Claude checklist re-review (`review.recheck`: no method or decoy in the prompt, the fixture lists no answer, the key matches the fixture, the task is solvable from the fixture alone) before lock.

| task | date | what changed | why |
| --- | --- | --- | --- |
| t1-bug-cache-ttl | 2026-11-19 | checks: the no-dependency `cmd` check became `kind: format`; the regression-test check weight 2 to 3; the changelog check weight 1 to 2 | the untouched fixture scored 25.7 (two guard checks passed on it); after the change the stub scores 19.0 and the reference 100 |
| t1-nfr-report-queries | 2026-11-19 | checks: the `tests` command gained a prefix that asserts Python 3.12 (`python3 -c "import sys; assert sys.version_info[:2] == (3, 12)" && ...`); expertKey: five items and five weak answers written by the worker, each citing a public source | the bench pins Python only for checks that name python, and a wrong interpreter must fail loudly; the expert-key rule arrived after the author call |
| t1-nfr-startup-lazy | 2026-11-19 | checks: the `not_contains "dependencies"` check on package.json became `kind: format`; rubric: `weight: 1` added to both items (the author left it out) | the check passes on the untouched fixture (stub 21.4 before, 18.4 after); the schema requires a rubric weight |
| t1-ref-schema-migrate | 2026-11-19 | prompt: added "(a value that is NULL, empty or only whitespace counts as blank)" after "nonblank address" | the reviewer found a hidden test relies on whitespace-only addresses being blank, which the request did not say |
| t1-ref-esm-migrate | 2026-11-20 | fixture: `lib/manifest.json` renamed to `lib/module-map.json`, and the `require` / `import` of it changed in `fixtures/.../lib/manifest.js`, `solutions/.../lib/manifest.js` and `answers/.../alt/lib/manifest.js`; version 1 to 2 | `bench/.gitignore` ignores every `manifest.json`, so the file was never committed and the reference scored 50 from a clean checkout (DEBT D-104). The request and the hidden tests never name the file, so nothing else changed. Dry run after: reference 100, stub 18.3, shallow 37.8, lazy 29.7, alternative 87.8 |

Mechanical changes made by `stage.js assemble` to every task, not counted as hand edits: `limits` raised to at least 600 s soft and twice that hard; a missing rubric `weight` set to 1; a `source` added to each expert-key item from the task's own `authorship.source` when the author gave none.

## Rubric fixes after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews of 2026-11-19 and 2026-11-20 (empty rubrics, single-item 0/15/30 dials, generic polish items). Each item now carries Fail, Partial and Pass anchors in its criterion text, because the rubric schema has no anchor field and the judge reads the criterion as written. Rubric changes do not move the code-only dry-run scores, so pilot.dryRun stands. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t1-bug-cache-ttl`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-bug-date-range`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-bug-event-listeners`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-bug-http-retry`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-impl-cli-envprefix`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-job-retry`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-money-split`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-rate-limit`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-settings-expand`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-webhook-verify`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-nfr-ndjson-stream`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-nfr-report-queries`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-nfr-startup-lazy`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-callbacks`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-dep-upgrade`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-esm-migrate`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-schema-migrate`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
