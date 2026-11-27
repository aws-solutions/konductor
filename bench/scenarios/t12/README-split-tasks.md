# T12 split-part tasks (prompt-fix step 0, 2026-11-27)

Three tasks for the solo-or-team plan rule of the konductor prompt-fix arms (reports/konductor-prompt-fixes-2026-11-27.md
Part C, rows 7, 13 and 14). The request never says how to work, so the plan is the agent's own call. Each is scored
on the files only: hidden behaviour tests, the suite green, a test per part, and the docs left as they are. The
expected plan of each is pre-registered in `bench/scenarios/konductor/prompt-fix/expect.json`, not in the task file.

| Task | Parts | Expected plan | Scored by |
| --- | --- | --- | --- |
| `t12-split-three-modules` | three helpers (`src/slugify.js`, `src/roman.js`, `src/word-stats.js`), each with its own spec in `docs/specs/` | team | 15 hidden tests, one file per helper |
| `t12-split-four-jobs` | four batch steps (`src/jobs/<step>.js`), each with its own doc in `docs/jobs/`, about 40 lines each | team | 16 hidden tests, one file per step |
| `t12-split-shared-file` | two tickets (`docs/tickets/FMT-7.md`, `FMT-9.md`) that both edit `src/format.js` and `CHANGELOG.md` | solo (control) | 4 hidden tests, the changelog lines included |

`t12-split-three-modules` and `t12-split-four-jobs` carry a judge-only `.bench-answer-key.md` with a
Pattern key for the quality pack's `mod-pattern-missing` (bench/docs/quality-pack.md); `t12-split-shared-file` has
none, because no pattern is clearly right there. Each fixture is a git repository (`dotgit`, built by
`build-git-fixture.js`, which leaves the answer key out of the history). `solutions/<id>/` is the reference
overlay; `answers/<id>/lazy/` does one part only (one helper, one step, one ticket). There is no `alt` or `shallow`
answer yet, and the three were written by hand by a Claude worker, so each waits for a non-Claude recheck before a
counted STANDARD run (DEBT D-296).
